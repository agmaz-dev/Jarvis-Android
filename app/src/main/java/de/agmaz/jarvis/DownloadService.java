package de.agmaz.jarvis;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import java.io.File;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Lädt die Modell-Datei selbst herunter (mit Fortsetzen nach Abbruch) und zeigt den Fortschritt
 * in einer Benachrichtigung. Läuft weiter, auch wenn Jarvis im Hintergrund ist.
 */
public class DownloadService extends Service {
    static final String CH = "jarvis_download";
    static final int NOTI = 42;

    // Zustand für die Oberfläche (ein Download gleichzeitig)
    static volatile String id = null;
    static volatile long done = 0, total = 0;
    static volatile String state = "idle";   // idle | connecting | running | retry | done | failed | cancelled
    static volatile String error = "";
    static volatile boolean cancel = false;
    static volatile double bps = 0;

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        final String mid = intent == null ? null : intent.getStringExtra("id");
        if (mid == null || (id != null && ("running".equals(state) || "connecting".equals(state) || "retry".equals(state)))) {
            return START_NOT_STICKY;
        }
        id = mid;
        done = 0; total = 0; error = ""; cancel = false; bps = 0;
        state = "connecting";
        startFg("Verbinde …", 0, 0);
        new Thread(() -> run(mid), "jarvis-download").start();
        return START_NOT_STICKY;
    }

    private void startFg(String text, int max, int prog) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null) {
            NotificationChannel c = new NotificationChannel(CH, "Downloads", NotificationManager.IMPORTANCE_LOW);
            nm.createNotificationChannel(c);
        }
        Notification n = build(text, max, prog);
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTI, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(NOTI, n);
    }

    private Notification build(String text, int max, int prog) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE);
        String[] m = Llm.find(id == null ? "" : id);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle("Jarvis: " + (m != null ? m[1] : "Modell"))
                .setContentText(text)
                .setOnlyAlertOnce(true)
                .setOngoing(true)
                .setContentIntent(pi);
        if (max > 0) b.setProgress(max, prog, false); else b.setProgress(0, 0, true);
        return b.build();
    }

    private void notify(String text, int max, int prog) {
        try { getSystemService(NotificationManager.class).notify(NOTI, build(text, max, prog)); } catch (Exception ignored) { }
    }

    private void finish(String msg) {
        stopForeground(true);
        if (msg != null) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
            b.setSmallIcon(android.R.drawable.stat_sys_download_done).setContentTitle("Jarvis").setContentText(msg).setAutoCancel(true);
            nm.notify(NOTI + 1, b.build());
        }
        stopSelf();
    }

    private void run(String mid) {
        String[] m = Llm.find(mid);
        Llm llm = new Llm(this);
        File out = llm.file(mid), part = new File(out.getPath() + ".part");
        if (m == null) { state = "failed"; error = "Unbekanntes Modell."; finish(null); return; }
        int attempt = 0;
        while (!cancel) {
            attempt++;
            // abwechselnd die hinterlegten Adressen probieren
            String url = m[4 + ((attempt - 1) % (m.length - 4))];
            HttpURLConnection c = null;
            try {
                long have = part.exists() ? part.length() : 0;
                c = open(url, have);
                int code = c.getResponseCode();
                if (code == 416) { // schon komplett
                    if (part.renameTo(out)) { state = "done"; finish("Download fertig."); return; }
                }
                if (code != 200 && code != 206) throw new Exception("Server antwortet mit HTTP " + code);
                if (code == 200 && have > 0) have = 0;   // Server kann nicht fortsetzen: neu beginnen
                long len = c.getContentLengthLong();
                total = len > 0 ? have + len : (long) (Double.parseDouble(m[2]) * 1e9);
                done = have;
                state = "running";
                error = "";
                try (InputStream in = c.getInputStream(); RandomAccessFile raf = new RandomAccessFile(part, "rw")) {
                    if (have == 0) raf.setLength(0);
                    raf.seek(have);
                    byte[] buf = new byte[1 << 20];
                    long lastT = System.currentTimeMillis(), lastD = done;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        if (cancel) break;
                        raf.write(buf, 0, n);
                        done += n;
                        long now = System.currentTimeMillis();
                        if (now - lastT >= 1000) {
                            double r = (done - lastD) * 1000.0 / (now - lastT);
                            bps = bps == 0 ? r : bps * 0.7 + r * 0.3;
                            lastT = now; lastD = done;
                            int pct = (int) (100 * done / Math.max(1, total));
                            notify(pct + " % · " + String.format(java.util.Locale.GERMANY, "%.1f von %.1f GB", done / 1e9, total / 1e9), 100, pct);
                        }
                    }
                }
                if (cancel) break;
                if (len > 0 && done < have + len) throw new Exception("Verbindung abgebrochen");
                //noinspection ResultOfMethodCallIgnored
                out.delete();
                if (!part.renameTo(out)) throw new Exception("Datei konnte nicht gespeichert werden");
                state = "done";
                finish("Download fertig – die eigene KI ist bereit.");
                return;
            } catch (Exception e) {
                if (cancel) break;
                error = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                if (attempt >= 8) {
                    state = "failed";
                    finish("Download fehlgeschlagen: " + error);
                    return;
                }
                state = "retry";
                notify("Neuer Versuch in " + Math.min(60, attempt * 10) + " s (" + error + ")", 0, 0);
                try { Thread.sleep(Math.min(60, attempt * 10) * 1000L); } catch (InterruptedException ignored) { }
            } finally {
                if (c != null) c.disconnect();
            }
        }
        state = "cancelled";
        //noinspection ResultOfMethodCallIgnored
        part.delete();
        finish(null);
    }

    /** Öffnet die Verbindung und folgt Weiterleitungen selbst (Hugging Face leitet auf einen Download-Server um). */
    private static HttpURLConnection open(String url, long from) throws Exception {
        for (int hop = 0; hop < 8; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(20000);
            c.setReadTimeout(60000);
            c.setRequestProperty("User-Agent", MainActivity.BROWSER_UA);
            c.setRequestProperty("Accept-Encoding", "identity");
            if (from > 0) c.setRequestProperty("Range", "bytes=" + from + "-");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new Exception("Weiterleitung ohne Ziel");
                url = new URL(new URL(url), loc).toString();
                continue;
            }
            return c;
        }
        throw new Exception("Zu viele Weiterleitungen");
    }
}
