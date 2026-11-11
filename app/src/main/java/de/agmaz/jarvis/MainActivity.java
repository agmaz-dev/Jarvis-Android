package de.agmaz.jarvis;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.StatFs;
import android.os.SystemClock;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Jarvis für Android: Die Oberflächen aus FreeJarvis laufen 1:1 in einer WebView (Ordner web/).
 * Diese Klasse stellt der Oberfläche über "JarvisNative" bereit, was ein Browser auf dem Handy nicht kann:
 * Netzwerk ohne CORS-Grenzen (z. B. Ollama auf http://localhost:11434), Spracherkennung, Sprachausgabe, Systemwerte.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/index.html";
    private static final int REQ_MIC = 7;

    private WebView web;
    private FrameLayout root;
    static final String BROWSER_UA = "Mozilla/5.0 (Linux; Android 15; SM-F966B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final ExecutorService llmExec = Executors.newSingleThreadExecutor();
    private Llm llm;
    private final Map<Integer, HttpURLConnection> conns = new ConcurrentHashMap<>();
    private final Set<Integer> aborted = ConcurrentHashMap.newKeySet();

    private SpeechRecognizer recognizer;
    private boolean srActive = false;
    private boolean paused = false;
    private String srLang = "de-DE";
    private String srPending = null;

    private TextToSpeech tts;
    private volatile boolean ttsReady = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#06142c"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#06142c"));
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                l = i.left; t = i.top; r = i.right; b = i.bottom;
            } else {
                l = insets.getSystemWindowInsetLeft(); t = insets.getSystemWindowInsetTop();
                r = insets.getSystemWindowInsetRight(); b = insets.getSystemWindowInsetBottom();
            }
            v.setPadding(l, t, r, b);
            return insets;
        });
        setContentView(root);

        WebView.setWebContentsDebuggingEnabled(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost())) return false;
                openExternal(u.toString());
                return true;
            }
        });
        try { llm = new Llm(this); } catch (Throwable t) { llm = null; }
        web.addJavascriptInterface(new Bridge(), "JarvisNative");
        android.webkit.CookieManager.getInstance().setAcceptCookie(true);

        tts = new TextToSpeech(this, status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady) {
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { js("tts", "start", id); }
                    @Override public void onDone(String id) { js("tts", "done", id); }
                    @Override @SuppressWarnings("deprecation") public void onError(String id) { js("tts", "error", id); }
                    @Override public void onError(String id, int code) { js("tts", "error", id); }
                    @Override public void onRangeStart(String id, int start, int end, int frame) { js("tts", "word", id); }
                });
                js("tts", "voices", voicesJson());
            }
        });

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
        }

        // Nach einem Update alte Dateien aus dem Zwischenspeicher der Oberfläche verwerfen
        try {
            int vc = (int) getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode();
            android.content.SharedPreferences pr = getSharedPreferences("app", MODE_PRIVATE);
            if (pr.getInt("vc", -1) != vc) { web.clearCache(true); pr.edit().putInt("vc", vc).apply(); }
        } catch (Exception ignored) { }
        web.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    /** Ruft window.__jvNative[kanal](typ, wert) in der Oberfläche auf. */
    private void js(String channel, String type, String value) {
        final String code = "window.__jvNative&&window.__jvNative." + channel + "&&window.__jvNative." + channel + "("
                + JSONObject.quote(type) + "," + (value == null ? "null" : JSONObject.quote(value)) + ")";
        main.post(() -> { if (web != null) web.evaluateJavascript(code, null); });
    }

    private void jsHttp(int id, String type, String a, String b) {
        final String code = "window.__jvNative&&window.__jvNative.http&&window.__jvNative.http(" + id + "," + JSONObject.quote(type) + ","
                + (a == null ? "null" : a) + "," + (b == null ? "null" : JSONObject.quote(b)) + ")";
        main.post(() -> { if (web != null) web.evaluateJavascript(code, null); });
    }

    private void openExternal(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException ignored) {
        }
    }

    private String voicesJson() {
        JSONArray arr = new JSONArray();
        try {
            Set<Voice> vs = tts.getVoices();
            if (vs != null) {
                List<Voice> list = new ArrayList<>(vs);
                list.sort((x, y) -> x.getName().compareTo(y.getName()));
                for (Voice v : list) {
                    JSONObject o = new JSONObject();
                    o.put("name", v.getName());
                    o.put("lang", v.getLocale().toLanguageTag());
                    o.put("local", !v.isNetworkConnectionRequired());
                    arr.put(o);
                }
            }
        } catch (Exception ignored) {
        }
        return arr.toString();
    }

    // ------------------------------------------------------------------ Netzwerk
    private void doHttp(int id, String specJson) {
        HttpURLConnection c = null;
        try {
            JSONObject spec = new JSONObject(specJson);
            int timeout = Math.max(1000, spec.optInt("timeout", 20000));
            c = (HttpURLConnection) new URL(spec.getString("url")).openConnection();
            conns.put(id, c);
            c.setConnectTimeout(Math.min(timeout, 15000));
            c.setReadTimeout(timeout);
            c.setRequestMethod(spec.optString("method", "GET"));
            c.setRequestProperty("User-Agent", "Jarvis-Android/1.1");
            JSONObject h = spec.optJSONObject("headers");
            if (h != null) {
                Iterator<String> it = h.keys();
                while (it.hasNext()) { String k = it.next(); c.setRequestProperty(k, h.getString(k)); }
            }
            if (!spec.isNull("body")) {
                byte[] body = spec.getString("body").getBytes(StandardCharsets.UTF_8);
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(body.length);
                try (OutputStream os = c.getOutputStream()) { os.write(body); }
            }
            int code = c.getResponseCode();
            JSONObject hdr = new JSONObject();
            for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                if (e.getKey() == null || e.getValue() == null) continue;
                hdr.put(e.getKey().toLowerCase(Locale.ROOT), String.join(", ", e.getValue()));
            }
            jsHttp(id, "head", String.valueOf(code), hdr.toString());
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in != null) {
                try (InputStream is = in) {
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = is.read(buf)) > 0) {
                        if (aborted.contains(id)) break;
                        jsHttp(id, "data", JSONObject.quote(Base64.encodeToString(buf, 0, n, Base64.NO_WRAP)), null);
                    }
                }
            }
            if (!aborted.contains(id)) jsHttp(id, "end", null, null);
        } catch (Exception e) {
            if (!aborted.contains(id)) {
                String m = e.getClass().getSimpleName() + (e.getMessage() != null ? ": " + e.getMessage() : "");
                jsHttp(id, "error", JSONObject.quote(m), null);
            }
        } finally {
            conns.remove(id);
            aborted.remove(id);
            if (c != null) c.disconnect();
        }
    }

    // ------------------------------------------------------------------ Spracherkennung
    // Reihenfolge: 0 = Standard-Spracherkennung des Handys, 1 = Google-Spracherkennung direkt,
    // 2 = Erkennung auf dem Gerät, 3 = Google-Sprachfenster (funktioniert praktisch immer).
    private int srMode = 0;
    private boolean srReady = false;
    private boolean srDialog = false;
    private static final int REQ_SPEECH = 8;

    private void toast(final String msg) {
        main.post(() -> android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_LONG).show());
    }

    private final RecognitionListener srListener = new RecognitionListener() {
        @Override public void onReadyForSpeech(Bundle params) { srReady = true; js("sr", "start", null); }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float rmsdB) { }
        @Override public void onBufferReceived(byte[] buffer) { }
        @Override public void onEndOfSpeech() { }
        @Override public void onEvent(int eventType, Bundle params) { }

        @Override
        public void onPartialResults(Bundle b) {
            String t = first(b);
            if (t != null && !t.isEmpty()) js("sr", "partial", t);
        }

        @Override
        public void onResults(Bundle b) {
            String t = first(b);
            if (t != null && !t.isEmpty()) js("sr", "final", t);
            srEnd();
        }

        @Override
        public void onError(int error) {
            if (!srActive) return;
            // Dienst nicht nutzbar (Samsung-Standard, Sprache fehlt, Verbindung zum Dienst weg): nächste Variante probieren
            boolean serviceProblem = error == SpeechRecognizer.ERROR_CLIENT || error == 11 || error == 12 || error == 13 || error == 14
                    || (!srReady && (error == SpeechRecognizer.ERROR_SERVER || error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY));
            if (serviceProblem && !srReady && srMode < 3) {
                srMode++;
                if (recognizer != null) { try { recognizer.destroy(); } catch (Exception ignored) { } recognizer = null; }
                srActive = false;
                srStart(srLang);
                return;
            }
            String e;
            switch (error) {
                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: e = "not-allowed"; break;
                case SpeechRecognizer.ERROR_AUDIO: e = "audio-capture"; toast("Spracherkennung: Mikrofon ist belegt oder nicht verfügbar."); break;
                case SpeechRecognizer.ERROR_NETWORK:
                case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                case SpeechRecognizer.ERROR_SERVER: e = "network"; break;
                case SpeechRecognizer.ERROR_NO_MATCH:
                case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: e = "no-speech"; break;
                default: e = "aborted"; toast("Spracherkennung: Fehler " + error);
            }
            js("sr", "error", e);
            srEnd();
        }
    };

    private static String first(Bundle b) {
        if (b == null) return null;
        ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return (r == null || r.isEmpty()) ? null : r.get(0);
    }

    private void srEnd() {
        if (srActive) {
            srActive = false;
            js("sr", "end", null);
        }
    }

    private Intent speechIntent() {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, srLang);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, srLang);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        return i;
    }

    private SpeechRecognizer makeRecognizer() {
        try {
            if (srMode == 0) {
                return SpeechRecognizer.isRecognitionAvailable(this) ? SpeechRecognizer.createSpeechRecognizer(this) : null;
            }
            if (srMode == 1) {
                android.content.ComponentName g = new android.content.ComponentName("com.google.android.googlequicksearchbox",
                        "com.google.android.voicesearch.serviceapi.GoogleRecognitionService");
                try { getPackageManager().getPackageInfo(g.getPackageName(), 0); } catch (Exception e) { return null; }
                return SpeechRecognizer.createSpeechRecognizer(this, g);
            }
            if (srMode == 2 && Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
                return SpeechRecognizer.createOnDeviceSpeechRecognizer(this);
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private void srStart(String lang) {
        srLang = lang == null || lang.isEmpty() ? "de-DE" : lang;
        if (srDialog) return;
        if (paused) { srPending = srLang; return; }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
            srActive = true;
            js("sr", "error", "not-allowed");
            srEnd();
            return;
        }
        while (recognizer == null && srMode < 3) {
            recognizer = makeRecognizer();
            if (recognizer == null) srMode++;
            else recognizer.setRecognitionListener(srListener);
        }
        if (srMode >= 3) {   // letzte Möglichkeit: das Sprachfenster von Google
            try {
                srActive = true;
                srDialog = true;
                Intent i = speechIntent();
                i.putExtra(RecognizerIntent.EXTRA_PROMPT, "Sprich jetzt mit Jarvis …");
                startActivityForResult(i, REQ_SPEECH);
                js("sr", "start", null);
            } catch (Exception e) {
                srDialog = false;
                toast("Keine Spracherkennung gefunden. Bitte die Google-App installieren bzw. aktualisieren.");
                js("sr", "error", "service-not-allowed");
                srEnd();
            }
            return;
        }
        if (srActive) { recognizer.cancel(); srActive = false; }
        srReady = false;
        srActive = true;
        try {
            recognizer.startListening(speechIntent());
        } catch (Exception e) {
            js("sr", "error", "aborted");
            srEnd();
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_SPEECH) return;
        srDialog = false;
        ArrayList<String> r = data == null ? null : data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (resultCode == RESULT_OK && r != null && !r.isEmpty() && !r.get(0).isEmpty()) js("sr", "final", r.get(0));
        else js("sr", "error", "cancelled");   // Fenster weggetippt: Mikrofon pausieren statt sofort neu öffnen
        srEnd();
    }

    private void srAbort() {
        srPending = null;
        if (srDialog) return;   // das Google-Fenster schließt der Nutzer selbst
        if (recognizer != null && srActive) recognizer.cancel();
        srEnd();
    }


    // ------------------------------------------------------------------ Google-Suche im unsichtbaren Browser
    private WebView gWeb;
    private String gId = null;
    private boolean gDone = false;
    private FrameLayout gSetup;
    private static final String G_EXTRACT = "(function(){var out=[],seen={};"
            + "document.querySelectorAll('a h3').forEach(function(h){var a=h.closest('a');if(!a)return;var u=a.href||'';"
            + "if(u.indexOf('/url?')>=0){try{var q=new URL(u).searchParams.get('q')||new URL(u).searchParams.get('url');if(q)u=q;}catch(e){}}"
            + "if(!/^https?:/.test(u)||/^https?:\\/\\/([a-z]+\\.)?google\\.[a-z.]+\\/(search|preferences|setprefs|advanced)|accounts\\.google|support\\.google|policies\\.google|maps\\.google/.test(u))return;"
            + "if(seen[u])return;seen[u]=1;var box=a.closest('div.MjjYud,div.g,div[data-hveid]')||a.parentElement;var sn='';"
            + "if(box){sn=(box.innerText||'').replace(h.innerText,'').replace(/\\s+/g,' ').trim().slice(0,300);}"
            + "out.push({title:(h.innerText||'').trim(),url:u,snippet:sn});});"
            + "var ab=document.querySelector('[data-attrid] .hgKElc, .IZ6rdc, .Z0LcW, .kno-rdesc span');"
            + "if(ab&&ab.innerText){out.unshift({title:'Google-Antwort',url:location.href,snippet:ab.innerText.trim().slice(0,400)});}"
            + "return JSON.stringify({ok:out.length>0,results:out.slice(0,8)});})()";

    private void gFinish(String json) {
        if (gDone || gId == null) return;
        gDone = true;
        String id = gId;
        gId = null;
        js("search", id, json);
        if (gWeb != null) gWeb.stopLoading();
    }

    private void googleSearch(final String id, final String q) {
        if (gId != null) { js("search", id, "{\"ok\":false,\"reason\":\"busy\"}"); return; }
        if (gWeb == null) {
            gWeb = new WebView(this);
            WebSettings s = gWeb.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setUserAgentString(BROWSER_UA);
            s.setBlockNetworkImage(true);
            android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(gWeb, true);
            gWeb.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView v, String url) {
                    if (gId == null || gDone) return;
                    if (url.contains("/sorry/") || url.contains("consent.google")) {
                        gFinish("{\"ok\":false,\"reason\":\"" + (url.contains("consent") ? "consent" : "captcha") + "\"}");
                        return;
                    }
                    main.postDelayed(() -> {
                        if (gId == null || gDone || gWeb == null) return;
                        gWeb.evaluateJavascript(G_EXTRACT, value -> {
                            String json = "{\"ok\":false}";
                            try { json = new JSONArray("[" + value + "]").getString(0); } catch (Exception ignored) { }
                            gFinish(json);
                        });
                    }, 700);
                }
            });
            // unsichtbar hinter der Oberfläche
            root.addView(gWeb, 0, new FrameLayout.LayoutParams(1080, 2000));
        }
        gId = id;
        gDone = false;
        try {
            gWeb.loadUrl("https://www.google.com/search?hl=de&gl=de&num=10&q=" + java.net.URLEncoder.encode(q, "UTF-8"));
        } catch (Exception e) {
            gFinish("{\"ok\":false}");
            return;
        }
        main.postDelayed(() -> { if (id.equals(gId)) gFinish("{\"ok\":false,\"reason\":\"timeout\"}"); }, 15000);
    }

    private void googleSetup() {
        if (gSetup != null) return;
        gSetup = new FrameLayout(this);
        gSetup.setBackgroundColor(Color.parseColor("#06142c"));
        WebView w = new WebView(this);
        w.getSettings().setJavaScriptEnabled(true);
        w.getSettings().setDomStorageEnabled(true);
        w.getSettings().setUserAgentString(BROWSER_UA);
        android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(w, true);
        w.setWebViewClient(new WebViewClient());
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT);
        lp.topMargin = (int) (56 * getResources().getDisplayMetrics().density);
        gSetup.addView(w, lp);
        android.widget.Button done = new android.widget.Button(this);
        done.setText("Fertig – zurück zu Jarvis");
        done.setOnClickListener(v -> closeGoogleSetup());
        gSetup.addView(done, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, (int) (56 * getResources().getDisplayMetrics().density)));
        root.addView(gSetup, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        w.loadUrl("https://www.google.com/search?hl=de&gl=de&q=Jarvis");
    }

    private void closeGoogleSetup() {
        if (gSetup == null) return;
        android.webkit.CookieManager.getInstance().flush();
        root.removeView(gSetup);
        gSetup = null;
        toast("Google ist eingerichtet.");
    }

    // ------------------------------------------------------------------ Brücke für die Oberfläche
    private class Bridge {
        @JavascriptInterface
        public void httpRequest(final int id, final String spec) { pool.execute(() -> doHttp(id, spec)); }

        @JavascriptInterface
        public void httpAbort(final int id) {
            aborted.add(id);
            final HttpURLConnection c = conns.get(id);
            if (c != null) pool.execute(c::disconnect);
        }

        @JavascriptInterface
        public String systemInfo() {
            JSONObject o = new JSONObject();
            try {
                ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(mi);
                o.put("ram_gesamt", mi.totalMem / 1073741824.0);
                o.put("ram_frei", mi.availMem / 1073741824.0);
                StatFs fs = new StatFs(getFilesDir().getPath());
                o.put("platte_gesamt", fs.getTotalBytes());
                o.put("platte_frei", fs.getAvailableBytes());
                o.put("laufzeit", SystemClock.elapsedRealtime() / 1000.0);
                o.put("kerne", Runtime.getRuntime().availableProcessors());
                BatteryManager bm = (BatteryManager) getSystemService(Context.BATTERY_SERVICE);
                if (bm != null) o.put("akku", bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY));
            } catch (Exception ignored) {
            }
            return o.toString();
        }

        @JavascriptInterface
        public void openUrl(final String url) { main.post(() -> openExternal(url)); }

        @JavascriptInterface
        public String appVersion() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
        }

        @JavascriptInterface
        public void googleSearch(final String id, final String q) { main.post(() -> MainActivity.this.googleSearch(id, q)); }

        @JavascriptInterface
        public void googleSetup() { main.post(MainActivity.this::googleSetup); }

        // ---------------- Eigene KI auf dem Handy
        @JavascriptInterface
        public String llmStatus() { return llm == null ? "{\"error\":\"KI-Modul fehlt\"}" : llm.status(); }

        @JavascriptInterface
        public void llmDownload(final String id) {
            if (llm == null) return;
            pool.execute(() -> {
                String err = llm.download(id);
                js("llm", "dl", err == null ? "" : err);
                if (err == null) toast("Download gestartet – den Fortschritt siehst du auch in der Benachrichtigung.");
            });
        }

        @JavascriptInterface
        public void llmDelete(final String id) { if (llm != null) llmExec.execute(() -> llm.delete(id)); }

        @JavascriptInterface
        public void llmStop() { Llm.nativeStop(); }

        @JavascriptInterface
        public void llmGenerate(final String req) {
            if (llm == null) { js("llm", "done", "KI-Modul fehlt in dieser App-Version."); return; }
            llmExec.execute(() -> {
                try {
                    JSONObject r = new JSONObject(req);
                    String id = r.getString("model");
                    if (!id.equals(llm.loaded)) js("llm", "status", "loading");
                    String err = llm.ensureLoaded(id);
                    if (err != null) { js("llm", "done", err); return; }
                    js("llm", "status", "ready");
                    JSONArray ms = r.getJSONArray("messages");
                    String[] roles = new String[ms.length()], contents = new String[ms.length()];
                    for (int i = 0; i < ms.length(); i++) {
                        roles[i] = ms.getJSONObject(i).getString("role");
                        contents[i] = ms.getJSONObject(i).getString("content");
                    }
                    String res = Llm.nativeGenerate(roles, contents, r.optInt("max", 700), (float) r.optDouble("temp", 0.8),
                            bytes -> js("llm", "tok", new String(bytes, StandardCharsets.UTF_8)));
                    js("llm", "done", res == null ? "" : res);
                } catch (Throwable t) {
                    js("llm", "done", "Fehler der eigenen KI: " + t.getMessage());
                }
            });
        }

        @JavascriptInterface
        public void srStart(final String lang) { main.post(() -> MainActivity.this.srStart(lang)); }

        @JavascriptInterface
        public void srStop() { main.post(() -> { if (recognizer != null && srActive) recognizer.stopListening(); }); }

        @JavascriptInterface
        public void srAbort() { main.post(MainActivity.this::srAbort); }

        @JavascriptInterface
        public String ttsVoices() { return ttsReady ? voicesJson() : ""; }

        @JavascriptInterface
        public void ttsSpeak(final String id, final String text, final String voice, final String lang,
                             final float rate, final float pitch, final float volume) {
            main.post(() -> {
                if (!ttsReady) { js("tts", "error", id); return; }
                boolean set = false;
                if (voice != null && !voice.isEmpty()) {
                    try {
                        for (Voice v : tts.getVoices()) {
                            if (v.getName().equals(voice)) { tts.setVoice(v); set = true; break; }
                        }
                    } catch (Exception ignored) {
                    }
                }
                if (!set) tts.setLanguage(Locale.forLanguageTag(lang == null || lang.isEmpty() ? "de-DE" : lang));
                tts.setSpeechRate(rate > 0 ? rate : 1f);
                tts.setPitch(pitch > 0 ? pitch : 1f);
                Bundle p = new Bundle();
                p.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume > 0 ? volume : 1f);
                if (tts.speak(text, TextToSpeech.QUEUE_ADD, p, id) != TextToSpeech.SUCCESS) js("tts", "error", id);
            });
        }

        @JavascriptInterface
        public void ttsStop() { main.post(() -> { if (tts != null) tts.stop(); }); }
    }

    // ------------------------------------------------------------------ Lebenszyklus
    @Override
    protected void onPause() {
        super.onPause();
        paused = true;
        if (recognizer != null && srActive && !srDialog) {
            recognizer.cancel();
            srActive = false;
            srPending = srLang;   // nach der Rückkehr weiterhören, die Oberfläche wartet noch
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        paused = false;
        if (srPending != null) {
            String l = srPending;
            srPending = null;
            srStart(l);
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (gSetup != null) closeGoogleSetup();
        else if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        // Android braucht dringend Speicher und Jarvis ist im Hintergrund: Modell freigeben (wird bei Bedarf neu geladen)
        if (level >= TRIM_MEMORY_COMPLETE && llm != null && llm.loaded != null) {
            llmExec.execute(() -> { Llm.nativeUnload(); llm.loaded = null; });
        }
    }

    @Override
    protected void onDestroy() {
        if (recognizer != null) recognizer.destroy();
        if (tts != null) tts.shutdown();
        pool.shutdownNow();
        if (web != null) web.destroy();
        web = null;
        super.onDestroy();
    }
}
