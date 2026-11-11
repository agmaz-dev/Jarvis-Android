package de.agmaz.jarvis;

import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Eigene KI auf dem Handy: Modell-Dateien (GGUF) herunterladen, laden und Antworten erzeugen (llama.cpp).
 */
public class Llm {
    static {
        System.loadLibrary("jarvis_llm");
    }

    static native boolean nativeLoad(String path, int nCtx, int nThreads);
    static native String nativeError();
    static native void nativeStop();
    static native void nativeUnload();
    static native String nativeGenerate(String[] roles, String[] contents, int maxTokens, float temp, TokenCallback cb);

    public interface TokenCallback { void onToken(byte[] utf8); }

    /** Verfügbare Modelle. Mehrere Adressen je Modell, falls eine Quelle eine Datei umbenennt. */
    static final String[][] MODELS = {
            // id, Anzeigename, ungefähre Größe in GB, Beschreibung, URL1, URL2
            {"gemma-4-12b", "Gemma 4 12B (empfohlen)", "7.1", "Google, klug, gut auf Deutsch und Türkisch. Braucht ca. 8 GB Arbeitsspeicher.",
                    "https://huggingface.co/unsloth/gemma-4-12b-it-GGUF/resolve/main/gemma-4-12b-it-Q4_K_M.gguf",
                    "https://huggingface.co/bartowski/gemma-4-12B-it-GGUF/resolve/main/gemma-4-12B-it-Q4_K_M.gguf"},
            {"gemma-4-e4b", "Gemma 4 E4B (schneller)", "4.5", "Kleinere Variante: schneller, sparsamer, etwas weniger klug.",
                    "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf",
                    "https://huggingface.co/bartowski/google_gemma-4-E4B-it-GGUF/resolve/main/google_gemma-4-E4B-it-Q4_K_M.gguf"},
    };

    private final Context ctx;
    private final SharedPreferences prefs;
    volatile String loaded = null;
    volatile boolean loading = false;

    Llm(Context c) {
        ctx = c.getApplicationContext();
        prefs = ctx.getSharedPreferences("llm", Context.MODE_PRIVATE);
    }

    File dir() {
        File d = new File(ctx.getExternalFilesDir(null), "models");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    File file(String id) { return new File(dir(), id + ".gguf"); }

    static String[] find(String id) {
        for (String[] m : MODELS) if (m[0].equals(id)) return m;
        return null;
    }

    private DownloadManager dm() { return (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE); }

    /** Status eines Downloads: [status, geladen, gesamt] oder null */
    private long[] dlState(long id) {
        try (Cursor c = dm().query(new DownloadManager.Query().setFilterById(id))) {
            if (c == null || !c.moveToFirst()) return null;
            return new long[]{
                    c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)),
                    c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)),
                    c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)),
                    c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))};
        } catch (Exception e) {
            return null;
        }
    }

    boolean installed(String id) {
        File f = file(id);
        if (!f.exists() || f.length() < 200_000_000L) return false;
        long dl = prefs.getLong("dl_" + id, -1);
        if (dl < 0) return true;
        long[] st = dlState(dl);
        return st == null || st[0] == DownloadManager.STATUS_SUCCESSFUL;
    }

    String status() {
        JSONObject o = new JSONObject();
        try {
            JSONArray arr = new JSONArray();
            for (String[] m : MODELS) {
                JSONObject j = new JSONObject();
                j.put("id", m[0]);
                j.put("name", m[1]);
                j.put("gb", m[2]);
                j.put("info", m[3]);
                boolean inst = installed(m[0]);
                j.put("installed", inst);
                long dl = prefs.getLong("dl_" + m[0], -1);
                if (!inst && dl >= 0) {
                    long[] st = dlState(dl);
                    if (st != null) {
                        int s = (int) st[0];
                        j.put("downloading", s == DownloadManager.STATUS_RUNNING || s == DownloadManager.STATUS_PENDING || s == DownloadManager.STATUS_PAUSED);
                        j.put("paused", s == DownloadManager.STATUS_PAUSED);
                        j.put("failed", s == DownloadManager.STATUS_FAILED);
                        j.put("reason", st[3]);
                        j.put("done", st[1]);
                        j.put("total", st[2]);
                    }
                }
                arr.put(j);
            }
            o.put("models", arr);
            o.put("loaded", loaded == null ? JSONObject.NULL : loaded);
            o.put("loading", loading);
            o.put("free_gb", dir().getUsableSpace() / 1e9);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    /** Erste erreichbare Adresse suchen (läuft im Hintergrund-Thread). */
    private static String reachable(String[] m) {
        for (int i = 4; i < m.length; i++) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(m[i]).openConnection();
                c.setRequestMethod("HEAD");
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(10000);
                c.setReadTimeout(10000);
                int code = c.getResponseCode();
                if (code >= 200 && code < 400) return m[i];
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.disconnect();
            }
        }
        return null;
    }

    /** Download starten. Liefert null bei Erfolg, sonst eine Fehlermeldung. */
    String download(String id) {
        String[] m = find(id);
        if (m == null) return "Unbekanntes Modell.";
        double needGb = Double.parseDouble(m[2]) + 0.5;
        if (dir().getUsableSpace() / 1e9 < needGb) return "Nicht genug freier Speicher (" + m[2] + " GB nötig).";
        String url = reachable(m);
        if (url == null) return "Die Modell-Datei ist gerade nicht erreichbar. Bitte später noch einmal versuchen.";
        File f = file(id);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
        DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url))
                .setTitle("Jarvis: " + m[1])
                .setDescription("Eigene KI für Jarvis (" + m[2] + " GB)")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationUri(Uri.fromFile(f))
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(false);
        long dl = dm().enqueue(r);
        prefs.edit().putLong("dl_" + id, dl).apply();
        return null;
    }

    void delete(String id) {
        long dl = prefs.getLong("dl_" + id, -1);
        if (dl >= 0) { try { dm().remove(dl); } catch (Exception ignored) { } }
        prefs.edit().remove("dl_" + id).apply();
        if (id.equals(loaded)) { nativeUnload(); loaded = null; }
        //noinspection ResultOfMethodCallIgnored
        file(id).delete();
    }

    /** Modell laden (dauert einige Sekunden). Liefert null bei Erfolg, sonst Fehlermeldung. */
    synchronized String ensureLoaded(String id) {
        if (id.equals(loaded)) return null;
        if (!installed(id)) return "Das Modell ist noch nicht heruntergeladen. Einstellungen → KI & Modelle → Eigene KI.";
        loading = true;
        try {
            if (loaded != null) { nativeUnload(); loaded = null; }
            int threads = Math.max(2, Math.min(6, Runtime.getRuntime().availableProcessors() - 2));
            boolean ok = nativeLoad(file(id).getAbsolutePath(), 4096, threads);
            if (!ok) return nativeError();
            loaded = id;
            return null;
        } finally {
            loading = false;
        }
    }
}
