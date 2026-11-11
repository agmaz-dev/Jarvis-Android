/* JARVIS · YouTube-Edition · gemeinsamer Kern
   Chat, Einstellungen, Modellwahl, Sprachausgabe, Mikrofon, Timer, Briefing.
   Jede Oberfläche bindet diese Datei ein und meldet sich mit Jarvis.registerTheme({...}) an.
   Die Oberfläche bekommt pro Bild: draw(ctx, breite, hoehe, S)
   S.level = Lautstärke der Stimme (0..1), S.mic = Lautstärke des Nutzers, S.speak/S.think/S.listen = weiche Zustände (0..1),
   S.pulse = kurzer Impuls bei Ereignissen, S.t = Zeit in Sekunden, S.dt = Bildzeit, J.state = idle|listening|thinking|speaking */
(function () {
  "use strict";
  const J = window.Jarvis = {
    version: "1.1", state: "idle", settings: null, theme: null, started: false, history: [], models: null,
    S: { level: 0, mic: 0, speak: 0, think: 0, listen: 0, pulse: 0, t: 0, dt: 0.016 }, _ls: {}
  };
  J.on = (ev, fn) => { (J._ls[ev] = J._ls[ev] || []).push(fn); };
  J.emit = (ev, d) => { (J._ls[ev] || []).forEach(f => { try { f(d); } catch (e) { console.error(e); } }); };
  J.registerTheme = t => { J.theme = t; };
  J.THEMES = [
    { id: "vortex", name: "Vortex", file: "/jarvis.html", desc: "HUD mit Energie-Wirbel, Modulen und Live-Werten. Die Hauptoberfläche.", c: ["#06142c", "#4fb6ff", "#ff9a3c"] },
    { id: "nova", name: "Nova", file: "/oberflaechen/nova.html", desc: "Glühender Funken-Kern in Orange mit großer Typo.", c: ["#140904", "#ff8a1f", "#ffd27a"] },
    { id: "sphaeren", name: "Sphären", file: "/oberflaechen/sphaeren.html", desc: "Glas-Sphären mit Neuronennetz und kreisenden Paneelen.", c: ["#05070f", "#5aa9ff", "#a77bff"] },
    { id: "aura", name: "Aura", file: "/oberflaechen/aura.html", desc: "Glaskugel mit tanzenden Neon-Schleifen.", c: ["#0b0816", "#c77dff", "#ff4fa3"] },
    { id: "gitter", name: "Gitter", file: "/oberflaechen/gitter.html", desc: "Grünes Drahtgitter mit hellem Stern im Kern.", c: ["#03100b", "#39e6a8", "#c8fff0"] },
    { id: "begleiter", name: "Begleiter", file: "/oberflaechen/begleiter.html", desc: "Freundliche Farbkugel mit Augen, die zuhört und spricht.", c: ["#0b0d10", "#2fb37a", "#ff7a45"] },
    { id: "band", name: "Band", file: "/oberflaechen/band.html", desc: "Schwebender Lichtband-Ring um einen kleinen Kern.", c: ["#021210", "#3fe0c5", "#a8fff0"] }
  ];
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("jv-" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("jv-" + k, JSON.stringify(v)); } catch (e) { } }
  };
  async function api(path, body) {
    const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch (e) { }
    if (!r.ok) throw new Error((j && (j.error || j.fehler)) || ("HTTP " + r.status));
    return j;
  }
  J.api = api;
  /* Hilfen für Oberflächen: Leucht-Sprite (vorberechnet, schnell) und weiches Rauschen 0..1 */
  const SPR = {};
  J.sprite = function (r, g, b, hard) {
    const key = r + "," + g + "," + b + (hard ? "h" : ""); if (SPR[key]) return SPR[key];
    const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d");
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`); gr.addColorStop(hard ? .22 : .1, `rgba(${r},${g},${b},${hard ? .9 : .55})`);
    gr.addColorStop(.42, `rgba(${r},${g},${b},.16)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return (SPR[key] = c);
  };
  const hsh = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  J.noise = x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hsh(i) * (1 - u) + hsh(i + 1) * u; };
  J.glowAt = (ctx, spr, x, y, size, alpha) => { if (alpha <= 0.003 || size <= 0) return; ctx.globalAlpha = Math.min(1, alpha); ctx.drawImage(spr, x - size / 2, y - size / 2, size, size); };

  const ICON = {
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    micoff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 10V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 12 20 4l-6 16-3-7-7-1z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
  };

  /* =============================================================== Oberfläche aufbauen */
  function buildUI() {
    const name = (J.settings && J.settings.name) || "Jarvis";
    document.body.insertAdjacentHTML("afterbegin", '<canvas id="jv-canvas"></canvas>');
    document.body.insertAdjacentHTML("beforeend", `
<div id="jv-tl"><button class="jv-btn" id="jv-setbtn" title="Einstellungen">${ICON.gear}<span class="txt">Einstellungen</span></button></div>
<div id="jv-tr"><button id="jv-priv" class="jv-glass" title="Datenschutz"><i></i><span>LOKAL</span></button><div id="jv-model" class="jv-glass" title="Welche KI antwortet"><i class="dot"></i><span class="lbl">KI</span><select id="jv-msel"><option>lädt …</option></select></div></div>
<div id="jv-timers"></div>
<div id="jv-toast" class="jv-glass"></div>
<div id="jv-brief" class="jv-glass"></div>
<div id="jv-dock">
  <div id="jv-log"></div>
  <div id="jv-live"></div>
  <div id="jv-statebar"><i></i><span id="jv-statetxt">Bereit</span></div>
  <div id="jv-bar">
    <button class="jv-ib" id="jv-mic" title="Mikrofon">${ICON.mic}</button>
    <input id="jv-input" type="text" autocomplete="off" placeholder="Schreib ${esc(name)} etwas …">
    <button class="jv-ib" id="jv-stop" title="Stopp">${ICON.stop}</button>
    <button class="jv-ib" id="jv-send" title="Senden">${ICON.send}</button>
  </div>
</div>
<div id="jv-intro"><div class="in"><h1>${esc(name.toUpperCase())}</h1><p>Persönlicher KI-Assistent</p>
  <button id="jv-start">AKTIVIEREN</button><div class="st" id="jv-introst">Verbinde …</div></div></div>
<div id="jv-set"></div>`);
    $("jv-setbtn").onclick = () => openSettings();
    $("jv-send").onclick = () => { const v = $("jv-input").value; $("jv-input").value = ""; send(v); };
    $("jv-input").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("jv-send").click(); } });
    $("jv-stop").onclick = () => { abortChat(); stopSpeaking(); setState("idle"); };
    $("jv-mic").onclick = micButton;
    $("jv-msel").onchange = onModelPick;
    $("jv-priv").onclick = () => openSettings("privat");
    $("jv-intro").onclick = start;
    document.querySelectorAll("#jv-tl button,#jv-bar button").forEach(b => b.addEventListener("click", () => b.blur()));
    document.addEventListener("keyup", e => { if (e.code === "Space" && (document.activeElement || {}).tagName === "BUTTON") e.preventDefault(); });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") { if ($("jv-set").classList.contains("on")) closeSettings(); else { hideBriefing(); stopSpeaking(); } }
      if (!J.started && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); start(); return; }
      const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "");
      if (e.code === "Space" && !typing && J.started && !e.repeat && !$("jv-set").classList.contains("on")) { e.preventDefault(); micButton(); }
    });
    applySettings();
  }

  function toast(text, bad, ms) {
    const t = $("jv-toast"); t.textContent = text; t.classList.toggle("bad", !!bad); t.classList.add("on");
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), ms || 3200);
  }
  J.toast = toast;

  /* =============================================================== Zustände */
  const STATE_TXT = { idle: "Bereit", listening: "Höre zu", thinking: "Denke nach", speaking: "Spreche" };
  function setState(s) {
    if (J.state === s) return;
    J.state = s;
    document.body.classList.remove("jv-s-idle", "jv-s-listening", "jv-s-thinking", "jv-s-speaking");
    document.body.classList.add("jv-s-" + s);
    updateStateText();
    J.S.pulse = Math.min(1, J.S.pulse + 0.5);
    J.emit("state", s);
    micSync();
  }
  J.setState = setState;
  function updateStateText() {
    let t = STATE_TXT[J.state] || "";
    if (J.state === "idle" && MIC.running) t = J.settings && J.settings.weckwort_an ? `Bereit · sag „${J.settings.weckwort} …“` : "Bereit · ich höre zu";
    if (J.state === "idle" && !MIC.running && J.settings && J.settings.mikro === "aus" && SR) t = "Bereit · Leertaste oder Mikro zum Sprechen";
    if (J.state === "idle" && J.settings && J.settings.strikt_lokal) t = "Bereit · strikt lokal · bitte tippen";
    const el = $("jv-statetxt"); if (el) el.textContent = t;
  }

  /* =============================================================== Chat-Verlauf */
  function addMsg(role, text, cls) {
    const log = $("jv-log"); const d = document.createElement("div");
    d.className = "jv-msg " + role + (cls ? " " + cls : ""); d.textContent = text; log.appendChild(d);
    while (log.children.length > 60) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
    if (role !== "note") J.emit("message", { role, text });
    return d;
  }
  J.addMsg = addMsg;
  function saveHistory() { store.set("history", J.history.slice(-30)); }
  function restoreHistory() {
    J.history = store.get("history", []).filter(m => m && m.content && (m.role === "user" || m.role === "assistant"));
    J.history.slice(-6).forEach(m => addMsg(m.role, m.content, "old"));
  }

  /* =============================================================== Senden + Antwort (Streaming) */
  const STOP_RE = /^(stopp?|halt|sei still|ruhe|schweig|psst|aufhören|hör auf|genug)[\s.!]*$/i;
  let chatCtrl = null;
  function abortChat() { if (chatCtrl) { chatCtrl.abort(); chatCtrl = null; } }

  async function send(text, opt) {
    opt = opt || {};
    text = String(text || "").trim();
    if (!text) return;
    if (!J.started) start();
    if (STOP_RE.test(text)) { abortChat(); stopSpeaking(); setState("idle"); return; }
    abortChat(); stopSpeaking();
    if (!opt.hidden) addMsg("user", text);
    const userEntry = { role: "user", content: text }; J.history.push(userEntry); saveHistory();
    let privat = false;
    $("jv-live").textContent = "";
    setState("thinking"); J.emit("module", "ki");
    const ctrl = new AbortController(); chatCtrl = ctrl;
    const bubble = addMsg("assistant", ""); bubble.classList.add("cur");
    let full = "", errored = false;
    SPEAK.reset();
    const after = [];
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: J.history.slice(-16), erzwingen_cloud: !!opt.force }), signal: ctrl.signal });
      if (!r.ok || !r.body) throw new Error("Server antwortet nicht (HTTP " + r.status + ")");
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
      for (; ;) {
        const { done, value } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
          let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
          if (ev.t === "delta") { full += ev.text; bubble.textContent = full; $("jv-log").scrollTop = 1e9; SPEAK.feed(ev.text); }
          else if (ev.t === "action") doAction(ev, bubble, after);
          else if (ev.t === "model") showModelPill(ev.anbieter, ev.modell);
          else if (ev.t === "privat") {
            if (ev.weiter === "lokal") {
              privat = true; userEntry.privat = true; saveHistory();
              addMsg("note", ev.modell === "ohne KI" ? "🔒 Gedächtnis-Befehl lokal erledigt · nichts an die Cloud gesendet" : "🔒 Erkannt: " + ev.gruende.join(", ") + " · lokal beantwortet von " + ev.modell + " · nichts an die Cloud gesendet");
              $("jv-log").appendChild(bubble); privFlash("LOKAL BEANTWORTET"); J.emit("event", { kind: "privat", text: "Privat: " + ev.gruende.join(", ") });
            } else {
              errored = true; bubble.classList.add("err"); bubble.textContent = ev.message;
              J.history = J.history.filter(m => m !== userEntry); saveHistory();
              const b = document.createElement("a"); b.className = "jv-link"; b.href = "#"; b.textContent = "Trotzdem an die Cloud senden";
              b.onclick = e => { e.preventDefault(); b.remove(); send(text, { force: true, hidden: true }); };
              setTimeout(() => { bubble.appendChild(document.createElement("br")); bubble.appendChild(b); }, 30);
              privFlash("BLOCKIERT"); J.emit("event", { kind: "privat", text: "Nicht gesendet: " + ev.gruende.join(", ") });
            }
          }
          else if (ev.t === "error") { errored = true; bubble.classList.add("err"); bubble.textContent = ev.message; J.emit("event", { kind: "fehler", text: ev.message }); }
        }
      }
    } catch (e) {
      if (e.name === "AbortError") { bubble.classList.remove("cur"); return; }
      errored = true; bubble.classList.add("err");
      bubble.textContent = "Keine Verbindung zum Jarvis-Server. Läuft server.py noch? (" + e.message + ")";
    }
    if (chatCtrl === ctrl) chatCtrl = null;
    bubble.classList.remove("cur");
    if (errored) {
      if (!bubble.textContent) bubble.textContent = "Fehler.";
      SPEAK.reset(); SPEAK.say("Das hat nicht geklappt. Die Details stehen im Chat.");
    } else {
      if (!full.trim()) { bubble.remove(); } else { J.history.push(privat ? { role: "assistant", content: full.trim(), privat: true } : { role: "assistant", content: full.trim() }); saveHistory(); }
      SPEAK.feed("", true);
    }
    SPEAK.onDone(() => after.forEach(f => f()));
  }
  J.send = send;

  /* =============================================================== Aktionen vom Server */
  function doAction(a, bubble, after) {
    const ev = (kind, text) => J.emit("event", { kind, text });
    J.S.pulse = 1;
    switch (a.typ) {
      case "timer": addTimer(a.sek, a.text); J.emit("module", "automation"); ev("timer", "Timer " + fmtDur(a.sek) + " · " + a.text); break;
      case "webseite": {
        J.emit("module", "automation"); ev("web", "Öffne " + a.name);
        let w = null; try { w = window.open(a.url, "_blank", "noopener"); } catch (e) { }
        const l = document.createElement("a"); l.className = "jv-link"; l.href = a.url; l.target = "_blank"; l.rel = "noopener"; l.textContent = "↗ " + a.name + " öffnen";
        setTimeout(() => { bubble.appendChild(document.createElement("br")); bubble.appendChild(l); }, 50);
        if (!w) toast("Der Browser hat das neue Fenster blockiert. Link im Chat anklicken oder Pop-ups für localhost erlauben.", true, 6000);
        break;
      }
      case "oberflaeche": ev("theme", "Oberfläche: " + a.name); after.push(() => { api("/api/settings", { oberflaeche: a.name }).catch(() => { }); setTimeout(() => location.href = a.url, 400); }); break;
      case "briefing": showBriefing(a.system, a.wetter); J.emit("module", "system"); J.emit("module", "wetter"); J.emit("briefing", a); ev("briefing", "Weck-Briefing"); break;
      case "wetter": showBriefing(null, a.wetter); J.emit("module", "wetter"); ev("wetter", a.wetter && !a.wetter.fehler ? `${a.wetter.ort}: ${a.wetter.temp}° ${a.wetter.text}` : "Wetter nicht abrufbar"); break;
      case "system": showBriefing(a.system, null); J.emit("module", "system"); ev("system", "Systemwerte abgerufen"); break;
      case "gedaechtnis": J.emit("module", "gedaechtnis");
        if (a.aktion === "geloescht") { ev("gedaechtnis", a.anzahl ? "Notiz gelöscht" : "Nichts zum Löschen gefunden"); }
        else { ev("gedaechtnis", (a.aktion === "gelernt" ? "Gelernt: " : "Gemerkt: ") + a.text); toast((a.aktion === "gelernt" ? "Gelernt: " : "Gemerkt: ") + a.text); }
        break;
      case "suche": J.emit("module", "suche"); ev("suche", a.text || "Websuche"); break;
      case "quellen": {
        J.emit("module", "suche"); ev("suche", "Quellen: " + (a.quelle || "Web"));
        const box = document.createElement("div"); box.className = "jv-quellen"; box.style.cssText = "margin-top:8px;font-size:.85em;opacity:.85";
        box.innerHTML = "Quellen (" + esc(a.quelle || "Web") + "): " + (a.links || []).map(l => `<a class="jv-link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc((l.title || l.url).slice(0, 60))}</a>`).join(" · ");
        setTimeout(() => { if (bubble) bubble.appendChild(box); }, 50);
        break;
      }
      case "routine": ev("routine", "Routine: " + a.satz); break;
      case "status": ev("ki", a.text); toast(a.text, false, 6000); break;
    }
  }

  /* =============================================================== Timer */
  J.timers = [];
  function fmtDur(s) { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); }
  function addTimer(sek, text) {
    J.timers.push({ id: Math.random().toString(36).slice(2), end: Date.now() + sek * 1000, text: text || "Timer" });
    store.set("timers", J.timers); renderTimers();
  }
  function renderTimers() {
    const box = $("jv-timers"); if (!box) return;
    box.innerHTML = J.timers.map(t => `<div class="jv-timer jv-glass" data-id="${t.id}"><b>${fmtDur((t.end - Date.now()) / 1000)}</b><span>${esc(t.text)}</span><button title="Abbrechen">×</button></div>`).join("");
    box.querySelectorAll("button").forEach(b => b.onclick = () => { const id = b.parentNode.dataset.id; J.timers = J.timers.filter(t => t.id !== id); store.set("timers", J.timers); renderTimers(); });
  }
  setInterval(() => {
    if (!J.timers.length) return;
    const now = Date.now(), due = J.timers.filter(t => t.end <= now);
    if (due.length) {
      J.timers = J.timers.filter(t => t.end > now); store.set("timers", J.timers);
      due.forEach(t => { beep(); toast("⏰ " + t.text, false, 8000); addMsg("note", "⏰ Erinnerung: " + t.text); J.emit("event", { kind: "timer", text: "Erinnerung: " + t.text }); J.emit("module", "automation");
        if (J.state !== "speaking" && J.state !== "thinking") { SPEAK.reset(); SPEAK.say("Erinnerung: " + t.text); } });
      renderTimers();
    } else { $("jv-timers").querySelectorAll(".jv-timer").forEach(el => { const t = J.timers.find(x => x.id === el.dataset.id); if (t) el.querySelector("b").textContent = fmtDur((t.end - now) / 1000); }); }
  }, 250);

  /* =============================================================== Töne */
  let AC = null;
  function ac() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } } if (AC && AC.state === "suspended") AC.resume().catch(() => { }); return AC; }
  function tone(f1, f2, dur, vol) {
    if (!J.settings || !J.settings.sounds) return; const a = ac(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain(); o.type = "sine"; o.frequency.setValueAtTime(f1, a.currentTime); o.frequency.exponentialRampToValueAtTime(f2, a.currentTime + dur);
    g.gain.setValueAtTime(0.0001, a.currentTime); g.gain.exponentialRampToValueAtTime(vol || 0.08, a.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + dur + 0.05);
  }
  function beep() { const s = J.settings && J.settings.sounds; if (J.settings) J.settings.sounds = true; tone(880, 880, .18, .12); setTimeout(() => tone(1175, 1175, .25, .12), 220); if (J.settings) J.settings.sounds = s; }

  /* =============================================================== Sprachausgabe */
  const SPEAK = (function () {
    let q = [], busy = false, gen = 0, buf = "", spoke = false, finished = true, doneCbs = [], audio = null, analyser = null, ctrls = [];
    let bump = 0, synthOn = false; const recent = [];
    function clean(t) {
      return t.replace(/```[\s\S]*?```/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, "")
        .replace(/[*_#`>|~]+/g, "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "").replace(/\s+/g, " ").trim();
    }
    function mode() { const m = (J.settings && J.settings.stimme) || "browser"; return (m === "elevenlabs" && (J.settings.strikt_lokal || !J.settings.eleven_key || !J.settings.eleven_voice)) ? "browser" : m; }
    function enqueue(text) {
      const t = clean(text); if (!t || !/[\p{L}\p{N}]/u.test(t)) return;
      spoke = true; const item = { text: t };
      if (mode() === "elevenlabs") {
        const c = new AbortController(); ctrls.push(c);
        item.blob = fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t }), signal: c.signal })
          .then(async r => { if (!r.ok) { let m = "ElevenLabs-Fehler"; try { m = (await r.json()).error || m; } catch (e) { } throw new Error(m); } return r.blob(); });
        item.blob.catch(() => { });
      }
      q.push(item); pump();
    }
    function feed(delta, final) {
      if (mode() === "aus") { if (final) finish(); return; }
      buf += delta;
      for (; ;) {
        const re = /[.!?…]+["“”')]*\s+|[:;]\s+|\n+/g; let m, cut = -1;
        while ((m = re.exec(buf))) { const end = m.index + m[0].length; if (end >= (spoke ? 40 : 14)) { cut = end; break; } }
        if (cut < 0) { if (buf.length > 260) { const c = buf.lastIndexOf(", ", 240); cut = c > 60 ? c + 2 : 240; } else break; }
        enqueue(buf.slice(0, cut)); buf = buf.slice(cut);
      }
      if (final) { if (buf.trim()) enqueue(buf); buf = ""; finish(); }
    }
    function finish() { finished = true; if (!busy && !q.length) end(); }
    function end() {
      if (J.settings && J.settings.mikro === "nach_antwort" && spoke) MIC.paused = false;
      if (J.state === "speaking" || J.state === "thinking") setState("idle");
      const cbs = doneCbs; doneCbs = []; cbs.forEach(f => f());
    }
    async function pump() {
      if (busy) return;
      const item = q.shift();
      if (!item) { if (finished) end(); return; }
      busy = true; const g = gen;
      setState("speaking"); J.emit("sentence", item.text); J.emit("module", "stimme");
      recent.push(item.text.toLowerCase()); if (recent.length > 6) recent.shift();
      try {
        if (mode() === "elevenlabs") { try { await playEleven(item, g); } catch (e) { if (g === gen) { toast(e.message + " · nutze Browser-Stimme", true, 5000); await playBrowser(item.text, g); } } }
        else await playBrowser(item.text, g);
      } catch (e) { console.warn(e); }
      busy = false;
      if (g !== gen) return;
      pump();
    }
    async function playEleven(item, g) {
      const blob = await item.blob; if (g !== gen) return;
      const url = URL.createObjectURL(blob);
      audio = new Audio(url); audio.volume = Math.min(1, (J.settings && J.settings.lautstaerke) || 1);
      const a = ac();
      if (a) { try { const src = a.createMediaElementSource(audio); if (!analyser) { analyser = a.createAnalyser(); analyser.fftSize = 512; analyser.connect(a.destination); } src.connect(analyser); } catch (e) { } }
      await new Promise((res) => {
        audio.onended = res; audio.onerror = res;
        audio.play().catch(err => { toast("Klick einmal auf die Seite, damit Jarvis sprechen darf.", true); res(); });
      });
      URL.revokeObjectURL(url); audio = null;
    }
    let VOICES = [];
    function loadVoices() { try { VOICES = speechSynthesis.getVoices() || []; } catch (e) { VOICES = []; } J.emit("voices", VOICES); }
    if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
    function pickVoice() {
      const want = J.settings && J.settings.browser_stimme, lang = ((J.settings && J.settings.sprache) || "de-DE").slice(0, 2);
      const pool = (J.settings && J.settings.strikt_lokal) ? VOICES.filter(v => v.localService) : VOICES;
      if (want) { const v = pool.find(v => v.name === want); if (v) return v; }
      const l = pool.filter(v => (v.lang || "").toLowerCase().startsWith(lang));
      return l.find(v => /natural|online|neural/i.test(v.name)) || l.find(v => /google/i.test(v.name)) || l[0] || null;
    }
    J.voices = () => VOICES; J.pickVoice = pickVoice;
    function playBrowser(text, g) {
      return new Promise(res => {
        if (!window.speechSynthesis) { setTimeout(res, Math.min(4000, text.length * 55)); return; }
        const u = new SpeechSynthesisUtterance(text), st = J.settings || {};
        const v = pickVoice(); if (v) u.voice = v; u.lang = (v && v.lang) || st.sprache || "de-DE";
        u.rate = +st.tempo || 1; u.pitch = +st.tonhoehe || 1; u.volume = Math.min(1, +st.lautstaerke || 1);
        let done = false; const fin = () => { if (done) return; done = true; synthOn = false; clearTimeout(to); res(); };
        u.onstart = () => { synthOn = true; }; u.onend = fin; u.onerror = fin; u.onboundary = () => { bump = 1; };
        const to = setTimeout(fin, 4000 + text.length * 110 / (u.rate || 1));
        synthOn = true; speechSynthesis.speak(u);
      });
    }
    function level(t, dt) {
      if (audio && analyser && !audio.paused) {
        const d = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(d);
        let s = 0; for (let i = 0; i < d.length; i++) { const x = (d[i] - 128) / 128; s += x * x; }
        return Math.min(1, Math.sqrt(s / d.length) * 3.2);
      }
      if (synthOn) {
        bump = Math.max(0, bump - dt * 3.5);
        const w = 0.5 + 0.5 * Math.sin(t * 13.1 + Math.sin(t * 3.3) * 2.2), w2 = 0.6 + 0.4 * Math.sin(t * 5.7 + 1.3);
        return Math.min(1, 0.18 + 0.42 * w * w2 + 0.35 * bump);
      }
      return 0;
    }
    function stop() {
      gen++; q = []; buf = ""; busy = false; finished = true; synthOn = false;
      ctrls.forEach(c => { try { c.abort(); } catch (e) { } }); ctrls = [];
      try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) { }
      if (audio) { try { audio.pause(); } catch (e) { } audio = null; }
    }
    return {
      feed, level, stop, recent,
      reset() { stop(); spoke = false; finished = false; doneCbs = []; },
      say(text) { finished = false; enqueue(text); finish(); },
      onDone(f) { if (!busy && !q.length && finished) f(); else doneCbs.push(f); },
      busy: () => busy || q.length > 0
    };
  })();
  J.speak = text => { SPEAK.reset(); SPEAK.say(text); };
  function stopSpeaking() { SPEAK.stop(); if (J.state === "speaking") setState("idle"); }
  J.stopSpeaking = stopSpeaking;

  /* =============================================================== Mikrofon (Spracherkennung im Browser) */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const MIC = { rec: null, running: false, starting: false, paused: false, oneShot: false, restarts: [], wakeUntil: 0, blocked: false, cont: null, lvl: null };
  function micShouldRun() {
    if (!SR || !J.started || MIC.blocked || !J.settings || J.settings.strikt_lokal) return false;
    if ($("jv-set") && $("jv-set").classList.contains("on")) return false;
    if (MIC.oneShot) return J.state !== "thinking" && J.state !== "speaking";
    const m = J.settings.mikro;
    if (m === "aus" || MIC.paused) return false;
    if (m === "nach_antwort") return J.state === "idle" || J.state === "listening";
    return true;
  }
  function micSync() {
    const should = micShouldRun();
    if (should && !MIC.running && !MIC.starting) micStart();
    else if (!should && (MIC.running || MIC.starting)) micStop();
    micUi();
  }
  function micUi() {
    const b = $("jv-mic"); if (!b) return;
    b.classList.toggle("na", !SR); b.classList.toggle("on", MIC.running); b.classList.toggle("paused", !MIC.running && MIC.paused && J.settings && J.settings.mikro !== "aus");
    b.innerHTML = (!SR || MIC.blocked || (!MIC.running && (MIC.paused || (J.settings && J.settings.mikro === "aus")))) ? ICON.micoff : ICON.mic;
    b.title = !SR ? "Spracherkennung gibt es nur in Chrome oder Edge" : MIC.running ? "Mikrofon an · klicken zum Pausieren" : "Mikrofon aus · klicken zum Sprechen";
    J.S.listenOn = MIC.running; document.body.classList.toggle("jv-micon", MIC.running);
    updateStateText();
  }
  function micButton() {
    if (!SR) { toast("Spracherkennung gibt es nur in Chrome oder Edge. Schreiben geht überall.", true, 5000); return; }
    if (J.settings.strikt_lokal) { toast("Strikt lokal ist an: Die Spracheingabe des Browsers läuft über einen Online-Dienst und ist deshalb aus. Bitte tippen.", true, 6000); return; }
    if (!J.started) start();
    if (MIC.blocked) { MIC.blocked = false; }
    if (J.state === "speaking") { stopSpeaking(); }
    if (J.settings.mikro === "aus") { MIC.oneShot = !MIC.running; }
    else { MIC.paused = MIC.running; }
    tone(MIC.running ? 520 : 660, MIC.running ? 380 : 990, .12, .05);
    micSync();
  }
  function makeRec() {
    const cont = J.settings.mikro !== "aus" && !MIC.oneShot;
    if (MIC.rec && MIC.cont === cont && MIC.rec.lang === (J.settings.sprache || "de-DE")) return MIC.rec;
    const r = new SR(); r.lang = J.settings.sprache || "de-DE"; r.continuous = cont; r.interimResults = true; r.maxAlternatives = 1;
    r.onstart = () => { MIC.starting = false; MIC.running = true; micUi(); micLevel(true); };
    r.onresult = e => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i], txt = res[0].transcript;
        MIC.silent = 0;
        if (res.isFinal) heard(txt); else interim += txt;
      }
      if (interim.trim()) { $("jv-live").textContent = interim; if (J.state === "idle") setState("listening"); clearTimeout(MIC.lt); MIC.lt = setTimeout(() => { if (J.state === "listening") { setState("idle"); $("jv-live").textContent = ""; } }, 2500); }
    };
    r.onerror = e => {
      const er = e.error;
      if (er === "no-speech") MIC.silent = (MIC.silent || 0) + 1;
      if (er === "cancelled") { MIC.oneShot = false; if (J.settings.mikro !== "aus") MIC.paused = true; }
      else if (er === "not-allowed" || er === "service-not-allowed") { MIC.blocked = true; toast("Mikrofon blockiert. Klick links in der Adresszeile auf das Symbol und erlaube das Mikrofon.", true, 7000); }
      else if (er === "audio-capture") { MIC.blocked = true; toast("Kein Mikrofon gefunden.", true, 5000); }
      else if (er === "network") { toast("Spracherkennung braucht Internet (der Browser nutzt dafür einen Online-Dienst).", true, 6000); MIC.restarts.push(Date.now(), Date.now(), Date.now()); }
    };
    r.onend = () => {
      MIC.running = false; MIC.starting = false;
      if (MIC.oneShot) MIC.oneShot = false;
      micUi();
      // "Nach Antwort": hört nach einer Antwort zu; kommt zweimal nichts, Mikrofon pausieren statt endlos neu zu starten
      if (MIC.silent >= 2 && J.settings.mikro === "nach_antwort" && !J.settings.weckwort_an) { MIC.silent = 0; MIC.paused = true; micUi(); micLevel(false); return; }
      if (micShouldRun()) {
        const now = Date.now(); MIC.restarts = MIC.restarts.filter(x => now - x < 10000); MIC.restarts.push(now);
        setTimeout(micSync, MIC.restarts.length > 6 ? 3000 : 250);
      } else micLevel(false);
    };
    MIC.rec = r; MIC.cont = cont; return r;
  }
  function micStart() {
    try { const r = makeRec(); MIC.starting = true; r.start(); }
    catch (e) { MIC.starting = false; setTimeout(micSync, 600); }
  }
  function micStop() { MIC.starting = false; try { MIC.rec && MIC.rec.abort(); } catch (e) { } MIC.running = false; }
  async function micLevel(on) {
    if (on && !MIC.lvl) {
      try {
        const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const a = ac(); const src = a.createMediaStreamSource(st), an = a.createAnalyser(); an.fftSize = 512; src.connect(an);
        MIC.lvl = { st, an, d: new Uint8Array(512) };
      } catch (e) { MIC.lvl = null; }
    } else if (!on && MIC.lvl) { MIC.lvl.st.getTracks().forEach(t => t.stop()); MIC.lvl = null; }
  }
  function micLevelNow() {
    const L = MIC.lvl; if (!L || !MIC.running) return 0;
    L.an.getByteTimeDomainData(L.d); let s = 0; for (let i = 0; i < L.d.length; i++) { const x = (L.d[i] - 128) / 128; s += x * x; }
    return Math.min(1, Math.sqrt(s / L.d.length) * 5);
  }
  function similar(a, b) {
    const wa = a.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [], wb = new Set(b.match(/[\p{L}\p{N}]+/gu) || []);
    if (!wa.length) return false; return wa.filter(w => wb.has(w)).length / wa.length > 0.6;
  }
  function heard(text) {
    text = text.trim(); $("jv-live").textContent = ""; clearTimeout(MIC.lt);
    if (!text) return;
    if (J.state === "speaking" && SPEAK.recent.some(r => similar(text, r))) return;   // eigene Stimme gehört
    const st = J.settings;
    if (st.weckwort_an && !MIC.oneShot) {
      const w = (st.weckwort || "Jarvis").toLowerCase(), low = text.toLowerCase(), i = low.indexOf(w);
      if (i < 0 && Date.now() > MIC.wakeUntil) { if (J.state === "listening") setState("idle"); return; }
      if (i >= 0) text = (text.slice(0, i) + text.slice(i + w.length)).replace(/^[\s,.!?]+|[\s,]+$/g, "");
      if (!text || text.length < 2) { MIC.wakeUntil = Date.now() + 8000; setState("idle"); tone(660, 990, .12, .06); SPEAK.reset(); SPEAK.say("Ja?"); addMsg("note", "„" + st.weckwort + "“ erkannt · ich höre"); return; }
    }
    MIC.wakeUntil = 0;
    send(text, { voice: true });
  }

  /* =============================================================== Modellwahl oben rechts */
  const PROV = { handy: "Eigene KI · im Handy", ollama: "Lokal · Ollama", claude: "Claude · API", openai: "OpenAI-kompatibel · API" };
  const HAS_LLM = !!(window.JarvisNative && window.JarvisNative.llmStatus);
  async function loadModels() {
    const sel = $("jv-msel"), box = $("jv-model");
    try {
      const r = await api("/api/models"); J.models = r;
      let h = "";
      for (const p of (HAS_LLM ? ["handy", "ollama", "claude", "openai"] : ["ollama", "claude", "openai"])) {
        const L = r.liste[p] || { ok: false, models: [] };
        h += `<optgroup label="${PROV[p]}">`;
        const lock = J.settings && J.settings.strikt_lokal && isCloud(p);
        if (L.ok) h += L.models.map(m => `<option value="${p}|${esc(m)}"${lock ? " disabled" : ""}>${esc(m)}${lock ? " · gesperrt (strikt lokal)" : ""}</option>`).join("");
        else h += `<option disabled value="">– ${esc((L.fehler || "nicht verfügbar").slice(0, 60))}</option>`;
        h += "</optgroup>";
      }
      h += `<option value="__reload">↻ Modelle neu suchen</option>`;
      sel.innerHTML = h;
      const cur = r.anbieter + "|" + r.modell;
      if (r.modell && [...sel.options].some(o => o.value === cur)) sel.value = cur; else sel.selectedIndex = -1;
      const ok = !!r.modell && (r.liste[r.anbieter] || {}).ok;
      box.classList.toggle("ok", ok); box.classList.toggle("bad", !ok);
      box.title = ok ? "Aktiv: " + PROV[r.anbieter] + " · " + r.modell : ((r.liste[r.anbieter] || {}).fehler || "Keine KI verfügbar. Einstellungen öffnen.");
      J.emit("models", r); privBadge();
      return r;
    } catch (e) { box.classList.add("bad"); sel.innerHTML = "<option>Server nicht erreichbar</option>"; return null; }
  }
  J.loadModels = loadModels;
  function showModelPill(a, m) { J.current = { anbieter: a, modell: m }; J.emit("model", J.current); }

  /* =============================================================== Datenschutz-Anzeige */
  function isCloud(p, st) {
    st = st || J.settings || {};
    if (p === "handy") return false;
    if (p === "claude") return true;
    if (p === "openai") { const u = (st.openai_url || "").toLowerCase(); return !(u.includes("localhost") || u.includes("127.0.0.1")); }
    const o = (st.ollama_url || "").toLowerCase(); return !/^(https?:\/\/)?(localhost|127\.|10\.|192\.168\.|\[::1\])/.test(o);
  }
  J.isCloud = isCloud;
  let privT = 0;
  function privBadge() {
    const b = $("jv-priv"); if (!b || !J.settings) return;
    const st = J.settings, cloud = isCloud(st.anbieter) && !st.strikt_lokal;
    b.className = "jv-glass " + (st.strikt_lokal ? "strikt" : cloud ? "cloud" : "lokal");
    if (!privT) b.querySelector("span").textContent = st.strikt_lokal ? "STRIKT LOKAL" : cloud ? "CLOUD" : "LOKAL";
    b.title = st.strikt_lokal ? "Strikt lokal: nichts verlässt deinen PC (nur Ollama, keine Online-Dienste)"
      : cloud ? "Cloud-KI aktiv: Nachrichten gehen an " + (st.anbieter === "claude" ? "Anthropic" : st.anbieter === "ollama" ? "Ollama Cloud" : "den API-Anbieter") + "."
        + (st.gedaechtnis_cloud ? " Das Gedächtnis wird mitgeschickt." : " Das Gedächtnis bleibt lokal.") + (st.privat_weiche ? " Private Nachrichten gehen an Ollama." : "")
        : "Lokale KI: die Anfragen bleiben auf deinem PC.";
  }
  function privFlash(t) {
    const b = $("jv-priv"); if (!b) return;
    clearTimeout(privT); b.querySelector("span").textContent = "🔒 " + t; b.classList.add("flash");
    privT = setTimeout(() => { privT = 0; b.classList.remove("flash"); privBadge(); }, 4500);
  }
  function privList(st) {
    const cloud = isCloud(st.anbieter) && !st.strikt_lokal, prov = st.anbieter === "claude" ? "Anthropic (Claude)" : st.anbieter === "ollama" ? "Ollama Cloud" : "deinen API-Anbieter";
    const L = [];
    if (st.anbieter === "handy") L.push(["KI-Anfragen", "bleiben auf dem Handy (eigene KI)", false]); else
    L.push(["KI-Anfragen", cloud ? "gehen an " + prov + ": deine Nachricht und die letzten Nachrichten, private ausgenommen" : "bleiben auf deinem PC (Ollama)", cloud]);
    L.push(["Gedächtnis", cloud && st.gedaechtnis_cloud ? "wird bei jeder Anfrage an " + prov + " mitgeschickt" : "bleibt auf deinem PC", cloud && st.gedaechtnis_cloud]);
    if (cloud) L.push(["Private Nachrichten", st.privat_weiche ? "werden erkannt und lokal von Ollama beantwortet. Läuft Ollama nicht, wird nichts gesendet." : "gehen ebenfalls in die Cloud", !st.privat_weiche]);
    L.push(["Spracheingabe", st.strikt_lokal ? "aus (bitte tippen)" : "läuft über einen Online-Dienst des Browsers (Chrome: Google, Edge: Microsoft)" + (st.mikro === "aus" ? ", aber nur, wenn du den Mikro-Knopf drückst" : ""), !st.strikt_lokal]);
    const st2 = st.strikt_lokal ? "nur Stimmen, die auf deinem PC installiert sind" : st.stimme === "elevenlabs" ? "der gesprochene Text geht an ElevenLabs" : st.stimme === "aus" ? "aus" : "Browser-Stimme. Achtung: Stimmen mit „Online“ oder „Natural“ im Namen laufen über Server von Microsoft bzw. Google";
    L.push(["Sprachausgabe", st2, !st.strikt_lokal && st.stimme !== "aus"]);
    L.push(["Wetter", st.strikt_lokal ? "aus" : "nur der Ortsname geht an Open-Meteo", !st.strikt_lokal]);
    if (cloud && st.anbieter === "claude" && st.websuche) L.push(["Websuche", "Claude sucht bei Bedarf im Web", true]);
    else if (st.internetsuche && !st.strikt_lokal) L.push(["Internetsuche", "nur die Suchanfrage geht an " + (st.suchmaschine === "duckduckgo" ? "DuckDuckGo" : "Google") + "; bei erkannten privaten Daten wird nicht gesucht", true]);
    return '<div class="jv-list">' + L.map(([a, b, out]) => `<div class="jv-li"><span><b style="font-weight:600">${a}</b><br><small style="white-space:normal">${esc(b)}</small></span><small class="${out ? "po" : "pl"}">${out ? "verlässt den PC" : "bleibt lokal"}</small></div>`).join("") + "</div>";
  }
  async function onModelPick() {
    const v = $("jv-msel").value;
    if (v === "__reload") { $("jv-msel").innerHTML = "<option>suche …</option>"; await loadModels(); toast("Modelle aktualisiert"); return; }
    const [a, m] = v.split("|"); if (!m) return;
    J.settings = await api("/api/settings", a === "ollama" ? { anbieter: a, modell: m, lokal_modell: m } : { anbieter: a, modell: m });
    privBadge();
    toast("Jetzt antwortet: " + m); $("jv-model").classList.add("ok"); $("jv-model").classList.remove("bad");
    J.emit("model", { anbieter: a, modell: m });
  }

  /* =============================================================== Briefing-Karte */
  const RING = 263.9;
  function wxIcon(i) {
    const cloud = '<path class="cl" d="M30 60h40a12 12 0 0 0 1.5-23.9A18 18 0 0 0 37 32a14 14 0 0 0-7 28z"/>';
    let rays = ""; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; rays += `<line class="ry" x1="${50 + Math.cos(a) * 24}" y1="${40 + Math.sin(a) * 24}" x2="${50 + Math.cos(a) * 32}" y2="${40 + Math.sin(a) * 32}"/>`; }
    const g = {
      sonne: `<g class="rays">${rays}</g><circle class="sn" cx="50" cy="40" r="15"/>`,
      mond: '<path class="sn" d="M58 22a20 20 0 1 0 14 34A17 17 0 0 1 58 22z"/>',
      wolkig: `<circle class="sn" cx="68" cy="28" r="11"/><g class="dr">${cloud}</g>`,
      regen: `<g class="dr">${cloud}</g>` + [0, 1, 2, 3].map(k => `<line class="drop" x1="${34 + k * 11}" y1="62" x2="${31 + k * 11}" y2="70" style="animation-delay:${k * .22}s"/>`).join(""),
      schnee: `<g class="dr">${cloud}</g>` + [0, 1, 2, 3].map(k => `<circle class="flake" cx="${34 + k * 11}" cy="64" r="2.4" style="animation-delay:${k * .6}s"/>`).join(""),
      nebel: [22, 34, 46, 58].map((y, k) => `<line class="fog" x1="${20 + k * 4}" y1="${y}" x2="${78 - k * 3}" y2="${y}" style="animation-delay:${k * .5}s"/>`).join(""),
      gewitter: `<g class="dr">${cloud}</g><path class="bolt" d="M52 58l-7 12h7l-4 11 12-15h-8l5-8z"/>`
    }[i] || `<g class="dr">${cloud}</g>`;
    return `<svg class="wx" viewBox="0 0 100 80">${g}</svg>`;
  }
  function ringHtml(id, label) { return `<div class="jv-ring" id="${id}"><svg viewBox="0 0 100 100"><circle class="r0" cx="50" cy="50" r="42"/><circle class="r1" cx="50" cy="50" r="42" transform="rotate(-90 50 50)"/></svg><div class="v"><b>—</b><small>%</small></div><div class="l">${label}</div><div class="s"></div></div>`; }
  function setRing(id, v, sub, warnAt) {
    const r = $(id); if (!r) return; const fg = r.querySelector(".r1");
    r.querySelector(".v b").textContent = v == null ? "—" : v; r.querySelector(".v small").style.display = v == null ? "none" : "";
    fg.style.strokeDashoffset = v == null ? RING : RING * (1 - v / 100); r.classList.toggle("warn", v != null && v >= (warnAt || 85));
    r.querySelector(".s").textContent = sub || "";
  }
  let briefIv = 0, briefTo = 0;
  function showBriefing(sys, w) {
    const b = $("jv-brief");
    let h = `<div class="bh"><i></i><span>${sys && w ? "Briefing" : sys ? "System" : "Wetter"}</span><em id="jv-bst"></em><button title="Schließen">×</button></div><div class="bg">`;
    if (sys) h += ringHtml("jv-rc", "CPU") + ringHtml("jv-rr", "RAM") + ringHtml("jv-rd", "FESTPLATTE");
    if (w) {
      if (w.fehler) h += `<div class="jv-wx"><div><div class="o">${esc(w.ort || "Wetter")}</div><div class="d">Wetter nicht abrufbar</div><div class="m">${esc(w.fehler)}</div></div></div>`;
      else h += `<div class="jv-wx">${wxIcon(w.icon)}<div><div class="o">${esc(w.ort)}</div><div class="t">${w.temp}°</div><div class="d">${esc(w.text)}</div><div class="m">GEFÜHLT ${w.gefuehlt}° · WIND ${w.wind} KM/H${w.tmax != null ? "<br>HEUTE " + w.tmin + "° BIS " + w.tmax + "°" : ""}${w.regen != null ? " · REGEN " + w.regen + " %" : ""}<br>${esc(w.quelle || "")}</div></div></div>`;
    }
    b.innerHTML = h + "</div>";
    b.querySelector("button").onclick = hideBriefing;
    b.classList.add("on"); document.body.classList.add("jv-brief-on");
    const upd = s => {
      setRing("jv-rc", s.cpu, s.cpu == null ? "nicht messbar" : (s.kerne ? s.kerne + " Kerne" : ""));
      setRing("jv-rr", s.ram, s.ram_belegt != null ? s.ram_belegt + " / " + s.ram_gesamt + " GB" : "nicht messbar", 90);
      setRing("jv-rd", s.platte, s.platte_frei != null ? s.platte_frei + " GB frei" : "nicht messbar", 95);
      const e = $("jv-bst"); if (e) { e.textContent = (s.auffaellig || []).length ? "Auffällig: " + s.auffaellig.join(", ") : "System läuft sauber" + (s.laufzeit ? " · seit " + s.laufzeit : ""); e.classList.toggle("warn", !!(s.auffaellig || []).length); }
    };
    clearInterval(briefIv); clearTimeout(briefTo);
    if (sys) { setTimeout(() => upd(sys), 120); briefIv = setInterval(() => api("/api/system").then(upd).catch(() => { }), 3000); }
    briefTo = setTimeout(hideBriefing, 30000);
  }
  function hideBriefing() { $("jv-brief").classList.remove("on"); document.body.classList.remove("jv-brief-on"); clearInterval(briefIv); }
  J.showBriefing = showBriefing;

  /* =============================================================== Einstellungen */
  const TABS = [["ki", "KI & Modelle", "M4 6h16M4 12h16M4 18h10"], ["stimme", "Stimme", "M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"], ["mikro", "Mikrofon", "M9 3h6v11H9zM5 11a7 7 0 0 0 14 0M12 18v3"],
  ["person", "Persönlichkeit", "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0"], ["mem", "Gedächtnis", "M12 3a7 7 0 0 0-4 12.7V19h8v-3.3A7 7 0 0 0 12 3zM9 22h6"],
  ["auto", "Automation", "M13 2 4 14h7l-1 8 9-12h-7z"], ["privat", "Datenschutz", "M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"], ["look", "Oberfläche", "M3 4h18v12H3zM8 20h8M12 16v4"], ["hilfe", "Hilfe", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h0"]];
  function sw(k, label) { return `<label class="sw"><input type="checkbox" data-k="${k}"><i></i><span>${label}</span></label>`; }
  function settingsHtml() {
    const nav = TABS.map((t, i) => `<button data-tab="${t[0]}" class="${i ? "" : "on"}"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${t[2]}"/></svg><span>${t[1]}</span></button>`).join("");
    return `<div class="panel"><header><h2>Einstellungen</h2><span>Änderungen gelten sofort nach „Speichern“</span><button class="jv-btn" data-close>Schließen</button></header>
<div class="body"><nav>${nav}</nav><div class="tabs">
<section class="tab on" data-tab="ki"><h3>Welche KI soll antworten?</h3><p class="hint">Wähle einen Anbieter. Ollama läuft entweder direkt auf dem Handy (Termux, kostenlos, offline) oder als Ollama Cloud mit Schlüssel. Claude und OpenAI-kompatible Dienste brauchen einen API-Schlüssel und Internet. Das Modell kannst du jederzeit oben rechts wechseln.</p>
<div class="seg" style="margin-bottom:16px">
${HAS_LLM ? '<label><input type="radio" name="anb" value="handy" data-k="anbieter"><span><b>Eigene KI · Handy</b><small>Gemma, offline, gehört dir</small></span></label>' : ""}
<label><input type="radio" name="anb" value="ollama" data-k="anbieter"><span><b>Lokal · Ollama</b><small>Kostenlos, offline, ohne Schlüssel</small></span></label>
<label><input type="radio" name="anb" value="claude" data-k="anbieter"><span><b>Claude · API</b><small>Anthropic, mit Websuche</small></span></label>
<label><input type="radio" name="anb" value="openai" data-k="anbieter"><span><b>OpenAI-kompatibel</b><small>OpenAI, Groq, OpenRouter, LM Studio …</small></span></label></div>
${HAS_LLM ? '<div class="box" data-box="handy"><h4>Eigene KI · im Handy</h4><p class="hint" style="margin:0 0 10px">Die KI läuft komplett auf deinem Handy: ohne Internet, ohne Konto, ohne Kosten. Einmal herunterladen (am besten im WLAN), dann oben „Eigene KI · Handy“ wählen. Private Nachrichten beantwortet sie automatisch, auch wenn sonst eine Cloud-KI aktiv ist.</p><div id="jv-llm">lädt …</div></div>' : ""}
<div class="box" data-box="ollama"><h4>Ollama (lokal oder Cloud)</h4><div class="row"><label>Adresse<small>Auf dem Gerät: http://localhost:11434<br>Ollama Cloud: https://ollama.com</small></label><input type="url" data-k="ollama_url"></div>
<div class="row"><label>API-Schlüssel<small>nur für Ollama Cloud, sonst leer</small></label><input type="password" data-k="ollama_key" placeholder="leer lassen bei lokal" autocomplete="off"></div>
<div class="row"><label></label><div class="inl"><span class="res" data-res="ollama"></span><button class="jv-btn" data-test="ollama">Verbindung testen</button></div></div></div>
<div class="box" data-box="claude"><h4>Claude (Anthropic)</h4><div class="row"><label>API-Schlüssel<small>beginnt mit sk-ant-…</small></label><input type="password" data-k="claude_key" placeholder="sk-ant-…" autocomplete="off"></div>
<div class="row"><label>Websuche</label>${sw("websuche", "Claude darf im Web nachsehen (kostet etwas mehr)")}</div>
<div class="row"><label></label><div class="inl"><span class="res" data-res="claude"></span><button class="jv-btn" data-test="claude">Verbindung testen</button></div></div></div>
<div class="box" data-box="openai"><h4>OpenAI-kompatibel</h4><div class="row"><label>Basis-Adresse<small>OpenAI: https://api.openai.com/v1<br>LM Studio: http://localhost:1234/v1</small></label><input type="url" data-k="openai_url"></div>
<div class="row"><label>API-Schlüssel<small>bei LM Studio leer lassen</small></label><input type="password" data-k="openai_key" placeholder="sk-…" autocomplete="off"></div>
<div class="row"><label></label><div class="inl"><span class="res" data-res="openai"></span><button class="jv-btn" data-test="openai">Verbindung testen</button></div></div></div>
<div class="box"><h4>Internetsuche</h4><div class="row"><label>Im Internet suchen<small>für aktuelle Fragen, Nachrichten, Preise …</small></label>${sw("internetsuche", "Jarvis darf selbst im Internet nachsehen")}</div>
<div class="row"><label>Suchmaschine<small>wenn eine nicht geht, nimmt Jarvis automatisch die nächste</small></label><select data-k="suchmaschine"><option value="google">Google (dann DuckDuckGo, Wikipedia)</option><option value="duckduckgo">DuckDuckGo (dann Google, Wikipedia)</option></select></div>
${window.JarvisNative && window.JarvisNative.googleSetup ? '<div class="row"><label>Google einrichten<small>einmal öffnen und „Alle akzeptieren“ tippen, falls Google fragt</small></label><div class="inl"><button class="jv-btn" id="jv-gsetup">Google öffnen</button></div></div>' : ""}</div>
<div class="row"><label>Antwortlänge</label><select data-k="antwortlaenge"><option value="kurz">Kurz (1 bis 3 Sätze)</option><option value="normal">Normal</option><option value="ausfuehrlich">Ausführlich</option></select></div>
</section>
<section class="tab" data-tab="stimme"><h3>Wie soll ${esc(J.settings.name)} klingen?</h3><p class="hint">Die Browser-Stimme ist kostenlos. In Microsoft Edge gibt es besonders natürliche Stimmen (Name enthält „Natural“). ElevenLabs klingt am besten und braucht einen eigenen Schlüssel.</p>
<div class="seg" style="margin-bottom:16px">
<label><input type="radio" name="stm" value="browser" data-k="stimme"><span><b>Browser-Stimme</b><small>kostenlos, sofort</small></span></label>
<label><input type="radio" name="stm" value="elevenlabs" data-k="stimme"><span><b>ElevenLabs</b><small>sehr natürlich, eigene Stimme möglich</small></span></label>
<label><input type="radio" name="stm" value="aus" data-k="stimme"><span><b>Stumm</b><small>nur Text</small></span></label></div>
<div class="box"><h4>Browser-Stimme</h4><div class="row"><label>Stimme</label><select data-k="browser_stimme" id="jv-voices"></select></div>
<div class="row"><label>Tempo</label><input type="range" min="0.6" max="1.6" step="0.05" data-k="tempo"></div>
<div class="row"><label>Tonhöhe</label><input type="range" min="0.5" max="1.6" step="0.05" data-k="tonhoehe"></div></div>
<div class="box"><h4>ElevenLabs</h4><div class="row"><label>API-Schlüssel</label><input type="password" data-k="eleven_key" autocomplete="off"></div>
<div class="row"><label>Stimmen-ID<small>in ElevenLabs bei der Stimme: „ID kopieren“</small></label><input type="text" data-k="eleven_voice"></div>
<div class="row"><label>Modell</label><select data-k="eleven_modell"><option value="eleven_multilingual_v2">eleven_multilingual_v2 (beste Qualität)</option><option value="eleven_flash_v2_5">eleven_flash_v2_5 (schnell, günstig)</option><option value="eleven_turbo_v2_5">eleven_turbo_v2_5</option></select></div></div>
<div class="row"><label>Lautstärke</label><input type="range" min="0.1" max="1" step="0.05" data-k="lautstaerke"></div>
<div class="row"><label></label><div class="inl"><span class="res" id="jv-voiceres"></span><button class="jv-btn" id="jv-voicetest">Stimme testen</button></div></div>
</section>
<section class="tab" data-tab="mikro"><h3>Wann soll ${esc(J.settings.name)} zuhören?</h3><p class="hint">Die Spracherkennung läuft im Browser (Chrome oder Edge) und braucht Internet. Mit Lautsprechern kann ${esc(J.settings.name)} sich selbst hören: dann „Nach der Antwort“ wählen oder ein Headset nutzen.</p>
<div class="seg" style="margin-bottom:16px">
<label><input type="radio" name="mic" value="nach_antwort" data-k="mikro"><span><b>An, wenn fertig gesprochen</b><small>hört zu, pausiert während der Antwort (empfohlen)</small></span></label>
<label><input type="radio" name="mic" value="immer" data-k="mikro"><span><b>Immer an</b><small>auch dazwischenreden möglich · Headset empfohlen</small></span></label>
<label><input type="radio" name="mic" value="aus" data-k="mikro"><span><b>Nur auf Knopfdruck</b><small>Mikro-Knopf oder Leertaste</small></span></label></div>
<div class="row"><label>Aktivierungswort<small>reagiert nur, wenn das Wort fällt</small></label>${sw("weckwort_an", "Nur auf Aktivierungswort reagieren")}</div>
<div class="row"><label>Wort</label><input type="text" data-k="weckwort"></div>
<div class="row"><label>Sprache</label><select data-k="sprache"><option value="de-DE">Deutsch (Deutschland)</option><option value="de-AT">Deutsch (Österreich)</option><option value="de-CH">Deutsch (Schweiz)</option><option value="en-US">Englisch (USA)</option></select></div>
</section>
<section class="tab" data-tab="person"><h3>Persönlichkeit</h3><p class="hint">So stellt sich ${esc(J.settings.name)} vor und so spricht er dich an.</p>
<div class="row"><label>Name der KI</label><input type="text" data-k="name"></div>
<div class="row"><label>Dein Name<small>optional</small></label><input type="text" data-k="nutzer"></div>
<div class="row"><label>Eigene Anweisungen<small>z.B. „Sprich mich mit Chef an, sei frech“</small></label><textarea data-k="persona"></textarea></div>
</section>
<section class="tab" data-tab="mem"><h3>Gedächtnis</h3><p class="hint">Hier steht, was ${esc(J.settings.name)} sich über dich gemerkt hat. Sag „Merk dir …“ oder „Vergiss …“, oder bearbeite es hier. Gespeichert in gedaechtnis.json neben server.py.</p>
<div class="row"><label>Selbst dazulernen</label>${sw("auto_merken", "Merkt sich Wichtiges aus Gesprächen automatisch")}</div>
<div class="inl" style="margin-bottom:10px"><input type="text" id="jv-memadd" placeholder="Neue Notiz, z.B. Ich trinke Kaffee schwarz"><button class="jv-btn" id="jv-memaddbtn">Hinzufügen</button></div>
<div class="jv-list" id="jv-memlist"></div>
<div style="margin-top:12px"><button class="jv-btn jv-danger" id="jv-memclear">Alles löschen</button></div>
</section>
<section class="tab" data-tab="auto"><h3>Automation</h3><p class="hint">Routinen: Wenn ein Satz fällt, passiert etwas. Funktioniert mit jeder KI, auch mit kleinen lokalen Modellen.</p>
<div class="box"><h4>Routinen</h4><div class="jv-rt" style="font-size:11px;color:var(--mut)"><span>WENN ICH SAGE …</span><span>DANN</span><span>WERT</span><span></span></div><div id="jv-routines"></div>
<button class="jv-btn" id="jv-rtadd">+ Routine</button></div>
<div class="box"><h4>Weck-Briefing & Wetter</h4>
<div class="row"><label>Ort fürs Wetter</label><input type="text" data-k="ort" placeholder="z.B. Koblenz"></div>
<div class="row"><label>Beim Start</label>${sw("briefing_beim_start", "Nach dem Aktivieren automatisch ein Briefing")}</div></div>
<div class="box"><h4>Eingebaute Befehle</h4><div class="jv-cmds">
<div><b>„Bist du da?“ · „Guten Morgen“</b><span>Weck-Briefing mit System, Wetter, Notizen</span></div>
<div><b>„Erinnere mich in 10 Minuten an …“</b><span>Timer mit Erinnerung</span></div>
<div><b>„Merk dir, dass …“ · „Vergiss …“</b><span>Gedächtnis</span></div>
<div><b>„Öffne YouTube“ · „Öffne heise.de“</b><span>Webseite öffnen</span></div>
<div><b>„Wie ist das Wetter?“</b><span>Wetter mit Karte</span></div>
<div><b>„Wie läuft mein System?“</b><span>CPU, RAM, Festplatte</span></div>
<div><b>„Wechsel die Oberfläche auf Aura“</b><span>Design wechseln</span></div>
<div><b>„Stopp“</b><span>sofort still</span></div></div></div>
</section>
<section class="tab" data-tab="look"><h3>Oberfläche</h3><p class="hint">Sieben Designs. Jedes ist auch einzeln als Datei im Ordner „oberflaechen“ aufrufbar.</p>
<div class="jv-themes" id="jv-themes"></div>
<div class="row" style="margin-top:16px"><label>Chatverlauf</label>${sw("chat_sichtbar", "Nachrichten über der Eingabe anzeigen")}</div>
<div class="row"><label>Töne</label>${sw("sounds", "Kurze Töne bei Mikrofon und Timer")}</div>
</section>
<section class="tab" data-tab="privat"><h3>Datenschutz</h3><p class="hint">Bei Ollama bleiben die KI-Anfragen auf deinem PC. Bei Claude oder OpenAI gehen sie an den Anbieter. Hier legst du fest, was deinen PC verlassen darf.</p>
<div class="box"><h4>Private Daten automatisch lokal</h4>
<div class="row"><label>Privat-Weiche<small>wirkt, wenn eine Cloud-KI gewählt ist</small></label>${sw("privat_weiche", "Private Nachrichten an die lokale KI (Ollama) statt an die Cloud")}</div>
<p class="hint" style="margin:-4px 0 10px">Erkannt werden: Telefonnummern, E-Mail-Adressen, IBAN, Kartennummern, Adressen, API-Schlüssel und Wörter wie Passwort, PIN, Diagnose, Kontostand oder Steuer-ID. Und alles, was mit „privat:“ beginnt. Die Erkennung arbeitet mit Mustern. Sie findet viel, aber nicht alles.</p>
<div class="row"><label>Eigene Stichwörter<small>z.B. Namen aus der Familie, Projektnamen</small></label><textarea data-k="privat_woerter" placeholder="Anna, Projekt Falke, Hausbau"></textarea></div>
<div class="row"><label>Lokales Modell für Privates</label><select data-k="lokal_modell" id="jv-lokalm"></select></div></div>
<div class="box"><h4>Gedächtnis</h4>
<div class="row"><label>An Cloud-KI senden</label>${sw("gedaechtnis_cloud", "Gedächtnis auch an Claude/OpenAI schicken")}</div>
<p class="hint" style="margin:-4px 0 0">Aus = Das Gedächtnis bleibt auf deinem PC. Die Cloud-KI kennt dann deine Notizen nicht. „Merk dir …“ und „Vergiss …“ funktionieren trotzdem, sie werden lokal erledigt.</p></div>
<div class="box"><h4>Strikt lokal</h4>
<div class="row"><label>Nichts verlässt den PC</label>${sw("strikt_lokal", "Nur Ollama, keine Online-Dienste")}</div>
<p class="hint" style="margin:-4px 0 0">Sperrt Claude, OpenAI, ElevenLabs, Wetter, Websuche und die Spracheingabe des Browsers. Zum Sprechen werden nur Stimmen genutzt, die auf deinem PC installiert sind.</p></div>
<div class="box"><h4>Was verlässt gerade deinen PC?</h4><div id="jv-privlist"></div></div>
</section>
<section class="tab" data-tab="hilfe"><h3>Hilfe</h3><p class="hint">Die ausführliche Anleitung steht in <b>anleitung.txt</b> im Jarvis-Ordner.</p>
<div class="jv-cmds">
<div><b>Keine KI oben rechts?</b><span>Ollama starten oder Schlüssel unter „KI & Modelle“ eintragen, dann „↻ Modelle neu suchen“.</span></div>
<div><b>Mikrofon geht nicht?</b><span>Chrome oder Edge nutzen, Seite über http://localhost öffnen, Mikrofon erlauben.</span></div>
<div><b>Keine Stimme?</b><span>Einmal auf die Seite klicken. Unter „Stimme“ testen.</span></div>
<div><b>Hört sich selbst?</b><span>Mikrofon auf „An, wenn fertig gesprochen“ oder Headset.</span></div>
<div><b>Leertaste</b><span>Mikrofon an/aus (wenn kein Textfeld aktiv ist)</span></div>
<div><b>Esc</b><span>Sprechen stoppen, Fenster schließen</span></div></div>
<p class="hint" style="margin-top:14px">Version ${J.version}</p></section>
</div></div>
<footer><span class="res" id="jv-saveres"></span><button class="jv-btn" data-close>Abbrechen</button><button class="jv-btn jv-primary" id="jv-save">Speichern</button></footer></div>`;
  }
  function fillVoices() {
    const sel = $("jv-voices"); if (!sel) return;
    const v = J.voices(), cur = J.settings.browser_stimme || "", lang = (J.settings.sprache || "de").slice(0, 2);
    const sorted = v.slice().sort((a, b) => ((b.lang || "").startsWith(lang) - (a.lang || "").startsWith(lang)) || a.name.localeCompare(b.name));
    sel.innerHTML = `<option value="">Automatisch (beste ${lang === "de" ? "deutsche " : ""}Stimme)</option>` + sorted.map(x => `<option value="${esc(x.name)}">${esc(x.name)} · ${esc(x.lang)}</option>`).join("");
    sel.value = cur; if (sel.value !== cur) sel.value = "";
  }
  J.on("voices", fillVoices);
  function fillLokal() {
    const sel = $("jv-lokalm"); if (!sel) return;
    const L = J.models && J.models.liste && J.models.liste.ollama;
    sel.innerHTML = '<option value="">Automatisch (zuletzt gewähltes Ollama-Modell)</option>' + (L && L.ok ? L.models.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("") : '<option value="" disabled>Ollama nicht erreichbar</option>');
  }
  function renderRoutines(list) {
    const box = $("jv-routines"); if (!box) return;
    const opts = [["briefing", "Weck-Briefing"], ["webseite", "Webseite öffnen"], ["sagen", "Text sagen"], ["oberflaeche", "Oberfläche wechseln"], ["timer", "Timer (Minuten)"]];
    box.innerHTML = list.map(r => `<div class="jv-rt"><input type="text" class="rs" value="${esc(r.satz)}" placeholder="z.B. feierabend"><select class="ra">${opts.map(o => `<option value="${o[0]}"${o[0] === r.aktion ? " selected" : ""}>${o[1]}</option>`).join("")}</select><input type="text" class="rw" value="${esc(r.wert)}" placeholder="URL, Text, Minuten …"><button title="Entfernen">×</button></div>`).join("");
    box.querySelectorAll("button").forEach(b => b.onclick = () => b.parentNode.remove());
  }
  function readRoutines() {
    return [...document.querySelectorAll("#jv-routines .jv-rt")].map(r => ({ satz: r.querySelector(".rs").value.trim(), aktion: r.querySelector(".ra").value, wert: r.querySelector(".rw").value.trim() })).filter(r => r.satz);
  }
  async function renderMemory() {
    const box = $("jv-memlist"); if (!box) return;
    try {
      const r = await api("/api/memory");
      box.innerHTML = r.items.length ? r.items.slice().reverse().map(i => `<div class="jv-li" data-id="${esc(i.id)}"><span>${esc(i.text)}</span><small>${esc(i.datum)}</small><button title="Löschen">×</button></div>`).join("") : '<div class="hint">Noch nichts gespeichert.</div>';
      box.querySelectorAll("button").forEach(b => b.onclick = async () => { await api("/api/memory/delete", { id: b.parentNode.dataset.id }); renderMemory(); });
    } catch (e) { box.innerHTML = '<div class="hint">Gedächtnis nicht lesbar.</div>'; }
  }
  function renderThemes() {
    const box = $("jv-themes"); if (!box) return;
    const cur = (J.theme && J.theme.id) || J.settings.oberflaeche;
    box.innerHTML = J.THEMES.map((t, i) => `<div class="jv-th${t.id === cur ? " cur" : ""}" data-id="${t.id}">${i === 0 ? '<span class="tag">HAUPT</span>' : ""}<div class="sw2" style="background:radial-gradient(circle at 50% 55%,${t.c[2]} 0,${t.c[1]} 14%,transparent 46%),radial-gradient(circle at 50% 55%,${t.c[1]}55 0,transparent 70%),${t.c[0]}"></div><b>${t.name}</b><p>${t.desc}</p></div>`).join("");
    box.querySelectorAll(".jv-th").forEach(el => el.onclick = async () => {
      const t = J.THEMES.find(x => x.id === el.dataset.id);
      try { await api("/api/settings", { oberflaeche: t.id }); } catch (e) { }
      location.href = t.file;
    });
  }
  function bindValues(root) {
    root.querySelectorAll("[data-k]").forEach(el => {
      const k = el.dataset.k, v = J.settings[k];
      if (el.type === "checkbox") el.checked = !!v;
      else if (el.type === "radio") el.checked = el.value === v;
      else el.value = v == null ? "" : v;
    });
  }
  function readValues(root) {
    const out = {};
    root.querySelectorAll("[data-k]").forEach(el => {
      const k = el.dataset.k;
      if (el.type === "checkbox") out[k] = el.checked;
      else if (el.type === "radio") { if (el.checked) out[k] = el.value; }
      else if (el.type === "range" || el.type === "number") out[k] = parseFloat(el.value);
      else out[k] = el.value;
    });
    out.routinen = readRoutines();
    return out;
  }
  let llmT = 0; const llmSpeed = {};
  function renderLlm() {
    clearTimeout(llmT);
    const box = $("jv-llm"); if (!box) return;
    let st; try { st = JSON.parse(window.JarvisNative.llmStatus()); } catch (e) { box.textContent = "Status nicht lesbar: " + e.message; return; }
    if (st.error) { box.textContent = st.error; return; }
    const gb = b => (b / 1e9).toFixed(1).replace(".", ",");
    box.innerHTML = (st.models || []).map(m => {
      let right;
      if (m.installed && m.crashed) right = `<span class="res bad">⚠ zu groß für den Arbeitsspeicher (App ist abgestürzt)</span><button class="jv-btn" data-llmretry="${m.id}">Trotzdem erneut versuchen</button><button class="jv-btn" data-llmdel="${m.id}">Löschen (${String(m.gb).replace(".", ",")} GB frei)</button>`;
      else if (m.installed) right = `<span class="res ok">✓ installiert${st.loaded === m.id ? " · geladen" : ""}</span><button class="jv-btn" data-llmdel="${m.id}">Löschen</button>`;
      else if (m.downloading) {
        // Manche Server nennen die Gesamtgröße nicht – dann mit der bekannten Modellgröße rechnen
        const total = m.total > 0 ? m.total : parseFloat(m.gb) * 1e9, done = m.done || 0;
        const pct = Math.min(99, Math.floor(100 * done / total));
        const now = Date.now(), prev = llmSpeed[m.id];
        let eta = "";
        if (prev && now > prev.t && done > prev.d) {
          const bps = (done - prev.d) / ((now - prev.t) / 1000); prev.bps = prev.bps ? prev.bps * 0.7 + bps * 0.3 : bps;
          const rest = (total - done) / prev.bps; eta = rest > 90 ? " · noch ca. " + Math.ceil(rest / 60) + " Min" : " · gleich fertig";
        } else if (prev && prev.bps) eta = " · noch ca. " + Math.ceil((total - done) / prev.bps / 60) + " Min";
        llmSpeed[m.id] = { t: now, d: done, bps: prev && prev.bps };
        const stTxt = m.state === "connecting" ? "verbinde mit dem Server" : m.state === "retry" ? "Verbindung unterbrochen, neuer Versuch gleich" + (m.error ? " (" + esc(m.error) + ")" : "") : "lädt";
        if (m.bps > 0) { llmSpeed[m.id] = { t: Date.now(), d: done, bps: m.bps }; eta = " · " + (m.bps / 1e6).toFixed(1).replace(".", ",") + " MB/s · noch ca. " + Math.max(1, Math.ceil((total - done) / m.bps / 60)) + " Min"; }
        right = `<div style="flex:1;min-width:180px"><div class="res">${stTxt} · <b>${pct} %</b> · ${gb(done)} von ${gb(total)} GB${m.paused ? "" : eta}</div>`
          + `<div style="height:8px;border-radius:4px;background:rgba(255,255,255,.12);margin-top:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:#4fb6ff;transition:width .6s"></div></div></div>`
          + `<button class="jv-btn" data-llmdel="${m.id}">Abbrechen</button>`;
      }
      else right = `${m.failed ? '<span class="res bad">Download fehlgeschlagen' + (m.error ? ": " + esc(m.error) : "") + '</span>' : ""}${m.partial ? '<span class="res">' + gb(m.partial) + ' GB schon geladen</span>' : ""}<button class="jv-btn" data-llmdl="${m.id}">${m.partial ? "Weiter herunterladen" : "Herunterladen (" + String(m.gb).replace(".", ",") + " GB)"}</button>`;
      return `<div class="row"><label>${esc(m.name)}<small>${esc(m.info)}</small></label><div class="inl">${right}</div></div>`;
    }).join("") + `<p class="hint" style="margin:6px 0 0">Freier Speicher: ${String(Math.round(st.free_gb || 0))} GB · App-Version ${esc((window.JarvisNative.appVersion && window.JarvisNative.appVersion()) || "?")}</p>`;
    box.querySelectorAll("[data-llmdl]").forEach(b => b.onclick = () => { b.disabled = true; b.textContent = "startet …"; window.JarvisNative.llmDownload(b.dataset.llmdl); setTimeout(renderLlm, 1500); });
    box.querySelectorAll("[data-llmretry]").forEach(b => b.onclick = () => { window.JarvisNative.llmRetry(b.dataset.llmretry); toast("Freigegeben. Vorher andere Apps schließen."); renderLlm(); loadModels(); });
    box.querySelectorAll("[data-llmdel]").forEach(b => b.onclick = () => {
      if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = "Wirklich?"; return; }
      window.JarvisNative.llmDelete(b.dataset.llmdel); setTimeout(() => { renderLlm(); loadModels(); }, 800);
    });
    box.insertAdjacentHTML("beforeend", '<div class="row"><label></label><div class="inl"><button class="jv-btn" id="jv-llmref">↻ Status aktualisieren</button></div></div>');
    $("jv-llmref").onclick = () => { renderLlm(); loadModels(); };
    const busy = (st.models || []).some(m => m.downloading);
    if (busy && $("jv-set").classList.contains("on")) llmT = setTimeout(renderLlm, 1500);
    else if (box.dataset.wasBusy) { delete box.dataset.wasBusy; loadModels(); }
    if (busy) box.dataset.wasBusy = 1;
  }
  addEventListener("jv-llm-dl", e => { if (e.detail) toast(e.detail, true, 7000); renderLlm(); });

  function openSettings(tab) {
    const box = $("jv-set");
    box.innerHTML = settingsHtml();
    fillLokal(); bindValues(box); fillVoices(); renderRoutines(J.settings.routinen || []); renderMemory(); renderThemes();
    const upd = () => { const pl = $("jv-privlist"); if (pl) pl.innerHTML = privList(Object.assign({}, J.settings, readValues(box))); };
    box.addEventListener("change", upd); upd();
    { const g = $("jv-gsetup"); if (g) g.onclick = () => { try { window.JarvisNative.googleSetup(); } catch (e) { } }; }
    if (HAS_LLM) setTimeout(renderLlm, 80);   // erst wenn das Fenster offen ist
    /* Anbieter antippen: passenden Kasten zeigen (darunter) und hervorheben */
    box.querySelectorAll('input[name="anb"]').forEach(r => r.addEventListener("change", () => {
      box.querySelectorAll("[data-box]").forEach(x => x.style.outline = "");
      const t = box.querySelector('[data-box="' + r.value + '"]');
      if (t) { t.style.outline = "2px solid #4fb6ff"; t.scrollIntoView({ behavior: "smooth", block: "start" }); }
    }));
    box.classList.add("on"); micSync();
    box.onclick = e => { if (e.target === box) closeSettings(); };
    box.querySelectorAll("[data-close]").forEach(b => b.onclick = closeSettings);
    box.querySelectorAll("nav button").forEach(b => b.onclick = () => {
      box.querySelectorAll("nav button").forEach(x => x.classList.toggle("on", x === b));
      box.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x.dataset.tab === b.dataset.tab));
    });
    if (tab) { const b = box.querySelector(`nav button[data-tab="${tab}"]`); if (b) b.click(); }
    box.querySelectorAll("[data-test]").forEach(b => b.onclick = async () => {
      const p = b.dataset.test, res = box.querySelector(`[data-res="${p}"]`);
      res.className = "res"; res.textContent = "teste …";
      try {
        J.settings = await api("/api/settings", readValues(box)); bindValues(box);
        const r = await api("/api/test", { anbieter: p });
        res.className = "res " + (r.ok ? "ok" : "bad");
        res.textContent = r.ok ? `✓ verbunden · ${r.models.length} Modell${r.models.length === 1 ? "" : "e"}` : "✗ " + r.fehler;
        loadModels();
      } catch (e) { res.className = "res bad"; res.textContent = "✗ " + e.message; }
    });
    $("jv-voicetest").onclick = async () => {
      const vals = readValues(box), r = $("jv-voiceres"); r.className = "res"; r.textContent = "";
      if (vals.stimme === "elevenlabs") { try { J.settings = await api("/api/settings", vals); bindValues(box); } catch (e) { r.className = "res bad"; r.textContent = e.message; return; } }
      else J.settings = Object.assign({}, J.settings, vals);   // nur zum Testen, wird beim Schließen verworfen
      SPEAK.reset(); SPEAK.say(`Hallo${J.settings.nutzer ? " " + J.settings.nutzer : ""}, ich bin ${J.settings.name || "Jarvis"}. So klinge ich.`);
      if (J.settings.stimme === "browser") { const v = J.pickVoice(); r.className = "res ok"; r.textContent = v ? "Stimme: " + v.name : "Systemstimme"; }
      if (J.settings.stimme === "aus") { r.textContent = "Stimme ist aus"; }
    };
    $("jv-memaddbtn").onclick = async () => { const i = $("jv-memadd"); if (!i.value.trim()) return; await api("/api/memory", { text: i.value }); i.value = ""; renderMemory(); };
    $("jv-memclear").onclick = async e => {
      const b = e.currentTarget; if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = "Wirklich alles löschen? Nochmal klicken"; setTimeout(() => { delete b.dataset.sure; b.textContent = "Alles löschen"; }, 4000); return; }
      await api("/api/memory/clear", {}); renderMemory(); b.textContent = "Alles löschen"; delete b.dataset.sure;
    };
    $("jv-rtadd").onclick = () => { const l = readRoutines(); l.push({ satz: "", aktion: "sagen", wert: "" }); renderRoutines(l); };
    $("jv-save").onclick = async () => {
      const res = $("jv-saveres"); res.className = "res"; res.textContent = "speichere …";
      try {
        const before = JSON.stringify([J.settings.anbieter, J.settings.ollama_url, J.settings.ollama_key, J.settings.claude_key, J.settings.openai_url, J.settings.openai_key, J.settings.strikt_lokal]);
        J.settings = await api("/api/settings", readValues(box));
        applySettings();
        res.className = "res ok"; res.textContent = "✓ gespeichert";
        if (before !== JSON.stringify([J.settings.anbieter, J.settings.ollama_url, J.settings.ollama_key, J.settings.claude_key, J.settings.openai_url, J.settings.openai_key, J.settings.strikt_lokal])) loadModels();
        setTimeout(closeSettings, 450);
      } catch (e) { res.className = "res bad"; res.textContent = "✗ " + e.message; }
    };
  }
  function closeSettings() { $("jv-set").classList.remove("on"); api("/api/settings").then(x => { J.settings = x; applySettings(); }).catch(() => micSync()); }
  J.openSettings = openSettings;
  function applySettings() {
    document.body.classList.toggle("jv-nochat", !J.settings.chat_sichtbar);
    const inp = $("jv-input"); if (inp) inp.placeholder = "Schreib " + (J.settings.name || "Jarvis") + " etwas …";
    if (MIC.rec && (MIC.cont !== (J.settings.mikro !== "aus") || MIC.rec.lang !== J.settings.sprache)) { micStop(); MIC.rec = null; }
    MIC.paused = false;
    micSync(); privBadge(); J.emit("settings", J.settings);
  }

  /* =============================================================== Start */
  function start() {
    if (J.started) return;
    J.started = true; $("jv-intro").classList.add("off");
    ac(); tone(330, 990, .5, .06);
    try { if (window.speechSynthesis) { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } } catch (e) { }
    J.S.pulse = 1; J.emit("start");
    micSync();
    if (J.settings.briefing_beim_start) setTimeout(() => send("Briefing bitte", { hidden: true }), 600);
  }
  J.start = start;

  /* =============================================================== Zeichenschleife */
  let cv, ctx, W = 0, H = 0, DPR = 1, last = performance.now();
  function resize() {
    W = innerWidth; H = innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(2.8e6 / Math.max(1, W * H)));
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    if (J.theme && J.theme.resize) J.theme.resize(W, H);
  }
  function loop(now) {
    const S = J.S, dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
    S.t += dt; S.dt = dt;
    const k = x => Math.min(1, dt * x);
    S.speak += ((J.state === "speaking" ? 1 : 0) - S.speak) * k(4);
    S.think += ((J.state === "thinking" ? 1 : 0) - S.think) * k(3);
    S.listen += ((J.state === "listening" ? 1 : MIC.running ? 0.35 : 0) - S.listen) * k(4);
    const lv = J.fakeLevel ? J.fakeLevel(S.t) : SPEAK.level(S.t, dt);   // fakeLevel: nur für Tests/Aufnahmen
    S.level += (lv - S.level) * k(lv > S.level ? 22 : 8);
    const ml = micLevelNow(); S.mic += (ml - S.mic) * k(ml > S.mic ? 20 : 6);
    S.pulse *= Math.exp(-dt * 2.2);
    if (J.theme && J.theme.draw) {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      try { J.theme.draw(ctx, W, H, S); } catch (e) { console.error(e); J.theme.draw = null; }
    }
    requestAnimationFrame(loop);
  }

  async function boot() {
    try { J.settings = await api("/api/settings"); }
    catch (e) {
      J.settings = { name: "Jarvis", mikro: "aus", stimme: "browser", chat_sichtbar: true, sounds: true, routinen: [] };
      setTimeout(() => toast(location.protocol === "file:" ? "Bitte nicht die Datei direkt öffnen: server.py starten und http://localhost:5050 aufrufen." : "Jarvis-Server nicht erreichbar. Läuft server.py?", true, 12000), 300);
    }
    buildUI();
    cv = $("jv-canvas"); ctx = cv.getContext("2d");
    addEventListener("resize", resize); resize();
    if (J.theme && J.theme.init) { try { J.theme.init(J); } catch (e) { console.error(e); } resize(); }
    restoreHistory();
    J.timers = store.get("timers", []).filter(t => t.end > Date.now()); renderTimers();
    document.body.classList.add("jv-s-idle");
    requestAnimationFrame(loop);
    const st = $("jv-introst");
    const r = await loadModels();
    if (st) st.textContent = !r ? "Server nicht erreichbar" : r.modell ? "KI bereit · " + PROV[r.anbieter] + " · " + r.modell : "Keine KI gefunden · nach dem Start oben links in die Einstellungen";
    if (!SR) addMsg("note", "Hinweis: Spracheingabe gibt es nur in Chrome oder Edge. Schreiben geht überall.");
  }
  if (document.readyState === "complete") boot(); else addEventListener("load", boot);
})();
