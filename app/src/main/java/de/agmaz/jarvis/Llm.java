package de.agmaz.jarvis;

import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.Intent;

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

    boolean installed(String id) {
        File f = file(id);
        return f.exists() && f.length() > 200_000_000L && !(id.equals(DownloadService.id) && isBusy());
    }

    static boolean isBusy() {
        String st = DownloadService.state;
        return "connecting".equals(st) || "running".equals(st) || "retry".equals(st);
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
                if (!inst && m[0].equals(DownloadService.id)) {
                    String st = DownloadService.state;
                    j.put("downloading", isBusy());
                    j.put("state", st);
                    j.put("paused", "retry".equals(st));
                    j.put("failed", "failed".equals(st));
                    j.put("error", DownloadService.error);
                    j.put("done", DownloadService.done);
                    j.put("total", DownloadService.total);
                    j.put("bps", DownloadService.bps);
                } else if (!inst) {
                    File part = new File(file(m[0]).getPath() + ".part");
                    if (part.exists() && part.length() > 0) j.put("partial", part.length());
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

    /** Download starten. Liefert null bei Erfolg, sonst eine Fehlermeldung. */
    String download(String id) {
        String[] m = find(id);
        if (m == null) return "Unbekanntes Modell.";
        if (isBusy()) return "Es läuft schon ein Download.";
        double needGb = Double.parseDouble(m[2]) + 0.5;
        if (dir().getUsableSpace() / 1e9 < needGb) return "Nicht genug freier Speicher (" + m[2] + " GB nötig).";
        // alte Downloads über den Android-Downloader aufräumen (frühere Versionen)
        long old = prefs.getLong("dl_" + id, -1);
        if (old >= 0) {
            try { ((DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE)).remove(old); } catch (Exception ignored) { }
            prefs.edit().remove("dl_" + id).apply();
        }
        Intent i = new Intent(ctx, DownloadService.class).putExtra("id", id);
        if (android.os.Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
        return null;
    }

    void delete(String id) {
        if (id.equals(DownloadService.id) && isBusy()) DownloadService.cancel = true;
        long old = prefs.getLong("dl_" + id, -1);
        if (old >= 0) {
            try { ((DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE)).remove(old); } catch (Exception ignored) { }
            prefs.edit().remove("dl_" + id).apply();
        }
        if (id.equals(loaded)) { nativeUnload(); loaded = null; }
        //noinspection ResultOfMethodCallIgnored
        file(id).delete();
        //noinspection ResultOfMethodCallIgnored
        new File(file(id).getPath() + ".part").delete();
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
