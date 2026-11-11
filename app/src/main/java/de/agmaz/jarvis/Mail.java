package de.agmaz.jarvis;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Date;
import java.util.Locale;
import java.util.Properties;

import javax.mail.Address;
import javax.mail.BodyPart;
import javax.mail.Flags;
import javax.mail.Folder;
import javax.mail.Message;
import javax.mail.Multipart;
import javax.mail.Part;
import javax.mail.Session;
import javax.mail.Store;
import javax.mail.Transport;
import javax.mail.UIDFolder;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;
import javax.mail.internet.MimeUtility;
import javax.mail.search.FlagTerm;

/**
 * E-Mail über IMAP (lesen) und SMTP (senden) mit App-Passwort.
 * Gmail, Yahoo, GMX, web.de, T-Online, iCloud werden anhand der Adresse erkannt.
 */
public class Mail {

    static String[] servers(String address) {
        String d = address.substring(address.indexOf('@') + 1).toLowerCase(Locale.ROOT);
        if (d.equals("gmail.com") || d.equals("googlemail.com")) return new String[]{"imap.gmail.com", "smtp.gmail.com"};
        if (d.startsWith("yahoo.") || d.equals("ymail.com") || d.equals("rocketmail.com")) return new String[]{"imap.mail.yahoo.com", "smtp.mail.yahoo.com"};
        if (d.equals("gmx.de") || d.equals("gmx.net") || d.equals("gmx.at") || d.equals("gmx.ch")) return new String[]{"imap.gmx.net", "mail.gmx.net"};
        if (d.equals("web.de")) return new String[]{"imap.web.de", "smtp.web.de"};
        if (d.equals("t-online.de")) return new String[]{"secureimap.t-online.de", "securesmtp.t-online.de"};
        if (d.equals("icloud.com") || d.equals("me.com") || d.equals("mac.com")) return new String[]{"imap.mail.me.com", "smtp.mail.me.com"};
        if (d.equals("outlook.com") || d.equals("hotmail.com") || d.equals("hotmail.de") || d.equals("live.com") || d.equals("outlook.de"))
            return new String[]{"outlook.office365.com", "smtp-mail.outlook.com"};
        return new String[]{"imap." + d, "smtp." + d};
    }

    private static Store connect(String user, String pass) throws Exception {
        Properties p = new Properties();
        p.put("mail.store.protocol", "imaps");
        p.put("mail.imaps.connectiontimeout", "15000");
        p.put("mail.imaps.timeout", "20000");
        Session s = Session.getInstance(p);
        Store st = s.getStore("imaps");
        st.connect(servers(user)[0], 993, user, pass);
        return st;
    }

    private static String addr(Address[] a) {
        if (a == null || a.length == 0) return "";
        if (a[0] instanceof InternetAddress) {
            InternetAddress ia = (InternetAddress) a[0];
            String n = ia.getPersonal();
            return (n != null && !n.isEmpty() ? n + " <" + ia.getAddress() + ">" : ia.getAddress());
        }
        return a[0].toString();
    }

    /** Text einer Nachricht (bevorzugt Klartext, sonst HTML ohne Tags). */
    static String text(Part p) throws Exception {
        if (p.isMimeType("text/plain")) return String.valueOf(p.getContent());
        if (p.isMimeType("text/html")) {
            return String.valueOf(p.getContent())
                    .replaceAll("(?is)<(script|style)[^>]*>.*?</\\1>", " ")
                    .replaceAll("(?i)<br\\s*/?>|</p>|</div>|</tr>", "\n")
                    .replaceAll("<[^>]+>", " ")
                    .replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"")
                    .replaceAll("[ \\t]+", " ").replaceAll("\\n\\s*\\n+", "\n\n").trim();
        }
        if (p.isMimeType("multipart/*")) {
            Multipart mp = (Multipart) p.getContent();
            String html = null;
            for (int i = 0; i < mp.getCount(); i++) {
                BodyPart bp = mp.getBodyPart(i);
                if (Part.ATTACHMENT.equalsIgnoreCase(bp.getDisposition())) continue;
                if (bp.isMimeType("text/plain")) return String.valueOf(bp.getContent());
                String t = text(bp);
                if (t != null && !t.isEmpty() && html == null) html = t;
            }
            return html == null ? "" : html;
        }
        return "";
    }

    private static JSONArray attachments(Part p) throws Exception {
        JSONArray a = new JSONArray();
        if (p.isMimeType("multipart/*")) {
            Multipart mp = (Multipart) p.getContent();
            for (int i = 0; i < mp.getCount(); i++) {
                BodyPart bp = mp.getBodyPart(i);
                if (bp.getFileName() != null) a.put(MimeUtility.decodeText(bp.getFileName()));
                else if (bp.isMimeType("multipart/*")) {
                    JSONArray sub = attachments(bp);
                    for (int k = 0; k < sub.length(); k++) a.put(sub.get(k));
                }
            }
        }
        return a;
    }

    static String list(String user, String pass, int n, boolean unread) {
        JSONObject o = new JSONObject();
        Store st = null;
        try {
            st = connect(user, pass);
            Folder f = st.getFolder("INBOX");
            f.open(Folder.READ_ONLY);
            Message[] msgs = unread ? f.search(new FlagTerm(new Flags(Flags.Flag.SEEN), false)) : f.getMessages();
            UIDFolder uf = (UIDFolder) f;
            JSONArray arr = new JSONArray();
            int from = Math.max(0, msgs.length - n);
            for (int i = msgs.length - 1; i >= from; i--) {
                Message m = msgs[i];
                JSONObject j = new JSONObject();
                j.put("uid", uf.getUID(m));
                j.put("von", addr(m.getFrom()));
                j.put("betreff", m.getSubject() == null ? "(ohne Betreff)" : m.getSubject());
                Date d = m.getReceivedDate() != null ? m.getReceivedDate() : m.getSentDate();
                j.put("datum", d == null ? "" : new java.text.SimpleDateFormat("dd.MM. HH:mm", Locale.GERMANY).format(d));
                j.put("gelesen", m.isSet(Flags.Flag.SEEN));
                arr.put(j);
            }
            o.put("ok", true);
            o.put("mails", arr);
            o.put("ungelesen", f.getUnreadMessageCount());
            f.close(false);
        } catch (Exception e) {
            try { o.put("ok", false); o.put("fehler", fehler(e)); } catch (Exception ignored) { }
        } finally {
            try { if (st != null) st.close(); } catch (Exception ignored) { }
        }
        return o.toString();
    }

    static String read(String user, String pass, long uid) {
        JSONObject o = new JSONObject();
        Store st = null;
        try {
            st = connect(user, pass);
            Folder f = st.getFolder("INBOX");
            f.open(Folder.READ_WRITE);
            Message m = ((UIDFolder) f).getMessageByUID(uid);
            if (m == null) throw new Exception("E-Mail nicht gefunden");
            o.put("ok", true);
            o.put("uid", uid);
            o.put("von", addr(m.getFrom()));
            o.put("betreff", m.getSubject() == null ? "" : m.getSubject());
            String t = text(m);
            o.put("text", t.length() > 6000 ? t.substring(0, 6000) + " …" : t);
            o.put("anhaenge", attachments(m));
            m.setFlag(Flags.Flag.SEEN, true);
            f.close(false);
        } catch (Exception e) {
            try { o.put("ok", false); o.put("fehler", fehler(e)); } catch (Exception ignored) { }
        } finally {
            try { if (st != null) st.close(); } catch (Exception ignored) { }
        }
        return o.toString();
    }

    /** Senden; replyUid > 0 = Antwort auf diese Nachricht (Empfänger und Betreff kommen dann aus dem Original). */
    static String send(String user, String pass, String to, String subject, String body, long replyUid) {
        JSONObject o = new JSONObject();
        Store st = null;
        try {
            Properties p = new Properties();
            p.put("mail.smtp.auth", "true");
            p.put("mail.smtp.starttls.enable", "true");
            p.put("mail.smtp.starttls.required", "true");
            p.put("mail.smtp.host", servers(user)[1]);
            p.put("mail.smtp.port", "587");
            p.put("mail.smtp.connectiontimeout", "15000");
            p.put("mail.smtp.timeout", "20000");
            Session s = Session.getInstance(p);
            MimeMessage msg;
            if (replyUid > 0) {
                st = connect(user, pass);
                Folder f = st.getFolder("INBOX");
                f.open(Folder.READ_ONLY);
                Message orig = ((UIDFolder) f).getMessageByUID(replyUid);
                if (orig == null) throw new Exception("Original-E-Mail nicht gefunden");
                msg = (MimeMessage) orig.reply(false);
                msg.setText(body, "UTF-8");
            } else {
                msg = new MimeMessage(s);
                msg.setRecipients(Message.RecipientType.TO, InternetAddress.parse(to));
                msg.setSubject(subject == null ? "" : subject, "UTF-8");
                msg.setText(body, "UTF-8");
            }
            msg.setFrom(new InternetAddress(user));
            msg.setSentDate(new Date());
            Transport tr = s.getTransport("smtp");
            tr.connect(servers(user)[1], 587, user, pass);
            tr.sendMessage(msg, msg.getAllRecipients());
            tr.close();
            o.put("ok", true);
            o.put("an", addr(msg.getRecipients(Message.RecipientType.TO)));
        } catch (Exception e) {
            try { o.put("ok", false); o.put("fehler", fehler(e)); } catch (Exception ignored) { }
        } finally {
            try { if (st != null) st.close(); } catch (Exception ignored) { }
        }
        return o.toString();
    }

    static String fehler(Exception e) {
        String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        String l = m.toLowerCase(Locale.ROOT);
        if (l.contains("authenticat") || l.contains("invalid credentials") || l.contains("login") || l.contains("535"))
            return "Anmeldung abgelehnt (Server: „" + (m.length() > 160 ? m.substring(0, 160) : m).trim() + "“). Es funktioniert nur ein App-Passwort, nicht das normale Passwort.";
        if (l.contains("unknownhost") || l.contains("unable to resolve") || l.contains("timeout") || l.contains("connect"))
            return "Mail-Server nicht erreichbar. Besteht eine Internetverbindung?";
        return m.length() > 200 ? m.substring(0, 200) : m;
    }
}
