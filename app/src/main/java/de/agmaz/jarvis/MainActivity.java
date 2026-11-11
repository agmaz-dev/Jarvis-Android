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
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newCachedThreadPool();
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
        FrameLayout root = new FrameLayout(this);
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
        web.addJavascriptInterface(new Bridge(), "JarvisNative");

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
    private final RecognitionListener srListener = new RecognitionListener() {
        @Override public void onReadyForSpeech(Bundle params) { js("sr", "start", null); }
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
            String e;
            switch (error) {
                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: e = "not-allowed"; break;
                case SpeechRecognizer.ERROR_AUDIO: e = "audio-capture"; break;
                case SpeechRecognizer.ERROR_NETWORK:
                case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                case SpeechRecognizer.ERROR_SERVER: e = "network"; break;
                case SpeechRecognizer.ERROR_NO_MATCH:
                case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: e = "no-speech"; break;
                default: e = "aborted";
            }
            if (srActive) js("sr", "error", e);
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

    private void srStart(String lang) {
        srLang = lang == null || lang.isEmpty() ? "de-DE" : lang;
        if (paused) { srPending = srLang; return; }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
            srActive = true;
            js("sr", "error", "not-allowed");
            srEnd();
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            srActive = true;
            js("sr", "error", "service-not-allowed");
            srEnd();
            return;
        }
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(srListener);
        }
        if (srActive) { recognizer.cancel(); srActive = false; }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, srLang);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        srActive = true;
        try {
            recognizer.startListening(i);
        } catch (Exception e) {
            js("sr", "error", "aborted");
            srEnd();
        }
    }

    private void srAbort() {
        srPending = null;
        if (recognizer != null && srActive) recognizer.cancel();
        srEnd();
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
        if (recognizer != null && srActive) {
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
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
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
