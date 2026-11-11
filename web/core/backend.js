/* JARVIS · Android/Web-Edition · eingebauter "Server"
   Ersetzt server.py aus FreeJarvis (MIT, irgendwasmitIT): Alle /api/...-Aufrufe der Oberflächen werden hier im
   Browser bzw. in der App beantwortet. Einstellungen und Gedächtnis liegen im Speicher des Geräts (localStorage).
   In der Android-App laufen Netzwerk, Spracherkennung und Sprachausgabe über window.JarvisNative (ohne CORS-Grenzen,
   damit auch http://localhost:11434 zu Ollama auf dem Handy funktioniert). */
(function () {
  "use strict";
  const VERSION = "1.1-android";
  const NATIVE = window.JarvisNative || null;
  const SECRET = ["claude_key", "openai_key", "eleven_key", "ollama_key", "mail_passwort"];
  const MASK = "••••";
  const ANTHROPIC = "https://api.anthropic.com";

  const DEFAULTS = {
    name: "Jarvis", nutzer: "", persona: "",
    anbieter: "ollama", modell: "",
    ollama_url: "http://localhost:11434", ollama_key: "",
    claude_key: "", openai_key: "", openai_url: "https://api.openai.com/v1",
    websuche: true, antwortlaenge: "kurz",
    stimme: "browser", browser_stimme: "", tempo: 1.0, tonhoehe: 1.0, lautstaerke: 1.0,
    eleven_key: "", eleven_voice: "", eleven_modell: "eleven_multilingual_v2",
    mikro: "nach_antwort", weckwort_an: false, weckwort: "Jarvis", sprache: "de-DE",
    auto_merken: true, ort: "Berlin", briefing_beim_start: false, oberflaeche: "vortex",
    chat_sichtbar: true, sounds: true,
    internetsuche: true, suchmaschine: "google",
    mail_adresse: "", mail_passwort: "", aktionen_bestaetigen: true,
    strikt_lokal: false, privat_weiche: true, gedaechtnis_cloud: false, privat_woerter: "", lokal_modell: "",
    routinen: [
      { satz: "guten morgen", aktion: "briefing", wert: "" },
      { satz: "öffne youtube", aktion: "webseite", wert: "https://www.youtube.com" },
      { satz: "pause machen", aktion: "timer", wert: "15" }
    ]
  };
  const THEMES = {
    vortex: "/jarvis.html", nova: "/oberflaechen/nova.html", sphaeren: "/oberflaechen/sphaeren.html",
    aura: "/oberflaechen/aura.html", gitter: "/oberflaechen/gitter.html",
    begleiter: "/oberflaechen/begleiter.html", band: "/oberflaechen/band.html"
  };
  const THEME_WORDS = {
    vortex: "vortex", wirbel: "vortex", nova: "nova", orange: "nova", funken: "nova",
    "sphären": "sphaeren", sphaeren: "sphaeren", kugel: "sphaeren", aura: "aura", gitter: "gitter",
    lattice: "gitter", begleiter: "begleiter", companion: "begleiter", augen: "begleiter",
    band: "band", ribbon: "band", ring: "band"
  };
  const SITES = {
    youtube: "https://www.youtube.com", google: "https://www.google.com", twitch: "https://www.twitch.tv",
    github: "https://github.com", wikipedia: "https://de.wikipedia.org", gmail: "https://mail.google.com",
    netflix: "https://www.netflix.com", spotify: "https://open.spotify.com", amazon: "https://www.amazon.de",
    reddit: "https://www.reddit.com", maps: "https://maps.google.com", "google maps": "https://maps.google.com",
    wetter: "https://www.wetteronline.de", nachrichten: "https://www.tagesschau.de", tagesschau: "https://www.tagesschau.de"
  };

  /* ------------------------------------------------------------ Regex-Hilfe: \b wie in Python (mit Umlauten) */
  const WC = "[\\p{L}\\p{N}_]";
  const BND = `(?:(?<=${WC})(?!${WC})|(?<!${WC})(?=${WC}))`;
  function R(src, flags) { return new RegExp(src.split("\\b").join(BND), (flags || "") + "u"); }
  const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");

  /* ------------------------------------------------------------ Speicher */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem("jvb-" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("jvb-" + k, JSON.stringify(v)); } catch (e) { } }
  };
  const clone = o => JSON.parse(JSON.stringify(o));

  function loadSettings() {
    const s = clone(DEFAULTS), d = LS.get("settings", null);
    if (d && typeof d === "object") { for (const k of Object.keys(d)) { if (k in DEFAULTS) s[k] = d[k]; } }
    else LS.set("settings", s);
    return s;
  }
  function saveSettings(s) { LS.set("settings", s); }
  function publicSettings(s) {
    const out = clone(s);
    for (const k of SECRET) { const v = String(s[k] || ""); out[k] = v ? MASK + v.slice(-4) : ""; }
    return out;
  }
  function updateSettings(data) {
    const s = loadSettings();
    // Anbieter gewechselt ohne neues Modell: altes Modell passt nicht mehr (z. B. gpt-oss:20b von Ollama bei Groq)
    if (data && data.anbieter && data.anbieter !== s.anbieter && !("modell" in data)) s.modell = "";
    for (const [k, v0] of Object.entries(data || {})) {
      if (!(k in DEFAULTS)) continue;
      let v = v0;
      if (SECRET.includes(k)) { v = String(v || "").trim(); if (v.startsWith(MASK)) continue; if (k === "mail_passwort") v = v.replace(/\s+/g, ""); }
      const d = DEFAULTS[k];
      try {
        if (typeof d === "boolean") v = !!v;
        else if (typeof d === "number") { v = parseFloat(v); if (isNaN(v)) continue; v = Math.max(0.1, Math.min(3.0, v)); }
        else if (Array.isArray(d)) {
          if (!Array.isArray(v)) continue;
          v = v.filter(r => r && typeof r === "object" && String(r.satz || "").trim()).slice(0, 40)
            .map(r => ({ satz: String(r.satz || "").slice(0, 80).trim(), aktion: String(r.aktion || "sagen").slice(0, 20), wert: String(r.wert || "").slice(0, 400) }));
        } else v = String(v == null ? "" : v).slice(0, 4000).trim();
      } catch (e) { continue; }
      if (k === "ollama_url" || k === "openai_url") v = v.replace(/\/+$/, "");
      s[k] = v;
    }
    saveSettings(s);
    return s;
  }

  /* ------------------------------------------------------------ Gedächtnis */
  const memLoad = () => { const d = LS.get("memory", []); return Array.isArray(d) ? d : []; };
  const memSave = items => LS.set("memory", items);
  const norm = t => String(t || "").toLowerCase().replace(/[^a-z0-9äöüß ]/g, "").trim();
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const newId = () => Array.from({ length: 8 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

  function memAdd(text) {
    text = String(text || "").replace(/\s+/g, " ").trim().replace(/^[ .,:;-]+|[ .,:;-]+$/g, "").slice(0, 300);
    if (text.length < 3) return null;
    const items = memLoad(), n = norm(text);
    for (const it of items) if (norm(it.text) === n) return it;
    const it = { id: newId(), text: text[0].toUpperCase() + text.slice(1), datum: today() };
    items.push(it); memSave(items.slice(-300));
    return it;
  }
  function memDelete(mid, match) {
    const items = memLoad(); let keep;
    if (mid) keep = items.filter(i => i.id !== mid);
    else {
      const words = norm(match).split(/\s+/).filter(w => w.length > 2);
      if (!words.length) return 0;
      keep = items.filter(i => !words.every(w => norm(i.text).includes(w)));
    }
    memSave(keep);
    return items.length - keep.length;
  }
  function memText(limit) {
    limit = limit || 4000;
    const items = memLoad(), lines = []; let size = 0;
    for (let i = items.length - 1; i >= 0; i--) {
      const line = `- ${items[i].text || ""} (${items[i].datum || ""})`;
      size += line.length; if (size > limit) break; lines.unshift(line);
    }
    return lines.join("\n");
  }

  /* ------------------------------------------------------------ Netzwerk (nativ in der App, sonst fetch) */
  class KIError extends Error { }
  class HTTPError extends Error { constructor(code, text) { super("HTTP " + code); this.code = code; this.body = text; } }

  const NREQ = {}; let nreqId = 0;
  window.__jvNative = window.__jvNative || {};
  window.__jvNative.http = function (id, type, a, b) {
    const q = NREQ[id]; if (!q) return;
    if (type === "head") {
      let headers = {}; try { headers = JSON.parse(b || "{}"); } catch (e) { }
      const noBody = [101, 204, 205, 304].includes(a);
      const stream = noBody ? null : new ReadableStream({ start(c) { q.ctrl = c; }, cancel() { try { NATIVE.httpAbort(id); } catch (e) { } delete NREQ[id]; } });
      q.resolve(new Response(stream, { status: a >= 200 && a <= 599 ? a : 500, headers }));
      if (noBody) delete NREQ[id];
    } else if (type === "data") {
      if (q.ctrl) { const bin = atob(a), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); try { q.ctrl.enqueue(u); } catch (e) { } }
    } else if (type === "end") {
      if (q.ctrl) try { q.ctrl.close(); } catch (e) { }
      delete NREQ[id];
    } else if (type === "error") {
      const err = new TypeError(a || "Netzwerkfehler");
      if (q.ctrl) { try { q.ctrl.error(err); } catch (e) { } } else q.reject(err);
      delete NREQ[id];
    }
  };
  function nativeFetch(url, opt) {
    return new Promise((resolve, reject) => {
      const id = ++nreqId; NREQ[id] = { resolve, reject, ctrl: null };
      if (opt.signal) {
        if (opt.signal.aborted) { delete NREQ[id]; return reject(new DOMException("Abgebrochen", "AbortError")); }
        opt.signal.addEventListener("abort", () => {
          const q = NREQ[id]; try { NATIVE.httpAbort(id); } catch (e) { }
          if (q) { const er = new DOMException("Abgebrochen", "AbortError"); if (q.ctrl) { try { q.ctrl.error(er); } catch (e) { } } else q.reject(er); delete NREQ[id]; }
        });
      }
      NATIVE.httpRequest(id, JSON.stringify({ url, method: opt.method || "GET", headers: opt.headers || {}, body: opt.body == null ? null : opt.body, timeout: opt.timeout || 20000 }));
    });
  }
  const realFetch = window.fetch.bind(window);
  async function net(url, opt) {
    opt = opt || {};
    if (NATIVE && NATIVE.httpRequest) return nativeFetch(url, opt);
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), opt.timeout || 20000);
    if (opt.signal) opt.signal.addEventListener("abort", () => ctrl.abort());
    try {
      const r = await realFetch(url, { method: opt.method || "GET", headers: opt.headers || {}, body: opt.body == null ? undefined : opt.body, signal: ctrl.signal });
      return r;
    } finally { if (!opt.stream) clearTimeout(to); }
  }
  async function http(url, data, headers, timeout, signal, stream) {
    const h = Object.assign({}, data != null ? { "Content-Type": "application/json" } : {}, headers || {});
    const r = await net(url, { method: data != null ? "POST" : "GET", headers: h, body: data != null ? JSON.stringify(data) : null, timeout: (timeout || 20) * 1000, signal, stream });
    if (!r.ok) { let t = ""; try { t = await r.text(); } catch (e) { } throw new HTTPError(r.status, t); }
    return r;
  }
  async function getJson(url, headers, timeout) { const r = await http(url, null, headers, timeout || 10); return r.json(); }
  function httpErrorText(e) {
    try {
      const j = JSON.parse(e.body || "");
      if (j.error && typeof j.error === "object") return j.error.message || String(e.body).slice(0, 200);
      return String(j.error || j.message || j.detail || String(e.body).slice(0, 200));
    } catch (x) { return "HTTP " + (e.code || "?"); }
  }
  const CACHE = new Map();
  async function cached(key, sec, fn) {
    const hit = CACHE.get(key);
    if (hit && Date.now() - hit[0] < sec * 1000) return hit[1];
    const val = await fn(); CACHE.set(key, [Date.now(), val]); return val;
  }

  /* ------------------------------------------------------------ Anbieter */
  const isLocalUrl = u => /^(https?:\/\/)?(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]|[^/]*\.local(:|\/|$))/i.test(String(u || "").trim());
  const ollamaHdr = s => s.ollama_key ? { Authorization: "Bearer " + s.ollama_key } : {};
  const claudeHdr = s => Object.assign({ "x-api-key": s.claude_key || "", "anthropic-version": "2023-06-01" },
    NATIVE ? {} : { "anthropic-dangerous-direct-browser-access": "true" });

  async function ollamaModels(s) {
    try {
      const j = await getJson(s.ollama_url + "/api/tags", ollamaHdr(s), 4);
      const names = (j.models || []).map(m => m.name).filter(Boolean);
      const chat = names.filter(n => !/embed/i.test(n));
      if (!chat.length) return { ok: false, models: [], fehler: "Ollama läuft, aber es ist kein Sprachmodell installiert. Im Terminal: ollama pull llama3.2" };
      return { ok: true, models: chat };
    } catch (e) {
      if (e instanceof HTTPError) {
        if (e.code === 401 || e.code === 403) return { ok: false, models: [], fehler: "Ollama: Zugriff verweigert. Für Ollama Cloud den API-Schlüssel eintragen." };
        return { ok: false, models: [], fehler: "Ollama antwortet mit Fehler: " + httpErrorText(e) };
      }
      return { ok: false, models: [], fehler: `Ollama nicht erreichbar unter ${s.ollama_url}. Läuft Ollama (z. B. in Termux: ollama serve)?` };
    }
  }
  async function claudeModels(s) {
    const key = s.claude_key;
    if (!key) return { ok: false, models: [], fehler: "Kein Claude-Schlüssel eingetragen." };
    try {
      const ids = await cached("claude:" + key.slice(-6), 600, async () => {
        const j = await getJson(ANTHROPIC + "/v1/models?limit=100", claudeHdr(s), 8);
        return (j.data || []).map(m => m.id).filter(Boolean);
      });
      return { ok: !!ids.length, models: ids, fehler: ids.length ? "" : "Keine Modelle gefunden." };
    } catch (e) {
      if (e instanceof HTTPError) {
        let msg = httpErrorText(e);
        if (e.code === 401) msg = "Schlüssel ungültig (401). Bitte prüfen, ob er vollständig kopiert wurde.";
        return { ok: false, models: [], fehler: "Claude: " + msg };
      }
      return { ok: false, models: [], fehler: `Claude nicht erreichbar (${e.name || "Fehler"}).` };
    }
  }
  const NON_CHAT = /embed|tts|whisper|dall-e|moderation|audio|realtime|transcribe|image|davinci|babbage|search|computer-use|sora|orpheus|guard/i;
  async function openaiModels(s) {
    const base = s.openai_url || "", key = s.openai_key || "";
    if (!base) return { ok: false, models: [], fehler: "Keine Basis-Adresse eingetragen." };
    if (!key && !isLocalUrl(base)) return { ok: false, models: [], fehler: "Kein Schlüssel eingetragen." };
    try {
      const ids = await cached("openai:" + base + key.slice(-6), 600, async () => {
        const j = await getJson(base + "/models", key ? { Authorization: "Bearer " + key } : {}, 8);
        let ids = (j.data || []).map(m => m.id).filter(Boolean);
        ids = ids.filter(i => !NON_CHAT.test(i));   // nur Chat-Modelle anzeigen (auch bei Groq)
        return ids.sort();
      });
      return { ok: !!ids.length, models: ids, fehler: ids.length ? "" : "Keine Modelle gefunden." };
    } catch (e) {
      if (e instanceof HTTPError) return { ok: false, models: [], fehler: "API-Fehler: " + httpErrorText(e) };
      return { ok: false, models: [], fehler: `Nicht erreichbar: ${base} (${e.name || "Fehler"})` };
    }
  }
  /* ---- Eigene KI auf dem Handy (Gemma über llama.cpp in der App) */
  function llmStatus() {
    if (!(NATIVE && NATIVE.llmStatus)) return null;
    try { return JSON.parse(NATIVE.llmStatus()); } catch (e) { return null; }
  }
  async function handyModels() {
    const st = llmStatus();
    if (!st) return { ok: false, models: [], fehler: "Die eigene KI gibt es nur in der Android-App." };
    if (st.error) return { ok: false, models: [], fehler: st.error };
    const inst = (st.models || []).filter(m => m.installed && !m.crashed).map(m => m.id);
    if (!inst.length) {
      const dl = (st.models || []).find(m => m.downloading);
      return { ok: false, models: [], fehler: dl ? `${dl.name} wird gerade heruntergeladen (${dl.total > 0 ? Math.round(100 * dl.done / dl.total) : 0} %).` : "Noch kein Modell heruntergeladen: Einstellungen → KI & Modelle → Eigene KI." };
    }
    return { ok: true, models: inst };
  }
  const LLM = { h: null };
  window.__jvNative.llm = function (type, val) {
    if (type === "dl") { try { window.dispatchEvent(new CustomEvent("jv-llm-dl", { detail: val || "" })); } catch (e) { } return; }
    if (LLM.h) LLM.h(type, val);
  };
  async function* streamHandy(model, system, msgs, signal, onStatus) {
    if (!(NATIVE && NATIVE.llmGenerate)) throw new KIError("Die eigene KI gibt es nur in der Android-App.");
    const queue = []; let wake = null, done = false, err = "";
    const poke = () => { if (wake) { const w = wake; wake = null; w(); } };
    LLM.h = (type, val) => {
      if (type === "tok") queue.push(val);
      else if (type === "status" || type === "stats") { if (onStatus) onStatus(type === "stats" ? "stats:" + val : val); }
      else if (type === "done") { done = true; err = val || ""; }
      poke();
    };
    const ab = () => { try { NATIVE.llmStop(); } catch (e) { } poke(); };
    if (signal) signal.addEventListener("abort", ab);
    const s0 = loadSettings(), maxTok = s0.antwortlaenge === "ausfuehrlich" ? 700 : s0.antwortlaenge === "normal" ? 400 : 250;
    NATIVE.llmGenerate(JSON.stringify({ model, messages: [{ role: "system", content: system }].concat(msgs), max: maxTok, temp: 0.8 }));
    try {
      for (; ;) {
        while (queue.length) yield queue.shift();
        if (done) break;
        if (signal && signal.aborted) throw new DOMException("Abgebrochen", "AbortError");
        await new Promise(r => { wake = r; });
      }
    } finally { LLM.h = null; if (signal) signal.removeEventListener("abort", ab); }
    if (err) throw new KIError(err);
  }
  const MODEL_FN = { ollama: ollamaModels, claude: claudeModels, openai: openaiModels, handy: handyModels };
  async function allModels(s) {
    const out = {};
    await Promise.all(Object.entries(MODEL_FN).map(async ([k, fn]) => { out[k] = await fn(s); }));
    return out;
  }
  async function pickModel(s, models) {
    let a = s.anbieter; if (!MODEL_FN[a]) a = "ollama";
    const m = s.modell || "";
    let lst = models ? (models[a] || {}).models : null;
    if (m && (lst == null || lst.includes(m))) return [a, m];
    if (lst == null) lst = (await MODEL_FN[a](s)).models || [];
    if (a === "claude") { const pref = lst.filter(x => x.includes("sonnet")); const p = pref.length ? pref : lst; return [a, p[0] || ""]; }
    if (a === "openai") {   // gute Allround-Modelle bevorzugen statt alphabetisch das erste
      for (const want of ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "gpt-4o-mini", "gpt-oss", "llama", "qwen"]) {
        const hit = lst.find(x => x === want) || lst.find(x => x.includes(want)); if (hit) return [a, hit];
      }
    }
    return [a, lst[0] || ""];
  }

  /* ------------------------------------------------------------ System und Wetter */
  function dauer(sec) {
    sec = Math.floor(sec); const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
    if (d) return `${d} Tag${d > 1 ? "e" : ""} ${h} Std`;
    if (h) return `${h} Std ${m} Min`;
    return `${m} Min`;
  }
  function systemInfo() {
    let n = null;
    if (NATIVE && NATIVE.systemInfo) { try { n = JSON.parse(NATIVE.systemInfo()); } catch (e) { n = null; } }
    const s = { kerne: (n && n.kerne) || navigator.hardwareConcurrency || null, cpu: null, ram: null, ram_belegt: null, ram_gesamt: null, platte: null, platte_frei: null, laufzeit: null, akku: null };
    if (n) {
      if (n.ram_gesamt) { s.ram_gesamt = Math.round(n.ram_gesamt * 10) / 10; s.ram_belegt = Math.round((n.ram_gesamt - n.ram_frei) * 10) / 10; s.ram = Math.round(100 * (n.ram_gesamt - n.ram_frei) / n.ram_gesamt); }
      if (n.platte_gesamt) { s.platte = Math.round(100 * (n.platte_gesamt - n.platte_frei) / n.platte_gesamt); s.platte_frei = Math.round(n.platte_frei / 1e9); }
      if (n.laufzeit != null) s.laufzeit = dauer(n.laufzeit);
      if (n.akku != null && n.akku >= 0) s.akku = n.akku;
    }
    const warn = [];
    if (s.ram != null && s.ram >= 90) warn.push(`Arbeitsspeicher ${s.ram} Prozent`);
    if (s.platte != null && s.platte >= 95) warn.push(`Speicher ${s.platte} Prozent`);
    if (s.akku != null && s.akku <= 15) warn.push(`Akku nur noch ${s.akku} Prozent`);
    s.auffaellig = warn;
    return s;
  }
  const WMO = {
    0: ["klar", "sonne"], 1: ["überwiegend klar", "sonne"], 2: ["teils bewölkt", "wolkig"], 3: ["bedeckt", "bedeckt"],
    45: ["Nebel", "nebel"], 48: ["Nebel", "nebel"], 51: ["leichter Nieselregen", "regen"], 53: ["Nieselregen", "regen"],
    55: ["Nieselregen", "regen"], 56: ["gefrierender Nieselregen", "regen"], 57: ["gefrierender Nieselregen", "regen"],
    61: ["leichter Regen", "regen"], 63: ["Regen", "regen"], 65: ["starker Regen", "regen"], 66: ["gefrierender Regen", "regen"],
    67: ["gefrierender Regen", "regen"], 71: ["leichter Schneefall", "schnee"], 73: ["Schneefall", "schnee"],
    75: ["starker Schneefall", "schnee"], 77: ["Schneegriesel", "schnee"], 80: ["Regenschauer", "regen"],
    81: ["Regenschauer", "regen"], 82: ["heftige Regenschauer", "regen"], 85: ["Schneeschauer", "schnee"],
    86: ["Schneeschauer", "schnee"], 95: ["Gewitter", "gewitter"], 96: ["Gewitter mit Hagel", "gewitter"], 99: ["Gewitter mit Hagel", "gewitter"]
  };
  async function geocode(ort) {
    return cached("geo:" + ort.toLowerCase(), 86400, async () => {
      const q = new URLSearchParams({ name: ort, count: 1, language: "de", format: "json" });
      const j = await getJson("https://geocoding-api.open-meteo.com/v1/search?" + q, null, 8);
      const r = (j.results || [])[0];
      if (!r) throw new Error(`Ort '${ort}' nicht gefunden`);
      return [r.latitude, r.longitude, r.name || ort];
    });
  }
  async function wetter(s) {
    const ort = String(s.ort || "Berlin").trim();
    if (s.strikt_lokal) return { fehler: "Strikt lokal ist an, deshalb wird kein Wetter aus dem Internet geladen.", ort };
    try {
      return await cached("wetter:" + ort.toLowerCase(), 600, async () => {
        const [lat, lon, name] = await geocode(ort);
        const q = new URLSearchParams({
          latitude: lat, longitude: lon, current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day",
          daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max", timezone: "auto", forecast_days: 1
        });
        const j = await getJson("https://api.open-meteo.com/v1/forecast?" + q, null, 8);
        const c = j.current, d = j.daily || {};
        let [text, icon] = WMO[parseInt(c.weather_code)] || ["wechselhaft", "wolkig"];
        if (icon === "sonne" && !(c.is_day == null ? 1 : c.is_day)) icon = "mond";
        const first = k => (d[k] || [null])[0];
        return {
          ort: name, temp: Math.round(+c.temperature_2m), gefuehlt: Math.round(+c.apparent_temperature), text, icon,
          wind: Math.round(+(c.wind_speed_10m || 0)),
          tmax: first("temperature_2m_max") == null ? null : Math.round(first("temperature_2m_max")),
          tmin: first("temperature_2m_min") == null ? null : Math.round(first("temperature_2m_min")),
          regen: first("precipitation_probability_max"), quelle: "Open-Meteo"
        };
      });
    } catch (e) { return { fehler: String(e.message || e.name || "Fehler").slice(0, 160), ort }; }
  }
  function wetterSatz(w) {
    if (w.fehler) return `Wetter für ${w.ort}: nicht abrufbar (${w.fehler}). Sag ehrlich, dass das Wetter gerade nicht lädt.`;
    let t = `Wetter in ${w.ort} jetzt: ${w.temp} Grad (gefühlt ${w.gefuehlt}), ${w.text}, Wind ${w.wind} km/h`;
    if (w.tmax != null) t += `, heute ${w.tmin} bis ${w.tmax} Grad`;
    if (w.regen != null) t += `, Regenwahrscheinlichkeit bis ${w.regen} Prozent`;
    return t + ". Quelle: Open-Meteo.";
  }
  function systemSatz(si) {
    const p = (v, u) => v == null ? "nicht messbar" : `${v}${u}`;
    let t = `System jetzt: Arbeitsspeicher ${p(si.ram, " Prozent")}, Speicher ${p(si.platte, " Prozent belegt")}`;
    if (si.akku != null) t += `, Akku ${si.akku} Prozent`;
    t += `, Gerät läuft seit ${p(si.laufzeit, "")}. CPU-Auslastung ist auf diesem Gerät nicht messbar. `;
    return t + `Auffällig: ${si.auffaellig.length ? si.auffaellig.join(", ") : "nichts"}.`;
  }

  /* ------------------------------------------------------------ Internetsuche (Google im unsichtbaren Browser, sonst DuckDuckGo, Wikipedia) */
  const SUCHE_RE = R(String.raw`\b(such|suche|suchen|google|googel|googl|recherchier\w*|im internet|im netz|online nach|schau nach|nachschauen|aktuell\w*|neueste\w*|news|nachrichten|schlagzeilen)\b`);
  const BROWSER_UA = "Mozilla/5.0 (Linux; Android 15; SM-F966B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
  const SEARCH_CB = {}; let searchId = 0;
  window.__jvNative.search = function (id, json) { const f = SEARCH_CB[id]; if (f) { delete SEARCH_CB[id]; f(json); } };

  function sucheErlaubt(s) { return !!s.internetsuche && !s.strikt_lokal; }
  function suchText(u) {
    let q = u.replace(R(String.raw`^(hey\s+)?(jarvis|j\.a\.r\.v\.i\.s\.?)[,!. ]*`, "i"), "");
    q = q.replace(R(String.raw`\b(kannst du|könntest du|bitte|mal|für mich|mir)\b`, "gi"), " ");
    q = q.replace(R(String.raw`\b(such(e|en)?|google|googel|recherchier\w*|schau nach|nachschauen)\b(\s+(bei|auf|in|im)\s+(google|duckduckgo|internet|netz))?(\s+(nach|über|ob))?`, "gi"), " ");
    q = q.replace(R(String.raw`\b(im internet|im netz|bei google|auf google|online)\b`, "gi"), " ");
    return q.replace(/\s+/g, " ").replace(/^[\s,.:;!?-]+|[\s,.:;!?]+$/g, "").slice(0, 200) || u.slice(0, 200);
  }
  const decodeHtml = s => { const d = document.createElement("textarea"); d.innerHTML = s; return d.value; };
  async function getText(url, timeout) {
    const r = await net(url, { headers: { "User-Agent": BROWSER_UA, "Accept-Language": "de-DE,de;q=0.9,en;q=0.6", Accept: "text/html,application/json;q=0.9,*/*;q=0.8" }, timeout: (timeout || 10) * 1000 });
    if (!r.ok) throw new HTTPError(r.status, "");
    return r.text();
  }
  function googleNative(q) {
    return new Promise(res => {
      if (!(NATIVE && NATIVE.googleSearch)) return res(null);
      const id = "g" + (++searchId); const to = setTimeout(() => { delete SEARCH_CB[id]; res(null); }, 20000);
      SEARCH_CB[id] = j => { clearTimeout(to); let d = null; try { d = JSON.parse(j); } catch (e) { } res(d); };
      NATIVE.googleSearch(id, q);
    });
  }
  async function duckduckgo(q) {
    for (const base of ["https://html.duckduckgo.com/html/?kl=de-de&q=", "https://lite.duckduckgo.com/lite/?kl=de-de&q="]) {
      try {
        const html = await getText(base + encodeURIComponent(q), 10);
        const doc = new DOMParser().parseFromString(html, "text/html"), out = [];
        doc.querySelectorAll("a.result__a, a.result-link").forEach(a => {
          let href = a.getAttribute("href") || "";
          const m = /[?&]uddg=([^&]+)/.exec(href); if (m) href = decodeURIComponent(m[1]);
          if (href.startsWith("//")) href = "https:" + href;
          if (!/^https?:/.test(href) || /duckduckgo\.com\/y\.js|ad_provider/.test(href)) return;
          const box = a.closest(".result, tr"); let sn = "";
          const se = box && (box.querySelector(".result__snippet") || (box.nextElementSibling && box.nextElementSibling.querySelector(".result-snippet")));
          if (se) sn = se.textContent.trim();
          out.push({ title: a.textContent.trim(), url: href, snippet: sn });
        });
        if (out.length) return out.slice(0, 8);
      } catch (e) { }
    }
    return [];
  }
  async function wikipedia(q) {
    try {
      const u = "https://de.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=4&srsearch=" + encodeURIComponent(q);
      const j = JSON.parse(await getText(u, 8));
      return ((j.query || {}).search || []).map(x => ({ title: x.title, url: "https://de.wikipedia.org/wiki/" + encodeURIComponent(x.title.replace(/ /g, "_")), snippet: decodeHtml(String(x.snippet || "").replace(/<[^>]+>/g, "")) }));
    } catch (e) { return []; }
  }
  async function seitenText(url) {
    try {
      const html = await getText(url, 8);
      const doc = new DOMParser().parseFromString(html.slice(0, 1500000), "text/html");
      doc.querySelectorAll("script,style,noscript,svg,nav,header,footer,aside,form,iframe,button,[role=navigation],[aria-hidden=true]").forEach(n => n.remove());
      const main = doc.querySelector("article") || doc.querySelector("main") || doc.body;
      if (!main) return "";
      return (main.textContent || "").replace(/\s+/g, " ").trim().slice(0, 2500);
    } catch (e) { return ""; }
  }
  async function webSuche(q, s, emit, wunsch) {
    emit({ t: "action", typ: "suche", text: "Suche: " + q });
    let results = [], quelle = "";
    const order = wunsch === "duckduckgo" ? ["ddg", "wiki"] : wunsch === "google" ? ["google", "ddg", "wiki"]
      : s.suchmaschine === "duckduckgo" ? ["ddg", "google", "wiki"] : ["google", "ddg", "wiki"];
    for (const e of order) {
      if (e === "google") { const d = await googleNative(q); if (d && d.ok && d.results && d.results.length) { results = d.results; quelle = "Google"; } }
      else if (e === "ddg" && NATIVE) { results = await duckduckgo(q); quelle = "DuckDuckGo"; }
      else if (e === "wiki") { results = await wikipedia(q); quelle = "Wikipedia"; }
      if (results.length) break;
    }
    if (!results.length) return { quelle: "", results: [], ctx: `Internetsuche nach "${q}" hat nichts ergeben (keine Verbindung oder gesperrt). Sag das ehrlich und antworte, so gut du kannst, mit dem Hinweis, dass es nicht aktuell geprüft ist.` };
    results = results.filter((r, i) => results.findIndex(x => x.url === r.url) === i).slice(0, 6);
    const top = results.filter(r => !/youtube\.com|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com/.test(r.url)).slice(0, 3);
    const texts = await Promise.all(top.map(r => seitenText(r.url)));
    let ctx = `INTERNETSUCHE (${quelle}) nach "${q}", Stand ${new Date().toLocaleDateString("de-DE")}:\n`;
    results.forEach((r, i) => { ctx += `[${i + 1}] ${r.title} (${r.url})${r.snippet ? ": " + r.snippet : ""}\n`; });
    top.forEach((r, i) => { if (texts[i]) ctx += `\nINHALT von ${r.url}:\n${texts[i]}\n`; });
    ctx = ctx.slice(0, 9000) + "\nBeantworte die Frage mit diesen aktuellen Informationen. Nenne die wichtigste Quelle kurz in Worten (z. B. 'laut tagesschau.de'). Wenn sich die Quellen widersprechen oder nichts Passendes dabei ist, sag das.";
    emit({ t: "action", typ: "quellen", quelle, links: results.slice(0, 4).map(r => ({ title: r.title, url: r.url })) });
    return { quelle, results, ctx };
  }

  /* ------------------------------------------------------------ Werkzeuge: E-Mail und Handy-Aktionen (nur in der App) */
  const ACT_CB = {}; let actId = 0;
  window.__jvNative.act = function (id, json) {
    const f = ACT_CB[id]; if (!f) return; delete ACT_CB[id];
    let d; try { d = JSON.parse(json); } catch (e) { d = { ok: false, msg: "Antwort unlesbar" }; } f(d);
  };
  const HAS_ACT = !!(NATIVE && NATIVE.act);
  function nativeAct(name, args, timeoutMs) {
    return new Promise(res => {
      if (!HAS_ACT) return res({ ok: false, msg: "Das geht nur in der Android-App." });
      const id = "a" + (++actId);
      const to = setTimeout(() => { delete ACT_CB[id]; res({ ok: false, msg: "Zeitüberschreitung" }); }, timeoutMs || 60000);
      ACT_CB[id] = d => { clearTimeout(to); res(d); };
      NATIVE.act(id, name, JSON.stringify(args || {}));
    });
  }
  function mailCreds(s) {
    if (!s.mail_adresse || !s.mail_passwort) return null;
    return { user: s.mail_adresse, pass: s.mail_passwort };
  }
  const MAIL_FEHLT = "E-Mail ist noch nicht eingerichtet. Sag dem Nutzer: Einstellungen, Automation, E-Mail-Adresse und App-Passwort eintragen.";
  const istNummer = w => /^[+0-9][0-9 ()\/-]{5,}$/.test(String(w || "").trim());
  const istMail = w => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(w || "").trim());
  async function kontakt(wer, feld) {
    wer = String(wer || "").trim().replace(/^(an|bei|mit)\s+/i, "");
    if (feld === "telefon" && istNummer(wer)) return { ok: true, name: wer, wert: wer.replace(/[^0-9+]/g, "") };
    if (feld === "email" && istMail(wer)) return { ok: true, name: wer, wert: wer };
    const r = await nativeAct("kontakte", { name: wer });
    if (!r.ok) return { ok: false, msg: r.msg || "Kontakte nicht lesbar." };
    const hit = (r.kontakte || []).find(k => (k[feld] || []).length);
    if (!hit) return { ok: false, msg: (r.kontakte || []).length ? `Bei „${wer}“ ist keine ${feld === "email" ? "E-Mail-Adresse" : "Telefonnummer"} gespeichert.` : `Keinen Kontakt „${wer}“ gefunden.` };
    return { ok: true, name: hit.name, wert: hit[feld][0] };
  }
  function mailListe() { return LS.get("mails_last", []); }
  async function mailFinden(args, s) {
    let list = mailListe();
    const nr = parseInt(args.nr, 10);
    if (nr > 0 && list[nr - 1]) return list[nr - 1];
    const q = norm(args.von || args.betreff || args.suche || "");
    if (!list.length || q) {
      const c = mailCreds(s); if (!c) return null;
      const r = await nativeAct("mail_liste", Object.assign({ anzahl: 20, ungelesen: false }, c));
      if (r.ok) { list = r.mails || []; LS.set("mails_last", list); }
    }
    if (q) return list.find(m => norm(m.von + " " + m.betreff).includes(q)) || null;
    return list[0] || null;
  }
  // Ergebnis: { ctx } = Daten für eine zweite KI-Antwort, { say } = direkte Antwort, { confirm } = erst nachfragen
  async function werkzeug(a, s, emit) {
    const typ = a.typ || a.name || a.aktion;
    const ev = text => emit({ t: "action", typ: "status", text, leise: true });
    switch (typ) {
      case "mail_liste": {
        const c = mailCreds(s); if (!c) return { ctx: MAIL_FEHLT };
        ev("E-Mails werden abgerufen …");
        const ung = a.ungelesen !== false;
        const r = await nativeAct("mail_liste", Object.assign({ anzahl: Math.min(15, a.anzahl || (ung ? 8 : 5)), ungelesen: ung }, c));
        if (!r.ok) return { ctx: "E-Mail-Abruf fehlgeschlagen: " + (r.fehler || r.msg) + ". Sag das dem Nutzer." };
        LS.set("mails_last", r.mails || []);
        if (!(r.mails || []).length) return { ctx: ung ? "Es gibt keine ungelesenen E-Mails. Sag das kurz." : "Der Posteingang ist leer." };
        return {
          ctx: `E-MAILS (${ung ? "ungelesen" : "neueste"}, insgesamt ${r.ungelesen} ungelesen):\n` + r.mails.map((m, i) => `${i + 1}) von ${m.von} · „${m.betreff}“ · ${m.datum}`).join("\n") +
            "\nFasse kurz zusammen (Absender und Thema, wichtigste zuerst). Erwähne die Nummern, damit der Nutzer sagen kann: lies Nummer 2."
        };
      }
      case "mail_lesen": {
        const c = mailCreds(s); if (!c) return { ctx: MAIL_FEHLT };
        const m = await mailFinden(a, s);
        if (!m) return { ctx: "Diese E-Mail habe ich nicht gefunden. Sag das ehrlich." };
        ev("E-Mail wird geöffnet …");
        const r = await nativeAct("mail_lesen", Object.assign({ uid: m.uid }, c));
        if (!r.ok) return { ctx: "E-Mail konnte nicht geöffnet werden: " + (r.fehler || r.msg) };
        LS.set("mail_offen", { uid: r.uid, von: r.von, betreff: r.betreff });
        return {
          ctx: `E-MAIL von ${r.von}, Betreff „${r.betreff}“${(r.anhaenge || []).length ? ", Anhänge: " + r.anhaenge.join(", ") : ""}:\n${String(r.text || "").slice(0, 4000)}\n` +
            "Gib den Inhalt verständlich wieder (bei langen Mails zusammengefasst). Frag am Ende kurz, ob du antworten sollst."
        };
      }
      case "mail_senden": {
        const c = mailCreds(s); if (!c) return { ctx: MAIL_FEHLT };
        const k = await kontakt(a.an, "email");
        if (!k.ok) return { say: k.msg + " Nenn mir bitte die E-Mail-Adresse." };
        const args = { an: k.wert, betreff: a.betreff || "", text: a.text || "" };
        return { confirm: { name: "mail_senden", args, text: `E-Mail an ${k.name}${k.name !== k.wert ? " (" + k.wert + ")" : ""}, Betreff „${args.betreff}“: ${args.text}` } };
      }
      case "mail_antworten": {
        const c = mailCreds(s); if (!c) return { ctx: MAIL_FEHLT };
        let m = (a.nr || a.von) ? await mailFinden(a, s) : LS.get("mail_offen", null);
        if (!m) m = await mailFinden(a, s);
        if (!m) return { say: "Auf welche E-Mail soll ich antworten? Sag zum Beispiel: Antworte auf Nummer 1." };
        const args = { antwort_uid: m.uid, text: a.text || "" };
        return { confirm: { name: "mail_senden", args, text: `Antwort an ${m.von} zu „${m.betreff}“: ${args.text}` } };
      }
      case "sms": case "whatsapp": {
        const k = await kontakt(a.wer || a.an, "telefon");
        if (!k.ok) return { say: k.msg };
        const args = { nummer: k.wert, text: a.text || "" };
        if (typ === "whatsapp") { const r = await nativeAct("whatsapp", args); return { say: r.ok ? `WhatsApp an ${k.name} ist vorbereitet. Du musst nur noch auf Senden tippen.` : r.msg }; }
        return { confirm: { name: "sms", args, text: `SMS an ${k.name}: ${args.text}` } };
      }
      case "anrufen": {
        const k = await kontakt(a.wer || a.an, "telefon");
        if (!k.ok) return { say: k.msg };
        const r = await nativeAct("anrufen", { nummer: k.wert });
        return { say: r.ok ? `Ich rufe ${k.name} an.` : r.msg };
      }
      case "navigation": { const r = await nativeAct("navigation", { ziel: a.ziel || a.ort || "" }); return { say: r.ok ? `Route nach ${a.ziel || a.ort} ist gestartet.` : r.msg }; }
      case "app": { const r = await nativeAct("app", { name: a.name || a.app || "" }); return { say: r.msg, fail: !r.ok }; }
      case "taschenlampe": { const r = await nativeAct("taschenlampe", { an: a.an !== false }); return { say: r.msg }; }
      case "wecker": {
        const m = /(\d{1,2})(?:[:.](\d{2}))?/.exec(String(a.zeit || ""));
        if (!m) return { say: "Für wann soll ich den Wecker stellen?" };
        const r = await nativeAct("wecker", { h: +m[1], m: +(m[2] || 0), text: a.text || "" });
        return { say: r.msg };
      }
      case "timer": {
        const sek = Math.round((+a.minuten || 0) * 60 + (+a.sekunden || 0));
        if (!sek) return { say: "Wie lange soll der Timer laufen?" };
        const r = await nativeAct("timer", { sek, text: a.text || "" });
        return { say: r.ok ? `Timer über ${sek >= 60 ? Math.round(sek / 60) + " Minuten" : sek + " Sekunden"} läuft.` : r.msg };
      }
    }
    if (typ === "kalender_eintragen" || typ === "termin") {
      const d = parseDatum(a.datum);
      if (!d) return { say: "Für welchen Tag soll ich den Termin eintragen?" };
      const tm = /(\d{1,2})(?:[:.](\d{2}))?/.exec(String(a.zeit || ""));
      let start, ende, ganz = false;
      if (tm) { start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), +tm[1], +(tm[2] || 0)); ende = new Date(start.getTime() + (+a.dauer_min || 60) * 60000); }
      else { ganz = true; start = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); ende = new Date(start.getTime() + 86400000); }
      const titel = a.titel || a.text || "Termin";
      const r = await nativeAct("kalender_neu", { titel, start: start.getTime(), ende: ende.getTime(), ort: a.ort || "", ganztags: ganz });
      return { say: r.ok ? `Eingetragen: ${titel} am ${d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}${tm ? " um " + tm[1] + ":" + (tm[2] || "00") + " Uhr" : ""}.` : r.msg };
    }
    if (typ === "kalender_liste" || typ === "termine") {
      const d = parseDatum(a.datum || "heute") || new Date();
      const von = new Date(d.getFullYear(), d.getMonth(), d.getDate()), tage = Math.min(31, +a.tage || 1);
      const r = await nativeAct("kalender_liste", { von: von.getTime(), bis: von.getTime() + tage * 86400000 });
      if (!r.ok) return { say: r.msg };
      return { ctx: `KALENDER ab ${von.toLocaleDateString("de-DE")} (${tage} Tag${tage > 1 ? "e" : ""}):\n` + ((r.termine || []).map(t => `- ${t.beginn}${t.ende ? "–" + t.ende : ""}: ${t.titel}${t.ort ? " (" + t.ort + ")" : ""}`).join("\n") || "keine Termine") + "\nNenne die Termine kurz und natürlich." };
    }
    return { say: "Diese Aktion kenne ich nicht." };
  }
  // "heute", "morgen", "übermorgen", "samstag", "2026-11-14", "14.11."
  function parseDatum(x) {
    const t = String(x || "").toLowerCase().trim(), now = new Date(), base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!t) return null;
    if (/^heute/.test(t)) return base;
    if (/^übermorgen|^uebermorgen/.test(t)) return new Date(base.getTime() + 2 * 86400000);
    if (/^morgen/.test(t)) return new Date(base.getTime() + 86400000);
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = /^(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?/.exec(t);
    if (m) { let y = m[3] ? +m[3] : now.getFullYear(); if (y < 100) y += 2000; const d = new Date(y, +m[2] - 1, +m[1]); if (!m[3] && d < base) d.setFullYear(y + 1); return d; }
    const tage = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];
    const i = tage.findIndex(w => t.includes(w));
    if (i >= 0) { let diff = (i - base.getDay() + 7) % 7; if (diff === 0 || /nächst|naechst/.test(t)) diff = diff || 7; return new Date(base.getTime() + diff * 86400000); }
    return null;
  }
  async function ausfuehren(p, s) {
    if (p.name === "mail_senden") {
      const c = mailCreds(s); if (!c) return "E-Mail ist nicht eingerichtet.";
      const r = await nativeAct("mail_senden", Object.assign({}, p.args, c), 90000);
      return r.ok ? "Erledigt, die E-Mail ist gesendet." : "Senden fehlgeschlagen: " + (r.fehler || r.msg);
    }
    if (p.name === "sms") { const r = await nativeAct("sms", p.args); return r.ok ? "Erledigt, die SMS ist raus." : r.msg; }
    return "Unbekannte Aktion.";
  }
  // Häufige Befehle ohne KI erkennen (schneller und zuverlässiger, auch mit kleinen Modellen)
  function schnellbefehl(u, orig) {
    if (!HAS_ACT) return null;
    orig = orig || u;
    let m;
    if (R(String.raw`\b(lies|les|zeig|check|prüf|pruef|abrufen|hab ich|habe ich|gibt es|sind)\b`).test(u) && R(String.raw`\b(e-?mails?|mails?|posteingang|nachrichten im postfach)\b`).test(u)) {
      if ((m = R(String.raw`\b(nummer|nr\.?|mail)\s*(\d+)\b`).exec(u))) return { typ: "mail_lesen", nr: +m[2] };
      return { typ: "mail_liste", ungelesen: !R(String.raw`\b(alle|letzten|neuesten)\b`).test(u) };
    }
    if ((m = R(String.raw`\blies\b.*\b(nummer|nr\.?)\s*(\d+)\b`).exec(u))) return { typ: "mail_lesen", nr: +m[2] };
    if ((m = R(String.raw`\b(weck(e)? mich|wecker)\b.*?\b(?:um|auf|für)\s+(\d{1,2})(?:[:.]\s?(\d{2})|\s*uhr\s*(\d{1,2})?)?`).exec(u)))
      return { typ: "wecker", zeit: m[3] + ":" + (m[4] || m[5] || "00") };
    if ((m = R(String.raw`\bruf(e)?\s+(.+?)\s+an\b`, "i").exec(orig))) return { typ: "anrufen", wer: m[2] };
    if ((m = R(String.raw`\b(navigier\w*|fahr mich|bring mich|route|navi)\b\s*(mich\s+)?(zu[mr]?|nach|zur|zu)\s+(.+)$`, "i").exec(orig))) return { typ: "navigation", ziel: m[4].replace(/[.!?]+$/, "") };
    if (R(String.raw`\b(was (habe|hab) ich|termine?|kalender)\b`).test(u) && R(String.raw`\b(heute|morgen|übermorgen|diese woche|woche|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b`).test(u) && !R(String.raw`\b(trag|eintragen|erstell|leg)\w*`).test(u)) {
      const tag = (R(String.raw`\b(heute|übermorgen|morgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b`).exec(u) || ["heute"])[0];
      return { typ: "kalender_liste", datum: tag, tage: /woche/.test(u) ? 7 : 1 };
    }
    if (R(String.raw`\b(taschenlampe|blitzlicht)\b`).test(u)) return { typ: "taschenlampe", an: !R(String.raw`\b(aus|ausschalten|ausmachen)\b`).test(u) };
    if ((m = R(String.raw`^(?:hey\s+)?(?:jarvis[,!. ]*)?(?:bitte\s+)?(?:öffne|oeffne|starte)\s+(?:mir\s+)?(?:die\s+)?(?:app\s+)?(.+?)(?:\s+app)?[.!?]*$`, "i").exec(orig)) && !R(String.raw`https?://|\.(de|com|org|net)\b`).test(u))
      return { typ: "app", name: m[1] };
    return null;
  }
  const JA_RE = R(String.raw`^\s*(ja|jo|jep|jawohl|yes|okay|ok|klar|genau|passt|richtig|senden|sende|schick|abschicken|raus damit|mach|mach das|ja bitte|bitte senden)\b`, "i");
  const NEIN_RE = R(String.raw`^\s*(nein|nee|ne|nö|stopp|stop|abbrechen|abbruch|lass|lass es|nicht senden|vergiss|warte)\b`, "i");

  /* ------------------------------------------------------------ Befehle erkennen */
  const ZAHL = {
    ein: 1, eine: 1, einer: 1, einem: 1, zwei: 2, drei: 3, vier: 4, "fünf": 5, fuenf: 5, sechs: 6,
    sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, "zwölf": 12, "fünfzehn": 15, zwanzig: 20,
    "dreißig": 30, dreissig: 30, vierzig: 40, "fünfzig": 50, sechzig: 60, halbe: 0.5
  };
  const BRIEF_RE = R(String.raw`\b(bist du da|bist du wach|was geht ab|wach auf|aufwachen|briefing|lagebericht|status ?bericht|status bitte|guten morgen|moin|melde dich)\b`);
  const WETTER_RE = R(String.raw`wetter|regnet|regen|schnee|grad (draußen|draussen)|temperatur|draußen|draussen|regenschirm|jacke|sonnig|sonne scheint`);
  const SYS_RE = R(String.raw`\b(system|cpu|prozessor|arbeitsspeicher|ram|festplatte|auslastung|speicherplatz|rechner|handy|akku)\b`);
  const TIMER_RE = R(String.raw`(?:in|nach|für|auf)\s+(\d+(?:[.,]\d+)?|` + Object.keys(ZAHL).join("|") + String.raw`)\s*(sekunden?|sek|minuten?|min|stunden?|std)\b`);

  function parseTimer(u) {
    if (!R("erinner|timer|wecker|weck mich|stopp?uhr|countdown|sag mir bescheid|sag bescheid").test(u)) return null;
    const m = TIMER_RE.exec(u); if (!m) return null;
    const raw = m[1].replace(",", ".");
    let n = ZAHL[raw]; if (n == null) { n = parseFloat(raw); if (isNaN(n)) return null; }
    const unit = m[2];
    const sek = n * (/^(stunde|std)/.test(unit) ? 3600 : unit.startsWith("min") ? 60 : 1);
    if (!(sek >= 1 && sek <= 86400)) return null;
    let rest = u.slice(m.index + m[0].length).trim();
    rest = rest.replace(R(String.raw`^(an|daran|dass|das|zu|ans|mich|bitte)\s+`), "");
    rest = rest.replace(R(String.raw`^(dass|das|an)\s+`), "").trim().replace(/^[ .!?]+|[ .!?]+$/g, "");
    rest = rest.split(R(String.raw`\s+(?:und|dann)\s+(?:öffne|oeffne|mach|zeig|stell|sag|wechsel|merk|starte|such)\b`))[0].replace(/^[ ,.]+|[ ,.]+$/g, "");
    if (!rest) {
      const pre = u.slice(0, m.index).replace(R(String.raw`.*?(erinner[\p{L}\p{N}_]*\s+(mich\s+)?(an|daran)?)`, "g"), "").replace(/^[ ,.]+|[ ,.]+$/g, "");
      rest = pre && pre.length < 80 && !R("timer|weck|stell|countdown|stopp").test(pre) ? pre : "";
    }
    return { sek: Math.floor(sek), text: rest.slice(0, 120) || "Timer abgelaufen" };
  }
  function findUrl(u) {
    if (!R(String.raw`\b(öffne|oeffne|öffnen|mach .* auf|geh auf|gehe auf|zeig mir die seite|ruf .* auf|starte)\b`).test(u)) return null;
    const m = R(String.raw`(https?://\S+|\b[\w-]+\.(?:de|com|org|net|io|tv|eu|info)\b\S*)`).exec(u);
    if (m) { const url = m[1]; return { url: url.startsWith("http") ? url : "https://" + url, name: url }; }
    for (const name of Object.keys(SITES).sort((a, b) => b.length - a.length))
      if (R(String.raw`\b` + reEsc(name) + String.raw`\b`).test(u)) return { url: SITES[name], name: name.replace(/\b\w/g, c => c.toUpperCase()) };
    return null;
  }
  function merkText(t) {
    t = t.trim().replace(/^[ .!?]+|[ .!?]+$/g, "");
    const m = /^(?:dass|das)\s+([\s\S]*)$/i.exec(t);
    if (m) {
      let w = m[1].split(/\s+/).filter(Boolean);
      if (w.length >= 3) {
        const n = ["mein", "meine", "meinem", "meinen", "meiner", "dein", "deine", "unser", "unsere"].includes(w[0].toLowerCase()) ? 2 : 1;
        w = w.slice(0, n).concat([w[w.length - 1]], w.slice(n, -1));
      }
      t = w.join(" ");
    }
    return t;
  }

  async function route(u, s, orig) {
    orig = orig || u;
    const actions = [], ctx = []; let direct = null;
    for (const r of s.routinen || []) {
      const satz = norm(r.satz);
      if (satz && norm(u).includes(satz)) {
        const a = r.aktion, w = String(r.wert || "").trim();
        if (a === "briefing") u += " briefing";
        else if (a === "webseite" && w) {
          actions.push({ typ: "webseite", url: w.startsWith("http") ? w : "https://" + w, name: r.satz });
          ctx.push(`Die Webseite ${w} wird gerade geöffnet (Routine '${r.satz}'). Bestätige in einem kurzen Satz.`);
        } else if (a === "sagen" && w) direct = w;
        else if (a === "oberflaeche" && THEMES[w]) {
          actions.push({ typ: "oberflaeche", name: w, url: THEMES[w] });
          ctx.push(`Die Oberfläche wechselt gleich auf ${w}. Bestätige kurz.`);
        } else if (a === "timer") {
          const mins = parseFloat(w.replace(",", "."));
          if (!isNaN(mins)) {
            actions.push({ typ: "timer", sek: Math.floor(mins * 60), text: r.satz });
            ctx.push(`Ein Timer über ${w} Minuten läuft jetzt (Routine '${r.satz}'). Bestätige kurz.`);
          }
        }
        actions.push({ typ: "routine", satz: r.satz });
      }
    }
    let m = R(String.raw`\b(merk dir|merke dir|speicher dir|speichere dir|notier dir|notiere dir|vergiss nicht)\b[:,]?\s*(.+)`, "is").exec(orig);
    if (m) {
      const it = memAdd(merkText(m[2]));
      if (it) {
        actions.push({ typ: "gedaechtnis", aktion: "gespeichert", text: it.text });
        ctx.push(`Du hast gerade im Gedächtnis gespeichert: '${it.text}'. Bestätige kurz und natürlich.`);
      }
    }
    m = R(String.raw`\bvergiss\b\s+(?:bitte\s+)?(?:dass|das|die notiz)?\s*(.+)`).exec(u);
    if (m && !/vergiss nicht/.test(u)) {
      const n = memDelete(null, m[1]);
      actions.push({ typ: "gedaechtnis", aktion: "geloescht", text: m[1], anzahl: n });
      ctx.push(n ? `Du hast ${n} passende Notiz(en) aus dem Gedächtnis gelöscht.` : "Im Gedächtnis gab es dazu keine passende Notiz. Sag das ehrlich.");
    }
    const t = parseTimer(u);
    if (t) {
      actions.push(Object.assign({ typ: "timer" }, t));
      const mins = t.sek / 60;
      ctx.push(`Ein Timer läuft jetzt: ${t.sek >= 60 ? (+mins.toPrecision(6)) + " Minuten" : t.sek + " Sekunden"}, Erinnerungstext: '${t.text}'. Bestätige kurz.`);
    }
    const w = findUrl(u);
    if (w && !actions.some(a => a.typ === "webseite")) {
      actions.push(Object.assign({ typ: "webseite" }, w));
      ctx.push(`Die Webseite ${w.name} wird gerade geöffnet. Bestätige in einem kurzen Satz.`);
    }
    if (/oberfläche|oberflaeche|design|aussehen|skin|ansicht/.test(u)) {
      for (const [word, tid] of Object.entries(THEME_WORDS)) {
        if (R(String.raw`\b` + reEsc(word) + String.raw`\b`).test(u)) {
          actions.push({ typ: "oberflaeche", name: tid, url: THEMES[tid] });
          ctx.push(`Die Oberfläche wechselt gleich auf ${tid}. Bestätige kurz.`);
          break;
        }
      }
    }
    if (BRIEF_RE.test(u)) {
      const si = systemInfo(), we = await wetter(s);
      actions.push({ typ: "briefing", system: si, wetter: we });
      ctx.push("WECK-BRIEFING. Nutze nur diese echten Daten:\n" + systemSatz(si) + "\n" + wetterSatz(we) +
        "\nAblauf, locker gesprochen, ohne Aufzählungszeichen: 1) Sag, dass du da bist. Ist 'Auffällig' = nichts, sag " +
        "'dein System läuft sauber', sonst nenne das Auffällige. Nenne zwei der Werte. 2) Das Wetter in einem Satz. " +
        "3) 'Heute steht an': nur, was im GEDÄCHTNIS nach Termin, Vorhaben oder To-do klingt. Steht nichts drin, sag das " +
        "in einem Satz. 4) Kurze Frage, womit du helfen kannst. Höchstens sechs Sätze.");
    } else {
      if (WETTER_RE.test(u)) { const we = await wetter(s); actions.push({ typ: "wetter", wetter: we }); ctx.push(wetterSatz(we)); }
      if (SYS_RE.test(u)) { const si = systemInfo(); actions.push({ typ: "system", system: si }); ctx.push(systemSatz(si)); }
    }
    return [actions, ctx, direct];
  }

  /* ------------------------------------------------------------ Datenschutz */
  function istCloud(s, anbieter) {
    if (anbieter === "handy") return false;
    if (anbieter === "claude") return true;
    if (anbieter === "openai") return !isLocalUrl(s.openai_url);
    return !isLocalUrl(s.ollama_url);
  }
  function luhn(num) {
    const d = num.split("").map(Number).reverse();
    return d.reduce((acc, x, i) => acc + (i % 2 === 0 ? x : (x * 2 > 9 ? x * 2 - 9 : x * 2)), 0) % 10 === 0;
  }
  const PRIV_RE = [
    ["E-Mail-Adresse", R(String.raw`[\w.+-]+@[\w-]+\.[a-z]{2,}`, "i")],
    ["IBAN", R(String.raw`\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b`)],
    ["Adresse", R(String.raw`\b[A-ZÄÖÜa-zäöü][\wäöüß-]*(?:straße|strasse|str\.|weg|gasse|platz|allee|ring|damm|chaussee)\s+\d{1,4}\s?[a-z]?\b`, "i")],
    ["Postleitzahl", R(String.raw`\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß]{2,}`)],
    ["API-Schlüssel", R(String.raw`\b(?:sk|pk|gsk|xai)[-_][A-Za-z0-9_-]{12,}`)]
  ];
  const PHONE_RE = R(String.raw`(?<![\w.,])(?:\+|00)\d[\d\s/()-]{6,}\d|(?<![\w.,])0\d{2,5}[\s/-]?\d[\d\s/-]{3,}\d`, "g");
  const CARD_RE = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;
  const PRIV_WORT = {
    "Zugangsdaten": String.raw`passwort|kennwort|password|\bpin\b|\btan\b|zugangsdaten|logindaten|login-daten|geheimzahl|api[- ]?key|api[- ]?schlüssel`,
    "Gesundheit": String.raw`diagnose|befund|\bkrank|arzt\b|ärztin|klinik|medikament|therapie|depression|arztbrief|blutwerte|krankschreibung|psychiat|schwanger`,
    "Ausweis oder Steuer": String.raw`ausweisnummer|personalausweis|reisepass|steuer-?id|steuernummer|steueridentifikation|sozialversicherungsnummer|versichertennummer`,
    "Finanzen": String.raw`kontonummer|kontostand|\bgehalt|kreditkarte|bankverbindung|schulden|kredit über`
  };
  function privatErkennen(text, s) {
    const t = text || "", found = [];
    if (/^\s*(privat|vertraulich|geheim)(?![\p{L}\p{N}_])/iu.test(t)) found.push("als privat markiert");
    for (const [name, rx] of PRIV_RE) if (rx.test(t)) found.push(name);
    if (!found.includes("IBAN")) {
      PHONE_RE.lastIndex = 0; let m;
      while ((m = PHONE_RE.exec(t))) { if (m[0].replace(/\D/g, "").length >= 7) { found.push("Telefonnummer"); break; } }
    }
    CARD_RE.lastIndex = 0; let c;
    while ((c = CARD_RE.exec(t))) { const d = c[0].replace(/\D/g, ""); if (d.length >= 13 && d.length <= 19 && luhn(d)) { found.push("Kartennummer"); break; } }
    const low = t.toLowerCase();
    for (const [name, rx] of Object.entries(PRIV_WORT)) if (R(rx).test(low)) found.push(name);
    for (let w of String(s.privat_woerter || "").split(/[,;\n]+/)) {
      w = w.trim().toLowerCase();
      if (w.length >= 2 && new RegExp("(?<![\\wäöüß])" + reEsc(w) + "(?![\\wäöüß])", "u").test(low)) { found.push("eigenes Stichwort"); break; }
    }
    return found.filter((f, i) => found.indexOf(f) === i);
  }
  // Lokale KI für private Nachrichten: zuerst die eigene KI im Handy, sonst Ollama auf dem Gerät
  async function lokaleKI(s) {
    const hm = await handyModels();
    if (hm.ok) { const pref = s.anbieter === "handy" && hm.models.includes(s.modell) ? s.modell : hm.models[0]; return ["handy", pref]; }
    const om = await lokalesModell(s);
    return om ? ["ollama", om] : null;
  }
  async function lokalesModell(s) {
    if (!isLocalUrl(s.ollama_url)) return "";      // Ollama Cloud zählt nicht als lokal
    const om = await ollamaModels(s);
    if (!om.ok) return "";
    const lst = om.models;
    for (const cand of [s.lokal_modell, s.anbieter === "ollama" ? s.modell : ""]) if (cand && lst.includes(cand)) return cand;
    return lst[0];
  }

  /* ------------------------------------------------------------ Prompt */
  const LAENGE = { kurz: "Antworte in der Regel in 1 bis 3 kurzen Sätzen.", normal: "Antworte in der Regel in 2 bis 5 Sätzen.", ausfuehrlich: "Antworte gründlich, aber gut vorlesbar." };
  const TAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
  const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  function zeitSatz() {
    const now = new Date(), hhmm = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    return `Heute ist ${TAGE[(now.getDay() + 6) % 7]}, der ${now.getDate()}. ${MONATE[now.getMonth()]} ${now.getFullYear()}, es ist ${hhmm} Uhr.`;
  }
  function systemPrompt(s, ctx, websuche, mitGedaechtnis, kompakt) {
    const now = new Date(), name = s.name || "Jarvis";
    const hhmm = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    const p = [`Du bist ${name}, ein persönlicher KI-Assistent im Stil von J.A.R.V.I.S.: ruhig, schlagfertig, hilfsbereit, mit einem ` +
      "Hauch trockenem Humor. Du sprichst Deutsch.",
    "Deine Antworten werden laut vorgelesen: kurze, natürliche Sätze. Kein Markdown, keine Sternchen, keine Aufzählungszeichen, " +
    "keine Emojis, keine Links ausschreiben. " + (LAENGE[s.antwortlaenge] || LAENGE.kurz),
      "Erfinde nichts. Wenn du etwas nicht weißt oder nicht nachsehen kannst, sag das ehrlich.",
    kompakt ? "" : zeitSatz()].filter(Boolean);
    if (s.nutzer) p.push(`Dein Nutzer heißt ${s.nutzer}. Sprich ihn ab und zu mit Namen an.`);
    if (s.persona) p.push("Zusätzliche Anweisungen deines Nutzers zu deiner Persönlichkeit: " + s.persona);
    p.push("Fähigkeiten, die die Oberfläche selbst ausführt (der Nutzer muss es nur sagen): Timer und Erinnerungen, Webseiten " +
      "öffnen, Wetter, Systemwerte, Weck-Briefing, Notizen merken und vergessen, Oberfläche wechseln. Behaupte nie, dass " +
      "du etwas ausgeführt hast, wenn es unten nicht als erledigt steht.");
    if (websuche === "claude") p.push("Du kannst das Web durchsuchen. Nutze es für aktuelle Fragen und nenne die Quelle in Worten.");
    else if (websuche === "tag") p.push("Du hast Internetzugang über Jarvis. Dein eigenes Wissen hat einen älteren Stand. Wenn eine Frage aktuelle Informationen braucht " +
      "(Nachrichten, Preise, Ergebnisse, Wetter woanders, Öffnungszeiten, neue Produkte, Personen in Ämtern, alles nach deinem Wissensstand) " +
      "und unten noch keine INTERNETSUCHE steht, antworte NUR mit genau einer Zeile: [suche: kurze Suchanfrage]. Sonst nie.");
    else if (websuche === "done") p.push("Unten stehen frische Daten (Internetsuche oder Ergebnis einer Aktion auf dem Handy). Verlass dich darauf statt auf dein älteres Wissen. Keine weitere Suche und keine weitere Aktion.");
    else p.push("Du hast keinen Internetzugang. Für aktuelle Ereignisse sag ehrlich, dass dein Wissen einen Stand hat.");
    if (HAS_ACT && websuche !== "done" && kompakt) p.push('Handy-Aufgaben: antworte NUR mit einer Zeile [aktion: JSON]. typ: mail_liste, mail_lesen{nr}, mail_senden{an,betreff,text}, mail_antworten{nr,text}, sms{wer,text}, whatsapp{wer,text}, anrufen{wer}, navigation{ziel}, app{name}, wecker{zeit}, timer{minuten}, kalender_eintragen{titel,datum,zeit,ort}, kalender_liste{datum,tage}. datum als JJJJ-MM-TT oder "morgen". Beispiel: [aktion: {"typ":"sms","wer":"Ahmet","text":"Ich komme später."}] Texte vollständig im Namen des Nutzers formulieren.');
    else if (HAS_ACT && websuche !== "done") p.push("WERKZEUGE auf dem Handy des Nutzers. Wenn er etwas erledigt haben will, antworte NUR mit genau einer Zeile [aktion: JSON], ohne weiteren Text. Möglich:\n" +
      '[aktion: {"typ":"mail_liste","ungelesen":true}] E-Mails abrufen\n' +
      '[aktion: {"typ":"mail_lesen","nr":1}] E-Mail Nummer aus der letzten Liste lesen (oder "von":"Name")\n' +
      '[aktion: {"typ":"mail_senden","an":"Name oder Adresse","betreff":"...","text":"fertiger Text"}]\n' +
      '[aktion: {"typ":"mail_antworten","nr":1,"text":"fertiger Text"}] (ohne nr: auf die zuletzt gelesene)\n' +
      '[aktion: {"typ":"sms","wer":"Name oder Nummer","text":"..."}] · [aktion: {"typ":"whatsapp","wer":"...","text":"..."}] · [aktion: {"typ":"anrufen","wer":"..."}]\n' +
      '[aktion: {"typ":"navigation","ziel":"..."}] · [aktion: {"typ":"app","name":"..."}] · [aktion: {"typ":"wecker","zeit":"07:30"}] · [aktion: {"typ":"timer","minuten":10}] · [aktion: {"typ":"taschenlampe","an":true}]\n' +
      '[aktion: {"typ":"kalender_eintragen","titel":"Zahnarzt","datum":"2026-11-14","zeit":"10:00","ort":"..."}] (datum JJJJ-MM-TT, ohne zeit = ganztägig) · [aktion: {"typ":"kalender_liste","datum":"morgen","tage":1}]\n' +
      "E-Mails und Nachrichten formulierst du vollständig, freundlich und passend im Namen des Nutzers" + (s.nutzer ? " (" + s.nutzer + ")" : "") + ". Jarvis fragt vor dem Senden selbst nach. Erfinde keine Adressen.");
    if (mitGedaechtnis) p.push("GEDÄCHTNIS (was du dir über deinen Nutzer gemerkt hast):\n" + (memText(kompakt ? 1500 : 4000) || "(noch leer)"));
    else p.push("GEDÄCHTNIS: Aus Datenschutzgründen bleibt das Gedächtnis auf dem Gerät des Nutzers und wird dir nicht geschickt. " +
      "Fragt er danach oder nach 'heute steht an', sag kurz, dass die Notizen nur bei der lokalen KI verfügbar sind.");
    if (s.auto_merken && mitGedaechtnis) p.push("Wenn der Nutzer dir etwas Dauerhaftes über sich erzählt (Name, Vorlieben, Projekte, Termine, Ziele), das noch " +
      "nicht im Gedächtnis steht, hänge ganz am Ende genau eine Zeile an: [merken: kurzer Satz in der dritten Person]. " +
      "Diese Zeile wird nicht vorgelesen. Sonst nie.");
    if (ctx.length) p.push("GERADE ERLEDIGT / ECHTE DATEN:\n" + ctx.join("\n"));
    return p.join("\n\n");
  }

  /* ------------------------------------------------------------ KI-Anbieter (Streaming) */
  function cleanHistory(msgs, ohnePrivat) {
    const out = [];
    for (const m of msgs || []) {
      if (ohnePrivat && m.privat) continue;
      const role = m.role === "assistant" ? "assistant" : "user";
      const text = String(m.content || "").trim().slice(0, 6000);
      if (!text) continue;
      if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += "\n" + text;
      else out.push({ role, content: text });
    }
    while (out.length && out[0].role !== "user") out.shift();
    return out.slice(-20);
  }
  async function* lines(resp) {
    const rd = resp.body.getReader(), dec = new TextDecoder(); let buf = "";
    for (; ;) {
      const { done, value } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); yield l; }
    }
    buf += dec.decode();
    if (buf) yield buf;
  }
  async function* sse(resp) {
    for await (const raw of lines(resp)) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try { yield JSON.parse(data); } catch (e) { }
    }
  }
  const isNetErr = e => !(e instanceof HTTPError) && !(e instanceof KIError) && e.name !== "AbortError";

  async function* streamOllama(s, model, system, msgs, signal) {
    const body = { model, stream: true, messages: [{ role: "system", content: system }].concat(msgs), options: { num_predict: 900 } };
    let r;
    try { r = await http(s.ollama_url + "/api/chat", body, ollamaHdr(s), 300, signal, true); }
    catch (e) {
      if (e instanceof HTTPError) {
        const msg = httpErrorText(e);
        if (e.code === 404 || /not found/i.test(msg)) throw new KIError(`Das Modell '${model}' ist in Ollama nicht installiert. Im Terminal: ollama pull ${model}`);
        if (e.code === 401 || e.code === 403) throw new KIError("Ollama: Zugriff verweigert. Für Ollama Cloud den API-Schlüssel eintragen.");
        throw new KIError("Ollama: " + msg);
      }
      if (isNetErr(e)) throw new KIError(`Ollama ist nicht erreichbar (${s.ollama_url}). Starte Ollama und versuch es nochmal.`);
      throw e;
    }
    for await (const line of lines(r)) {
      if (!line.trim()) continue;
      let j; try { j = JSON.parse(line); } catch (e) { continue; }
      if (j.error) throw new KIError("Ollama: " + j.error);
      const c = (j.message || {}).content || "";
      if (c) yield c;
      if (j.done) break;
    }
  }
  async function* streamClaude(s, model, system, msgs, onEvent, signal) {
    const body = { model, max_tokens: 1200, system, messages: msgs, stream: true };
    if (s.websuche) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];
    let r;
    try { r = await http(ANTHROPIC + "/v1/messages", body, claudeHdr(s), 300, signal, true); }
    catch (e) {
      if (e instanceof HTTPError) {
        let msg = httpErrorText(e);
        if (e.code === 401) msg = "Schlüssel ungültig. Bitte in den Einstellungen prüfen.";
        else if (e.code === 400 && /credit/i.test(msg)) msg = "Kein Guthaben mehr auf dem Anthropic-Konto.";
        else if (e.code === 404) msg = `Modell '${model}' nicht gefunden.`;
        else if (e.code === 529) msg = "Claude ist gerade überlastet. Gleich nochmal versuchen.";
        throw new KIError("Claude: " + msg);
      }
      if (isNetErr(e)) throw new KIError("Claude ist nicht erreichbar. Besteht eine Internetverbindung?");
      throw e;
    }
    let hadText = false;
    for await (const ev of sse(r)) {
      const t = ev.type;
      if (t === "content_block_start") {
        const b = ev.content_block || {};
        if (b.type === "server_tool_use") onEvent({ typ: "suche", text: "Websuche läuft" });
        else if (b.type === "text" && hadText) yield " ";
      } else if (t === "content_block_delta") {
        const d = ev.delta || {};
        if (d.type === "text_delta" && d.text) { hadText = true; yield d.text; }
      } else if (t === "error") throw new KIError("Claude: " + ((ev.error || {}).message || "Fehler"));
    }
  }
  async function* streamOpenai(s, model, system, msgs, signal) {
    const base = s.openai_url || "", key = s.openai_key || "";
    const body = { model, stream: true, messages: [{ role: "system", content: system }].concat(msgs) };
    let r;
    try { r = await http(base + "/chat/completions", body, key ? { Authorization: "Bearer " + key } : {}, 300, signal, true); }
    catch (e) {
      if (e instanceof HTTPError) {
        let msg = httpErrorText(e);
        if (e.code === 401) msg = "Schlüssel ungültig. Bitte in den Einstellungen prüfen.";
        else if (e.code === 429) msg = "Limit erreicht oder kein Guthaben (429).";
        throw new KIError("API: " + msg);
      }
      if (isNetErr(e)) throw new KIError(`API nicht erreichbar (${base}).`);
      throw e;
    }
    for await (const ev of sse(r)) {
      if (ev.error) throw new KIError("API: " + (typeof ev.error === "object" ? ev.error.message : ev.error));
      const ch = (ev.choices || [{}])[0] || {};
      const c = (ch.delta || {}).content;
      if (c) yield c;
    }
  }

  class TagFilter {
    constructor() { this.buf = ""; this.think = false; this.merk = []; this.suche = ""; this.aktion = null; }
    feed(text, fin) {
      this.buf += text; const out = [];
      while (this.buf) {
        if (this.think) {
          const j = this.buf.indexOf("</think>");
          if (j < 0) { this.buf = fin ? "" : this.buf.slice(-8); break; }
          this.buf = this.buf.slice(j + 8); this.think = false; continue;
        }
        const i1 = this.buf.indexOf("<think>"), i2 = this.buf.indexOf("[");
        const cand = [i1, i2].filter(i => i >= 0);
        if (!cand.length) {
          let hold = 0;
          if (!fin) for (let k = Math.min(6, this.buf.length); k > 0; k--) if ("<think>".startsWith(this.buf.slice(-k))) { hold = k; break; }
          out.push(this.buf.slice(0, this.buf.length - hold)); this.buf = this.buf.slice(this.buf.length - hold); break;
        }
        const i = Math.min(...cand);
        out.push(this.buf.slice(0, i)); this.buf = this.buf.slice(i);
        if (this.buf.startsWith("<think>")) { this.buf = this.buf.slice(7); this.think = true; continue; }
        if (/^\[\s*aktion\s*:/i.test(this.buf) || (!fin && "[aktion".startsWith(this.buf.slice(0, 7).toLowerCase()) && this.buf.length < 8)) {
          const e = this.buf.indexOf("}]");
          if (e < 0) { if (fin || this.buf.length > 8000) { out.push(fin && /^\[\s*aktion/i.test(this.buf) ? "" : this.buf); this.buf = ""; } break; }
          const raw = this.buf.slice(this.buf.indexOf(":") + 1, e + 1).trim(); this.buf = this.buf.slice(e + 2);
          try { this.aktion = JSON.parse(raw); } catch (x) { try { this.aktion = JSON.parse(raw.replace(/[„“”]/g, '"')); } catch (y) { } }
          continue;
        }
        const j = this.buf.indexOf("]");
        if (j < 0) { if (fin || this.buf.length > 300) { out.push(this.buf); this.buf = ""; } break; }
        const tag = this.buf.slice(0, j + 1); this.buf = this.buf.slice(j + 1);
        const m = /^\[\s*merken\s*:\s*([\s\S]+?)\s*\]$/i.exec(tag);
        const q = /^\[\s*suche\s*:\s*([\s\S]+?)\s*\]$/i.exec(tag);
        if (m) this.merk.push(m[1]); else if (q) this.suche = q[1]; else out.push(tag);
      }
      return out.join("");
    }
  }

  /* ------------------------------------------------------------ Chat */
  async function runChat(payload, emit, signal) {
    const s = loadSettings();
    const raw = (payload.messages || []).filter(m => m && typeof m === "object");
    let msgs = cleanHistory(raw);
    if (!msgs.length) return emit({ t: "error", message: "Leere Nachricht." });
    const text = msgs[msgs.length - 1].content, u = text.toLowerCase();
    const sag = t => { emit({ t: "delta", text: t }); return emit({ t: "done", text: t }); };

    // Offene Rückfrage ("Soll ich die E-Mail senden?") per Ja/Nein beantworten
    const pending = LS.get("pending", null);
    if (pending) {
      LS.set("pending", null);
      if (Date.now() - (pending.t || 0) < 5 * 60000) {
        if (JA_RE.test(u)) { emit({ t: "action", typ: "status", text: "Wird ausgeführt …", leise: true }); return sag(await ausfuehren(pending, s)); }
        if (NEIN_RE.test(u)) return sag("Alles klar, abgebrochen. Nichts wurde gesendet.");
      }
    }
    async function rueckfrage(c) {
      if (s.aktionen_bestaetigen === false) return await ausfuehren(c, s);
      LS.set("pending", { name: c.name, args: c.args, t: Date.now() });
      return c.text + " Soll ich das so senden?";
    }
    // Schnelle Handy-Befehle ohne KI
    const sb = schnellbefehl(u, text);
    let sbCtx = null;
    if (sb) {
      const r = await werkzeug(sb, s, emit);
      if (r.confirm) return sag(await rueckfrage(r.confirm));
      if (r.say && !r.fail) return sag(r.say);
      if (r.ctx) sbCtx = r.ctx;
    }
    let [anbieter, model] = await pickModel(s);
    if (model && anbieter !== "claude") {
      const lst = (await MODEL_FN[anbieter](s)).models || [];
      if (lst.length && !lst.includes(model)) { s.modell = ""; [anbieter, model] = await pickModel(s); }
    }

    if (s.strikt_lokal && istCloud(s, anbieter)) {
      const lk = await lokaleKI(s);
      if (!lk) return emit({ t: "error", message: "Strikt lokal ist an, aber es gibt keine lokale KI (eigene KI im Handy oder Ollama). Es wurde nichts gesendet." });
      [anbieter, model] = lk;
    }
    let privatErkannt = privatErkennen(text, s).length > 0;
    if (istCloud(s, anbieter) && s.privat_weiche && !payload.erzwingen_cloud) {
      const gruende = privatErkennen(text, s);
      if (gruende.length) {
        const lk = await lokaleKI(s);
        if (!lk) return emit({
          t: "privat", weiter: "blockiert", gruende,
          message: "Private Daten erkannt (" + gruende.join(", ") + "). Es gibt keine lokale KI (eigene KI im Handy oder Ollama), deshalb habe ich nichts an die Cloud geschickt."
        });
        [anbieter, model] = lk;
        emit({ t: "privat", weiter: "lokal", gruende, modell: model });
      }
    }
    const cloud = istCloud(s, anbieter);
    const memOk = !cloud || !!s.gedaechtnis_cloud;

    const [actions, ctx, direct] = await route(u, s, text);
    if (sbCtx) ctx.push(sbCtx);
    for (const a of actions) emit(Object.assign({ t: "action" }, a));
    if (direct) { emit({ t: "delta", text: direct }); return emit({ t: "done", text: direct }); }
    const memacts = actions.filter(a => a.typ === "gedaechtnis");
    if (cloud && !memOk && memacts.length) {
      const a = memacts[0]; let reply;
      if (a.aktion === "gespeichert") reply = `Alles klar, gemerkt: ${a.text}.`;
      else if (a.anzahl) reply = "Erledigt, ich habe " + (a.anzahl === 1 ? "eine Notiz" : `${a.anzahl} Notizen`) + " gelöscht.";
      else reply = "Dazu habe ich nichts gespeichert.";
      emit({ t: "privat", weiter: "lokal", gruende: ["Gedächtnis bleibt lokal"], modell: "ohne KI" });
      emit({ t: "delta", text: reply });
      return emit({ t: "done", text: reply });
    }
    if (cloud) {
      msgs = cleanHistory(raw, true);
      if (!msgs.length || msgs[msgs.length - 1].content !== text) msgs = cleanHistory(msgs.concat([{ role: "user", content: text }]));
    }
    if (!model) {
      const hint = {
        ollama: "Kein Ollama-Modell gefunden. Läuft Ollama und ist ein Modell installiert? (ollama pull llama3.2) Oder in den Einstellungen Ollama Cloud eintragen.",
        claude: "Kein Claude-Modell verfügbar. Ist der Schlüssel in den Einstellungen eingetragen?",
        openai: "Kein Modell verfügbar. Sind Basis-Adresse und Schlüssel in den Einstellungen eingetragen?",
        handy: "Die eigene KI ist noch nicht heruntergeladen: Einstellungen → KI & Modelle → Eigene KI."
      }[anbieter];
      return emit({ t: "error", message: hint });
    }
    emit({ t: "model", anbieter, modell: model, cloud });
    const claudeSucht = anbieter === "claude" && !!s.websuche;
    const darfSuchen = !claudeSucht && sucheErlaubt(s) && !privatErkannt;
    // Ausdrücklich gewünschte Suche ("such mal ...", "was gibt's Neues ...") sofort ausführen
    const schonErledigt = actions.some(a => ["wetter", "briefing", "system", "webseite", "timer", "oberflaeche"].includes(a.typ));
    let gesucht = !!sbCtx;
    if (darfSuchen && !schonErledigt && SUCHE_RE.test(u)) {
      const wunsch = /duckduckgo|duck duck/.test(u) ? "duckduckgo" : /google|googel|googl/.test(u) ? "google" : "";
      const r = await webSuche(suchText(text), s, emit, wunsch);
      ctx.push(r.ctx); gesucht = true;
    }
    const tf = new TagFilter(), full = [];
    async function generate(modus) {
      let gen;
      if (anbieter === "handy") {
        // Fester Systemtext (wird im Handy zwischengespeichert = schneller), wechselnde Infos in die letzte Nachricht
        const system = systemPrompt(s, [], modus, memOk, true);
        const dyn = [zeitSatz()].concat(ctx.map(c => c.slice(0, 5000))).join("\n\n");
        const m2 = msgs.slice(-6).map(m => Object.assign({}, m));
        while (m2.length && m2[0].role !== "user") m2.shift();
        if (m2.length) m2[m2.length - 1].content = "[Aktuelle Infos für dich, nicht vorlesen]\n" + dyn + "\n\n[Nachricht]\n" + m2[m2.length - 1].content;
        let loadMs = 0;
        gen = streamHandy(model, system, m2, signal, st => {
          if (st === "loading") emit({ t: "action", typ: "status", text: "Eigene KI wird geladen … (das dauert beim ersten Mal etwas)" });
          else if (st.startsWith("ready:")) loadMs = +st.slice(6) || 0;
          else if (st.startsWith("stats:")) { try { const x = JSON.parse(st.slice(6)); x.t_load = loadMs; emit({ t: "action", typ: "kistats", stats: x }); } catch (e) { } }
        });
      }
      const system = gen ? "" : systemPrompt(s, ctx, modus, memOk);
      if (!gen) gen = anbieter === "ollama" ? streamOllama(s, model, system, msgs, signal)
        : anbieter === "claude" ? streamClaude(s, model, system, msgs, e => emit(Object.assign({ t: "action" }, e)), signal)
          : streamOpenai(s, model, system, msgs, signal);
      for await (const chunk of gen) {
        const out = tf.feed(chunk);
        if (out) { full.push(out); emit({ t: "delta", text: out }); }
      }
      const out = tf.feed("", true);
      if (out) { full.push(out); emit({ t: "delta", text: out }); }
    }
    try {
      await generate(claudeSucht ? "claude" : gesucht ? "done" : darfSuchen ? "tag" : "");
      // Die KI möchte etwas auf dem Handy erledigen (E-Mail, SMS, Anruf …)
      if (tf.aktion && HAS_ACT && !sbCtx) {
        const a = tf.aktion; tf.aktion = null;
        const r = await werkzeug(a, s, emit);
        const add = t => { if (full.join("").trim()) { full.push(" "); emit({ t: "delta", text: " " }); } full.push(t); emit({ t: "delta", text: t }); };
        if (r.ctx) { ctx.push(r.ctx); if (full.join("").trim()) add(""); await generate("done"); }
        else if (r.confirm) add(await rueckfrage(r.confirm));
        else if (r.say) add(r.say);
      }
      // Die KI hat selbst nach einer Suche gefragt: suchen und mit den Ergebnissen noch einmal antworten
      if (tf.suche && darfSuchen && !gesucht && full.join("").trim().length < 400) {
        const q = tf.suche; tf.suche = "";
        const r = await webSuche(q, s, emit, "");
        ctx.push(r.ctx);
        if (full.join("").trim()) { full.push(" "); emit({ t: "delta", text: " " }); }
        await generate("done");
      }
    } catch (e) {
      if (e.name === "AbortError") throw e;
      if (e instanceof KIError) return emit({ t: "error", message: e.message });
      return emit({ t: "error", message: `Unerwarteter Fehler: ${e.name}: ${e.message}`.slice(0, 300) });
    }
    if (s.auto_merken) for (const m of tf.merk.slice(0, 2)) {
      const it = memAdd(m);
      if (it) emit({ t: "action", typ: "gedaechtnis", aktion: "gelernt", text: it.text });
    }
    emit({ t: "done", text: full.join("").trim() });
  }

  /* ------------------------------------------------------------ ElevenLabs */
  async function elevenTts(s, text, signal) {
    if (s.strikt_lokal) throw new KIError("Strikt lokal ist an: ElevenLabs ist gesperrt.");
    const key = s.eleven_key, vid = s.eleven_voice;
    if (!key || !vid) throw new KIError("ElevenLabs: Schlüssel oder Stimmen-ID fehlt.");
    const body = { text: text.slice(0, 1200), model_id: s.eleven_modell || "eleven_multilingual_v2", voice_settings: { stability: 0.45, similarity_boost: 0.8 } };
    try {
      const r = await http(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vid)}?output_format=mp3_44100_128`, body, { "xi-api-key": key, accept: "audio/mpeg" }, 60, signal);
      return await r.arrayBuffer();
    } catch (e) {
      if (e instanceof HTTPError) throw new KIError("ElevenLabs: " + httpErrorText(e));
      if (e.name === "AbortError") throw e;
      throw new KIError("ElevenLabs nicht erreichbar.");
    }
  }

  /* ------------------------------------------------------------ API-Router (ersetzt den Python-Webserver) */
  const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { "Content-Type": "application/json; charset=utf-8" } });
  async function handle(path, method, data, signal) {
    if (method === "GET") {
      if (path === "/api/settings") return json(200, publicSettings(loadSettings()));
      if (path === "/api/models") { const s = loadSettings(), ms = await allModels(s), [a, m] = await pickModel(s, ms); return json(200, { anbieter: a, modell: m, liste: ms }); }
      if (path === "/api/memory") return json(200, { items: memLoad() });
      if (path === "/api/system") return json(200, systemInfo());
      if (path === "/api/wetter") return json(200, await wetter(loadSettings()));
      if (path === "/api/status") return json(200, { ok: true, version: VERSION, themes: THEMES });
      return json(404, { error: "Nicht gefunden: " + path });
    }
    if (path === "/api/settings") { const s = updateSettings(data); CACHE.clear(); return json(200, publicSettings(s)); }
    if (path === "/api/mailtest") {
      const s = loadSettings(), c = mailCreds(s);
      if (!c) return json(200, { ok: false, fehler: "Bitte E-Mail-Adresse und App-Passwort eintragen und speichern." });
      const r = await nativeAct("mail_liste", Object.assign({ anzahl: 1, ungelesen: true }, c));
      return json(200, r);
    }
    if (path === "/api/test") {
      const fn = MODEL_FN[data.anbieter]; if (!fn) return json(400, { ok: false, fehler: "Unbekannter Anbieter" });
      CACHE.clear(); return json(200, await fn(loadSettings()));
    }
    if (path === "/api/memory") { const it = memAdd(data.text); return json(it ? 200 : 400, { item: it, items: memLoad() }); }
    if (path === "/api/memory/delete") { memDelete(String(data.id || "")); return json(200, { items: memLoad() }); }
    if (path === "/api/memory/clear") { memSave([]); return json(200, { items: [] }); }
    if (path === "/api/tts") {
      try { const audio = await elevenTts(loadSettings(), String(data.text || ""), signal); return new Response(audio, { status: 200, headers: { "Content-Type": "audio/mpeg" } }); }
      catch (e) { if (e.name === "AbortError") throw e; return json(502, { error: e.message }); }
    }
    if (path === "/api/chat") {
      const enc = new TextEncoder(), inner = new AbortController();
      let ctrlRef = null, closed = false;
      const stream = new ReadableStream({
        start(c) {
          ctrlRef = c;
          const emit = obj => { if (!closed) try { c.enqueue(enc.encode(JSON.stringify(obj) + "\n")); } catch (e) { } };
          runChat(data, emit, inner.signal)
            .catch(e => { if (e.name !== "AbortError") emit({ t: "error", message: "Unerwarteter Fehler: " + (e.message || e) }); })
            .finally(() => { if (!closed) { closed = true; try { c.close(); } catch (e) { } } });
        },
        cancel() { closed = true; inner.abort(); }
      });
      if (signal) signal.addEventListener("abort", () => {
        inner.abort();
        if (!closed) { closed = true; try { ctrlRef.error(new DOMException("Abgebrochen", "AbortError")); } catch (e) { } }
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
    }
    return json(404, { error: "Unbekannt: " + path });
  }

  window.fetch = async function (input, init) {
    let url;
    try { url = new URL(typeof input === "string" ? input : input.url, location.href); } catch (e) { return realFetch(input, init); }
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return realFetch(input, init);
    init = init || {};
    const method = (init.method || "GET").toUpperCase(), signal = init.signal;
    if (signal && signal.aborted) throw new DOMException("Abgebrochen", "AbortError");
    let data = {};
    if (method !== "GET" && init.body) { try { data = JSON.parse(init.body); } catch (e) { data = {}; } }
    try { return await handle(url.pathname, method, data || {}, signal); }
    catch (e) { if (e.name === "AbortError") throw e; return json(500, { error: String(e.message || e) }); }
  };

  /* ------------------------------------------------------------ Android: Webseiten extern öffnen */
  if (NATIVE && NATIVE.openUrl) {
    window.open = function (u) { try { NATIVE.openUrl(String(new URL(u, location.href))); } catch (e) { } return { closed: false, close() { }, focus() { } }; };
    document.addEventListener("click", e => {
      const a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      const u = new URL(a.getAttribute("href"), location.href);
      if (u.origin !== location.origin && /^https?:$/.test(u.protocol)) { e.preventDefault(); NATIVE.openUrl(u.href); }
    }, true);
  }

  /* ------------------------------------------------------------ Android: Spracherkennung über das Handy */
  // Wichtig: Die Android-WebView kennt "webkitSpeechRecognition", aber es funktioniert dort nicht.
  // Deshalb in der App immer die Spracherkennung des Handys verwenden.
  if (NATIVE && NATIVE.srStart) {
    let cur = null;
    class NativeSR {
      constructor() { this.lang = "de-DE"; this.continuous = false; this.interimResults = true; this.maxAlternatives = 1; this.onstart = this.onresult = this.onerror = this.onend = null; }
      start() { if (cur && cur !== this) { try { cur.abort(); } catch (e) { } } cur = this; NATIVE.srStart(this.lang || "de-DE"); }
      stop() { NATIVE.srStop(); }
      abort() { NATIVE.srAbort(); }
    }
    window.__jvNative.sr = function (type, text) {
      const r = cur; if (!r) return;
      const res = (t, fin) => { const x = [{ transcript: t, confidence: 1 }]; x.isFinal = fin; return { resultIndex: 0, results: [x] }; };
      if (type === "start") r.onstart && r.onstart({});
      else if (type === "partial") r.onresult && r.onresult(res(text, false));
      else if (type === "final") r.onresult && r.onresult(res(text, true));
      else if (type === "error") r.onerror && r.onerror({ error: text });
      else if (type === "end") { r.onend && r.onend({}); }
    };
    try { Object.defineProperty(window, "SpeechRecognition", { value: NativeSR, configurable: true, writable: true }); } catch (e) { }
    try { Object.defineProperty(window, "webkitSpeechRecognition", { value: NativeSR, configurable: true, writable: true }); } catch (e) { }
    // Das Mikrofon gehört der Spracherkennung des Handys; die Pegelanzeige nicht zusätzlich darauf zugreifen lassen
    try { if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error("in der App nicht genutzt")); } catch (e) { }
  }

  /* ------------------------------------------------------------ Android: Sprachausgabe über das Handy */
  if (NATIVE && NATIVE.ttsSpeak) {
    const UTT = {}; let uid = 0, voices = [];
    class Utt {
      constructor(text) { this.text = text || ""; this.voice = null; this.lang = "de-DE"; this.rate = 1; this.pitch = 1; this.volume = 1; this.onstart = this.onend = this.onerror = this.onboundary = null; }
    }
    const synth = {
      speaking: false, pending: false, paused: false, onvoiceschanged: null,
      getVoices() { return voices; },
      speak(u) {
        const id = "u" + (++uid); UTT[id] = u;
        NATIVE.ttsSpeak(id, String(u.text || ""), (u.voice && u.voice.name) || "", u.lang || "de-DE", +u.rate || 1, +u.pitch || 1, Math.min(1, +u.volume || 1));
      },
      cancel() { NATIVE.ttsStop(); for (const id of Object.keys(UTT)) { const u = UTT[id]; delete UTT[id]; try { u.onend && u.onend({}); } catch (e) { } } synth.speaking = false; },
      pause() { }, resume() { },
      addEventListener(t, f) { if (t === "voiceschanged") synth.onvoiceschanged = f; }
    };
    window.__jvNative.tts = function (type, id) {
      if (type === "voices") {
        try { voices = JSON.parse(id || "[]").map(v => ({ name: v.name, lang: v.lang, localService: !!v.local, default: false, voiceURI: v.name })); } catch (e) { voices = []; }
        synth.onvoiceschanged && synth.onvoiceschanged({});
        return;
      }
      const u = UTT[id]; if (!u) return;
      if (type === "start") { synth.speaking = true; u.onstart && u.onstart({}); }
      else if (type === "word") { u.onboundary && u.onboundary({ name: "word" }); }
      else if (type === "done" || type === "error") { delete UTT[id]; synth.speaking = Object.keys(UTT).length > 0; const f = type === "done" ? u.onend : (u.onerror || u.onend); f && f({ error: "synthesis-failed" }); }
    };
    try { Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true, writable: true }); } catch (e) { }
    window.SpeechSynthesisUtterance = Utt;
    try { const v = NATIVE.ttsVoices(); if (v) window.__jvNative.tts("voices", v); } catch (e) { }
  }

  /* ------------------------------------------------------------ Web: Offline-Cache (nicht in der App nötig) */
  if (!NATIVE && "serviceWorker" in navigator && location.protocol === "https:") {
    addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => { }); });
  }
})();
