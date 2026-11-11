package de.agmaz.jarvis;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.net.Uri;
import android.provider.AlarmClock;
import android.provider.ContactsContract;
import android.telephony.SmsManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Aktionen auf dem Handy, die Jarvis ausführen kann. Alle liefern JSON {ok, msg, ...}. */
public class Actions {

    static String ok(String msg) { return res(true, msg); }
    static String fail(String msg) { return res(false, msg); }
    static String res(boolean ok, String msg) {
        try { return new JSONObject().put("ok", ok).put("msg", msg).toString(); } catch (Exception e) { return "{\"ok\":false}"; }
    }

    static String norm(String s) {
        String n = Normalizer.normalize(s == null ? "" : s.toLowerCase(Locale.GERMAN), Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        return n.replace("ß", "ss").replaceAll("[^a-z0-9 ]", " ").replaceAll("\\s+", " ").trim();
    }

    static boolean has(Activity a, String perm) { return a.checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED; }

    static String needPerm(Activity a, String perm, String what) {
        a.runOnUiThread(() -> a.requestPermissions(new String[]{perm}, 20));
        return fail("Ich brauche die Berechtigung für " + what + ". Bitte erlauben und den Befehl noch einmal sagen.");
    }

    // ---------------------------------------------------------------- Kontakte
    /** Sucht Kontakte nach Name; liefert Liste mit Telefonnummern und E-Mails. */
    static String contacts(Activity a, String name) {
        if (!has(a, Manifest.permission.READ_CONTACTS)) return needPerm(a, Manifest.permission.READ_CONTACTS, "deine Kontakte");
        String q = norm(name);
        if (q.isEmpty()) return fail("Kein Name angegeben.");
        JSONArray out = new JSONArray();
        ContentResolver cr = a.getContentResolver();
        List<String[]> hits = new ArrayList<>();
        try (Cursor c = cr.query(ContactsContract.Contacts.CONTENT_URI,
                new String[]{ContactsContract.Contacts._ID, ContactsContract.Contacts.DISPLAY_NAME_PRIMARY}, null, null, null)) {
            while (c != null && c.moveToNext()) {
                String id = c.getString(0), dn = c.getString(1);
                if (dn == null) continue;
                String n = norm(dn);
                int score = n.equals(q) ? 3 : (" " + n + " ").contains(" " + q + " ") ? 2 : n.contains(q) ? 1 : 0;
                if (score > 0) hits.add(new String[]{id, dn, String.valueOf(score)});
            }
        }
        hits.sort((x, y) -> Integer.parseInt(y[2]) - Integer.parseInt(x[2]));
        try {
            for (int i = 0; i < Math.min(5, hits.size()); i++) {
                String[] h = hits.get(i);
                JSONObject j = new JSONObject().put("name", h[1]);
                JSONArray phones = new JSONArray(), mails = new JSONArray();
                try (Cursor p = cr.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI, new String[]{ContactsContract.CommonDataKinds.Phone.NUMBER},
                        ContactsContract.CommonDataKinds.Phone.CONTACT_ID + "=?", new String[]{h[0]}, null)) {
                    while (p != null && p.moveToNext()) phones.put(p.getString(0));
                }
                try (Cursor e = cr.query(ContactsContract.CommonDataKinds.Email.CONTENT_URI, new String[]{ContactsContract.CommonDataKinds.Email.ADDRESS},
                        ContactsContract.CommonDataKinds.Email.CONTACT_ID + "=?", new String[]{h[0]}, null)) {
                    while (e != null && e.moveToNext()) mails.put(e.getString(0));
                }
                j.put("telefon", phones).put("email", mails);
                out.put(j);
            }
            return new JSONObject().put("ok", true).put("kontakte", out).toString();
        } catch (Exception e) {
            return fail("Kontakte konnten nicht gelesen werden.");
        }
    }

    // ---------------------------------------------------------------- Telefon / SMS / WhatsApp
    static String call(Activity a, String number) {
        Intent i;
        if (has(a, Manifest.permission.CALL_PHONE)) i = new Intent(Intent.ACTION_CALL, Uri.parse("tel:" + Uri.encode(number)));
        else {
            a.runOnUiThread(() -> a.requestPermissions(new String[]{Manifest.permission.CALL_PHONE}, 21));
            i = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(number)));
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        a.startActivity(i);
        return ok("Anruf an " + number + " gestartet.");
    }

    static String sms(Activity a, String number, String text) {
        if (!has(a, Manifest.permission.SEND_SMS)) return needPerm(a, Manifest.permission.SEND_SMS, "SMS");
        try {
            @SuppressWarnings("deprecation")
            SmsManager sm = android.os.Build.VERSION.SDK_INT >= 31 ? a.getSystemService(SmsManager.class) : SmsManager.getDefault();
            ArrayList<String> parts = sm.divideMessage(text);
            sm.sendMultipartTextMessage(number, null, parts, null, null);
            return ok("SMS an " + number + " gesendet.");
        } catch (Exception e) {
            return fail("SMS konnte nicht gesendet werden: " + e.getMessage());
        }
    }

    static String whatsapp(Activity a, String number, String text) {
        String digits = number.replaceAll("[^0-9+]", "");
        if (digits.startsWith("00")) digits = digits.substring(2);
        else if (digits.startsWith("+")) digits = digits.substring(1);
        else if (digits.startsWith("0")) digits = "49" + digits.substring(1);   // deutsche Nummer ohne Landesvorwahl
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/" + digits + "?text=" + Uri.encode(text == null ? "" : text)));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { a.startActivity(i); return ok("WhatsApp ist geöffnet, die Nachricht steht bereit. Tippe auf Senden."); }
        catch (Exception e) { return fail("WhatsApp ist nicht installiert."); }
    }

    // ---------------------------------------------------------------- Wecker / Timer
    static String alarm(Activity a, int h, int m, String label) {
        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM)
                .putExtra(AlarmClock.EXTRA_HOUR, h).putExtra(AlarmClock.EXTRA_MINUTES, m)
                .putExtra(AlarmClock.EXTRA_MESSAGE, label == null || label.isEmpty() ? "Jarvis" : label)
                .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { a.startActivity(i); return ok(String.format(Locale.GERMANY, "Wecker auf %d:%02d Uhr gestellt.", h, m)); }
        catch (Exception e) { return fail("Keine Wecker-App gefunden."); }
    }

    static String timer(Activity a, int seconds, String label) {
        Intent i = new Intent(AlarmClock.ACTION_SET_TIMER)
                .putExtra(AlarmClock.EXTRA_LENGTH, seconds)
                .putExtra(AlarmClock.EXTRA_MESSAGE, label == null || label.isEmpty() ? "Jarvis" : label)
                .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { a.startActivity(i); return ok("Timer gestellt."); }
        catch (Exception e) { return fail("Keine Uhr-App für Timer gefunden."); }
    }

    // ---------------------------------------------------------------- Navigation / Apps / Licht
    static String navigate(Activity a, String target) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=" + Uri.encode(target)));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { a.startActivity(i); return ok("Navigation nach " + target + " gestartet."); }
        catch (Exception e) {
            Intent w = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/dir/?api=1&destination=" + Uri.encode(target)));
            w.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            a.startActivity(w);
            return ok("Route nach " + target + " geöffnet.");
        }
    }

    /** Öffnet eine installierte App anhand ihres Namens. */
    static String openApp(Activity a, String name) {
        String q = norm(name);
        if (q.isEmpty()) return fail("Kein App-Name.");
        PackageManager pm = a.getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = pm.queryIntentActivities(main, 0);
        ResolveInfo best = null;
        int bestScore = 0;
        for (ResolveInfo ri : apps) {
            String label = norm(String.valueOf(ri.loadLabel(pm)));
            int sc = label.equals(q) ? 3 : label.startsWith(q) || q.startsWith(label) ? 2 : label.contains(q) ? 1 : 0;
            if (sc > bestScore) { bestScore = sc; best = ri; }
        }
        if (best == null) return fail("Keine App namens „" + name + "“ gefunden.");
        Intent i = pm.getLaunchIntentForPackage(best.activityInfo.packageName);
        if (i == null) return fail("Die App lässt sich nicht öffnen.");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        a.startActivity(i);
        return ok(String.valueOf(best.loadLabel(pm)) + " geöffnet.");
    }

    static String torch(Activity a, boolean on) {
        try {
            CameraManager cm = a.getSystemService(CameraManager.class);
            for (String id : cm.getCameraIdList()) {
                Boolean f = cm.getCameraCharacteristics(id).get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                if (Boolean.TRUE.equals(f)) { cm.setTorchMode(id, on); return ok(on ? "Taschenlampe an." : "Taschenlampe aus."); }
            }
            return fail("Keine Taschenlampe gefunden.");
        } catch (Exception e) {
            return fail("Taschenlampe nicht verfügbar.");
        }
    }
}
