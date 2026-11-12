package de.agmaz.jarvis;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.FloatBuffer;
import java.util.Collections;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

/**
 * Hört im Hintergrund auf „Hey Jarvis“ (openWakeWord, läuft komplett offline auf dem Handy).
 * Erkennt es das Wort, holt es Jarvis nach vorn (auch über dem Sperrbildschirm) und Jarvis hört zu.
 * Solange Jarvis selbst offen ist, pausiert der Dienst (das Mikrofon gehört dann der App).
 */
public class WakeService extends Service {
    static final String CH = "jarvis_wake";
    static final int NOTI = 77;
    static volatile boolean running = false;
    static volatile boolean appVisible = false;
    static volatile float lastScore = 0;

    private volatile boolean stop = false;
    private Thread worker;

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("wake", MODE_PRIVATE); }

    static boolean enabled(Context c) { return prefs(c).getBoolean("on", false); }

    static void configure(Context c, boolean on, float threshold) {
        prefs(c).edit().putBoolean("on", on).putFloat("thr", threshold).apply();
        if (on) start(c); else c.stopService(new Intent(c, WakeService.class));
    }

    static void start(Context c) {
        if (!enabled(c)) return;
        if (c.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return;
        Intent i = new Intent(c, WakeService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Exception ignored) {
            // Android erlaubt den Start eines Mikrofon-Dienstes nur, während die App sichtbar ist
        }
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) {
            prefs(this).edit().putBoolean("on", false).apply();
            stopSelf();
            return START_NOT_STICKY;
        }
        startFg();
        if (worker == null || !worker.isAlive()) {
            stop = false;
            worker = new Thread(this::loop, "jarvis-wake");
            worker.start();
        }
        return START_STICKY;
    }

    private void startFg() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH) == null) {
            nm.createNotificationChannel(new NotificationChannel(CH, "„Hey Jarvis“ im Hintergrund", NotificationManager.IMPORTANCE_LOW));
        }
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent off = PendingIntent.getService(this, 1, new Intent(this, WakeService.class).setAction("stop"), PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("Jarvis hört auf „Hey Jarvis“")
                .setContentText("Tippen zum Öffnen")
                .setOngoing(true)
                .setContentIntent(open)
                .addAction(new Notification.Action.Builder(null, "Ausschalten", off).build());
        Notification n = b.build();
        if (Build.VERSION.SDK_INT >= 30) startForeground(NOTI, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        else startForeground(NOTI, n);
    }

    private byte[] asset(String name) throws Exception {
        try (InputStream in = getAssets().open(name); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private void loop() {
        running = true;
        OrtEnvironment env = OrtEnvironment.getEnvironment();
        OrtSession mel = null, emb = null, kw = null;
        AudioRecord rec = null;
        try {
            OrtSession.SessionOptions so = new OrtSession.SessionOptions();
            so.setIntraOpNumThreads(1);
            mel = env.createSession(asset("oww/melspectrogram.onnx"), so);
            emb = env.createSession(asset("oww/embedding_model.onnx"), so);
            kw = env.createSession(asset("oww/hey_jarvis_v0.1.onnx"), so);

            final int CHUNK = 1280, CTX = 480;
            float[] raw = new float[CHUNK + CTX];
            float[][] melBuf = new float[76][32];
            for (float[] r : melBuf) java.util.Arrays.fill(r, 1f);
            float[][] feats = new float[16][96];
            short[] pcm = new short[CHUNK];
            long cooldownUntil = 0;
            boolean recording = false;

            while (!stop) {
                // Jarvis ist offen: Mikrofon freigeben, warten
                if (appVisible) {
                    if (recording) { rec.stop(); rec.release(); rec = null; recording = false; }
                    Thread.sleep(300);
                    continue;
                }
                if (!recording) {
                    int min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                    rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000, AudioFormat.CHANNEL_IN_MONO,
                            AudioFormat.ENCODING_PCM_16BIT, Math.max(min, CHUNK * 4));
                    if (rec.getState() != AudioRecord.STATE_INITIALIZED) { rec.release(); rec = null; Thread.sleep(2000); continue; }
                    rec.startRecording();
                    recording = true;
                    for (float[] f : feats) java.util.Arrays.fill(f, 0f);
                }
                int got = 0;
                while (got < CHUNK && !stop && !appVisible) {
                    int n = rec.read(pcm, got, CHUNK - got);
                    if (n <= 0) break;
                    got += n;
                }
                if (got < CHUNK) continue;

                // 1) Rohdaten nachschieben (letzte 480 Werte als Überlappung)
                System.arraycopy(raw, CHUNK, raw, 0, CTX);
                for (int i = 0; i < CHUNK; i++) raw[CTX + i] = pcm[i];
                // 2) Mel-Spektrogramm
                float[][][][] m;
                try (OnnxTensor t = OnnxTensor.createTensor(env, FloatBuffer.wrap(raw), new long[]{1, raw.length});
                     OrtSession.Result r = mel.run(Collections.singletonMap("input", t))) {
                    m = (float[][][][]) r.get(0).getValue();
                }
                float[][] frames = m[0][0];
                for (float[] f : frames) {
                    System.arraycopy(melBuf, 1, melBuf, 0, 75);
                    float[] row = new float[32];
                    for (int k = 0; k < 32; k++) row[k] = f[k] / 10f + 2f;
                    melBuf[75] = row;
                }
                // 3) Einbettung der letzten 76 Mel-Zeilen
                float[] flat = new float[76 * 32];
                for (int i = 0; i < 76; i++) System.arraycopy(melBuf[i], 0, flat, i * 32, 32);
                float[] e;
                try (OnnxTensor t = OnnxTensor.createTensor(env, FloatBuffer.wrap(flat), new long[]{1, 76, 32, 1});
                     OrtSession.Result r = emb.run(Collections.singletonMap("input_1", t))) {
                    e = ((float[][][][]) r.get(0).getValue())[0][0][0];
                }
                System.arraycopy(feats, 1, feats, 0, 15);
                feats[15] = e.clone();
                // 4) „Hey Jarvis“-Erkennung
                float[] fl = new float[16 * 96];
                for (int i = 0; i < 16; i++) System.arraycopy(feats[i], 0, fl, i * 96, 96);
                float score;
                try (OnnxTensor t = OnnxTensor.createTensor(env, FloatBuffer.wrap(fl), new long[]{1, 16, 96});
                     OrtSession.Result r = kw.run(Collections.singletonMap("x.1", t))) {
                    score = ((float[][]) r.get(0).getValue())[0][0];
                }
                lastScore = score;
                float thr = prefs(this).getFloat("thr", 0.45f);
                long now = System.currentTimeMillis();
                if (score >= thr && now > cooldownUntil) {
                    cooldownUntil = now + 4000;
                    rec.stop(); rec.release(); rec = null; recording = false;
                    wake();
                    Thread.sleep(1500);
                }
            }
        } catch (InterruptedException ignored) {
        } catch (Throwable t) {
            android.util.Log.e("JarvisWake", "Fehler", t);
        } finally {
            if (rec != null) { try { rec.stop(); } catch (Exception ignored) { } rec.release(); }
            try { if (mel != null) mel.close(); if (emb != null) emb.close(); if (kw != null) kw.close(); } catch (Exception ignored) { }
            running = false;
        }
    }

    /** Jarvis nach vorn holen und zuhören lassen. */
    private void wake() {
        appVisible = true;   // bis die App selbst meldet, dass sie wieder weg ist
        Intent i = new Intent(this, MainActivity.class)
                .setAction("de.agmaz.jarvis.WAKE")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try {
            startActivity(i);
        } catch (Exception e) {
            appVisible = false;
        }
        if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(this)) {
            // Ohne „Über anderen Apps einblenden“ darf Android Jarvis nicht aus dem Hintergrund öffnen: dann per Benachrichtigung
            NotificationManager nm = getSystemService(NotificationManager.class);
            PendingIntent pi = PendingIntent.getActivity(this, 2, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
            b.setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("Ja? Tippe hier").setContentText("Jarvis hat „Hey Jarvis“ gehört")
                    .setAutoCancel(true).setContentIntent(pi);
            nm.notify(NOTI + 1, b.build());
            appVisible = false;
        }
    }

    @Override
    public void onDestroy() {
        stop = true;
        if (worker != null) worker.interrupt();
        super.onDestroy();
    }
}
