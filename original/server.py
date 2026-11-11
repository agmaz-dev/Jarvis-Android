#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
JARVIS · YouTube-Edition
Ein Server für drei Arten von KI:
  - Ollama (lokal, kostenlos, ohne Schlüssel)
  - Claude (Anthropic, API-Schlüssel)
  - OpenAI-kompatibel (OpenAI, Groq, OpenRouter, LM Studio ... mit Basis-Adresse und Schlüssel)
Nur Python-Standardbibliothek, nichts zu installieren.
Start:  python server.py     danach im Browser:  http://localhost:5050
"""
import datetime
import json
import os
import re
import shutil
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

if sys.version_info < (3, 8):
    sys.exit("Python 3.8 oder neuer wird benötigt.")

VERSION = "1.1"
BASE = os.path.dirname(os.path.realpath(__file__))
SETTINGS_FILE = os.path.join(BASE, "einstellungen.json")
MEMORY_FILE = os.path.join(BASE, "gedaechtnis.json")
PORT = int(os.environ.get("JARVIS_PORT", "5050"))
HOST = "127.0.0.1"
LOCK = threading.Lock()
SECRET = ("claude_key", "openai_key", "eleven_key")
MASK = "••••"

DEFAULTS = {
    "name": "Jarvis",
    "nutzer": "",
    "persona": "",
    "anbieter": "ollama",            # ollama | claude | openai
    "modell": "",                    # leer = erstes verfügbares Modell
    "ollama_url": "http://localhost:11434",
    "claude_key": "",
    "openai_key": "",
    "openai_url": "https://api.openai.com/v1",
    "websuche": True,                # nur Claude
    "antwortlaenge": "kurz",         # kurz | normal | ausfuehrlich
    "stimme": "browser",             # browser | elevenlabs | aus
    "browser_stimme": "",
    "tempo": 1.0,
    "tonhoehe": 1.0,
    "lautstaerke": 1.0,
    "eleven_key": "",
    "eleven_voice": "",
    "eleven_modell": "eleven_multilingual_v2",
    "mikro": "nach_antwort",         # aus | immer | nach_antwort
    "weckwort_an": False,
    "weckwort": "Jarvis",
    "sprache": "de-DE",
    "auto_merken": True,
    "ort": "Berlin",
    "briefing_beim_start": False,
    "oberflaeche": "vortex",
    "chat_sichtbar": True,
    "sounds": True,
    "strikt_lokal": False,          # nichts verlässt den PC (nur Ollama, keine Online-Dienste)
    "privat_weiche": True,          # private Daten automatisch lokal statt Cloud
    "gedaechtnis_cloud": False,     # Gedächtnis auch an Cloud-KI senden
    "privat_woerter": "",           # eigene Stichwörter, die als privat gelten (Komma getrennt)
    "lokal_modell": "",             # Ollama-Modell für private Nachrichten
    "routinen": [
        {"satz": "guten morgen", "aktion": "briefing", "wert": ""},
        {"satz": "öffne youtube", "aktion": "webseite", "wert": "https://www.youtube.com"},
        {"satz": "pause machen", "aktion": "timer", "wert": "15"},
    ],
}

THEMES = {"vortex": "/jarvis.html", "nova": "/oberflaechen/nova.html", "sphaeren": "/oberflaechen/sphaeren.html",
          "aura": "/oberflaechen/aura.html", "gitter": "/oberflaechen/gitter.html",
          "begleiter": "/oberflaechen/begleiter.html", "band": "/oberflaechen/band.html"}
THEME_WORDS = {"vortex": "vortex", "wirbel": "vortex", "nova": "nova", "orange": "nova", "funken": "nova",
               "sphären": "sphaeren", "sphaeren": "sphaeren", "kugel": "sphaeren", "aura": "aura", "gitter": "gitter",
               "lattice": "gitter", "begleiter": "begleiter", "companion": "begleiter", "augen": "begleiter",
               "band": "band", "ribbon": "band", "ring": "band"}
SITES = {"youtube": "https://www.youtube.com", "google": "https://www.google.com", "twitch": "https://www.twitch.tv",
         "github": "https://github.com", "wikipedia": "https://de.wikipedia.org", "gmail": "https://mail.google.com",
         "netflix": "https://www.netflix.com", "spotify": "https://open.spotify.com", "amazon": "https://www.amazon.de",
         "reddit": "https://www.reddit.com", "maps": "https://maps.google.com", "google maps": "https://maps.google.com",
         "wetter": "https://www.wetteronline.de", "nachrichten": "https://www.tagesschau.de", "tagesschau": "https://www.tagesschau.de"}


# ---------------------------------------------------------------- Einstellungen
def load_settings():
    s = dict(DEFAULTS)
    try:
        with open(SETTINGS_FILE, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            s.update({k: v for k, v in data.items() if k in DEFAULTS})
    except FileNotFoundError:
        save_settings(s)
    except (OSError, ValueError) as e:
        print(f"! einstellungen.json konnte nicht gelesen werden ({e}). Standardwerte werden genutzt.")
    return s


def save_settings(s):
    tmp = SETTINGS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False, indent=2)
    os.replace(tmp, SETTINGS_FILE)


def public_settings(s):
    out = dict(s)
    for k in SECRET:
        v = str(s.get(k) or "")
        out[k] = (MASK + v[-4:]) if v else ""
    return out


def update_settings(data):
    with LOCK:
        s = load_settings()
        for k, v in (data or {}).items():
            if k not in DEFAULTS:
                continue
            if k in SECRET:
                v = str(v or "").strip()
                if v.startswith(MASK):
                    continue          # unverändert (nur die Maske kam zurück)
            d = DEFAULTS[k]
            try:
                if isinstance(d, bool):
                    v = bool(v)
                elif isinstance(d, float):
                    v = max(0.1, min(3.0, float(v)))
                elif isinstance(d, list):
                    v = [r for r in v if isinstance(r, dict) and str(r.get("satz", "")).strip()][:40]
                    v = [{"satz": str(r.get("satz", ""))[:80].strip(), "aktion": str(r.get("aktion", "sagen"))[:20],
                          "wert": str(r.get("wert", ""))[:400]} for r in v]
                else:
                    v = str(v)[:4000].strip()
            except (TypeError, ValueError):
                continue
            if k in ("ollama_url", "openai_url"):
                v = v.rstrip("/")
            s[k] = v
        save_settings(s)
        return s


# ---------------------------------------------------------------- Gedächtnis
def mem_load():
    try:
        with open(MEMORY_FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, list) else []
    except (OSError, ValueError):
        return []


def mem_save(items):
    tmp = MEMORY_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    os.replace(tmp, MEMORY_FILE)


def _norm(t):
    return re.sub(r"[^a-z0-9äöüß ]", "", t.lower()).strip()


def mem_add(text):
    text = re.sub(r"\s+", " ", str(text or "")).strip(" .,:;-")[:300]
    if len(text) < 3:
        return None
    with LOCK:
        items = mem_load()
        n = _norm(text)
        for it in items:
            if _norm(it.get("text", "")) == n:
                return it
        it = {"id": uuid.uuid4().hex[:8], "text": text[0].upper() + text[1:], "datum": datetime.date.today().isoformat()}
        items.append(it)
        mem_save(items[-300:])
        return it


def mem_delete(mid=None, match=None):
    with LOCK:
        items = mem_load()
        if mid:
            keep = [i for i in items if i.get("id") != mid]
        else:
            words = [w for w in _norm(match or "").split() if len(w) > 2]
            if not words:
                return 0
            keep = [i for i in items if not all(w in _norm(i.get("text", "")) for w in words)]
        n = len(items) - len(keep)
        mem_save(keep)
        return n


def mem_text(limit=4000):
    items = mem_load()
    lines, size = [], 0
    for it in reversed(items):
        line = f"- {it.get('text', '')} ({it.get('datum', '')})"
        size += len(line)
        if size > limit:
            break
        lines.append(line)
    return "\n".join(reversed(lines))


# ---------------------------------------------------------------- HTTP-Helfer
def http(url, data=None, headers=None, timeout=20, method=None):
    body = json.dumps(data).encode("utf-8") if data is not None else None
    h = {"User-Agent": "Jarvis-YouTube-Edition/" + VERSION}
    if body is not None:
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    return urllib.request.urlopen(urllib.request.Request(url, data=body, headers=h, method=method), timeout=timeout)


def get_json(url, headers=None, timeout=10):
    with http(url, headers=headers, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def http_error_text(e):
    try:
        raw = e.read().decode("utf-8", "replace")
        j = json.loads(raw)
        if isinstance(j.get("error"), dict):
            return j["error"].get("message") or raw[:200]
        return str(j.get("error") or j.get("message") or j.get("detail") or raw[:200])
    except Exception:
        return f"HTTP {getattr(e, 'code', '?')}"


CACHE = {}


def cached(key, sec, fn):
    hit = CACHE.get(key)
    if hit and time.time() - hit[0] < sec:
        return hit[1]
    val = fn()
    CACHE[key] = (time.time(), val)
    return val


# ---------------------------------------------------------------- Modelle
def ollama_models(s):
    try:
        j = get_json(s["ollama_url"] + "/api/tags", timeout=2.5)
        names = [m.get("name") for m in j.get("models", []) if m.get("name")]
        chat = [n for n in names if "embed" not in n.lower()]
        if not chat:
            return {"ok": False, "models": [], "fehler": "Ollama läuft, aber es ist kein Sprachmodell installiert. Im Terminal: ollama pull llama3.2"}
        return {"ok": True, "models": chat}
    except urllib.error.HTTPError as e:
        return {"ok": False, "models": [], "fehler": f"Ollama antwortet mit Fehler: {http_error_text(e)}"}
    except Exception:
        return {"ok": False, "models": [], "fehler": f"Ollama nicht erreichbar unter {s['ollama_url']}. Läuft Ollama? (Taskleiste oder: ollama serve)"}


def claude_models(s):
    key = s.get("claude_key")
    if not key:
        return {"ok": False, "models": [], "fehler": "Kein Claude-Schlüssel eingetragen."}

    def fetch():
        j = get_json(ANTHROPIC + "/v1/models?limit=100",
                     headers={"x-api-key": key, "anthropic-version": "2023-06-01"}, timeout=8)
        return [m["id"] for m in j.get("data", []) if m.get("id")]
    try:
        ids = cached("claude:" + key[-6:], 600, fetch)
        return {"ok": bool(ids), "models": ids, "fehler": "" if ids else "Keine Modelle gefunden."}
    except urllib.error.HTTPError as e:
        msg = http_error_text(e)
        if e.code == 401:
            msg = "Schlüssel ungültig (401). Bitte prüfen, ob er vollständig kopiert wurde."
        return {"ok": False, "models": [], "fehler": "Claude: " + msg}
    except Exception as e:
        return {"ok": False, "models": [], "fehler": f"Claude nicht erreichbar ({type(e).__name__})."}


NON_CHAT = re.compile(r"embed|tts|whisper|dall-e|moderation|audio|realtime|transcribe|image|davinci|babbage|search|computer-use|sora", re.I)


def openai_models(s):
    base, key = s.get("openai_url") or "", s.get("openai_key") or ""
    if not base:
        return {"ok": False, "models": [], "fehler": "Keine Basis-Adresse eingetragen."}
    local = "localhost" in base or "127.0.0.1" in base
    if not key and not local:
        return {"ok": False, "models": [], "fehler": "Kein Schlüssel eingetragen."}

    def fetch():
        j = get_json(base + "/models", headers={"Authorization": "Bearer " + key} if key else None, timeout=8)
        ids = [m.get("id") for m in j.get("data", []) if m.get("id")]
        if "api.openai.com" in base:
            ids = [i for i in ids if not NON_CHAT.search(i)]
        return sorted(ids)
    try:
        ids = cached("openai:" + base + key[-6:], 600, fetch)
        return {"ok": bool(ids), "models": ids, "fehler": "" if ids else "Keine Modelle gefunden."}
    except urllib.error.HTTPError as e:
        return {"ok": False, "models": [], "fehler": f"API-Fehler: {http_error_text(e)}"}
    except Exception as e:
        return {"ok": False, "models": [], "fehler": f"Nicht erreichbar: {base} ({type(e).__name__})"}


def all_models(s):
    out = {}
    threads = []

    def run(k, fn):
        out[k] = fn(s)
    for k, fn in (("ollama", ollama_models), ("claude", claude_models), ("openai", openai_models)):
        t = threading.Thread(target=run, args=(k, fn))
        t.start()
        threads.append(t)
    for t in threads:
        t.join(12)
    return out


def pick_model(s, models=None):
    a = s.get("anbieter")
    if a not in ("ollama", "claude", "openai"):
        a = "ollama"
    m = s.get("modell") or ""
    lst = (models or {}).get(a, {}).get("models") if models else None
    if m and (lst is None or m in lst):
        return a, m
    if lst is None:
        lst = {"ollama": ollama_models, "claude": claude_models, "openai": openai_models}[a](s).get("models", [])
    if a == "claude":
        pref = [x for x in lst if "sonnet" in x] or lst
        return a, (pref[0] if pref else "")
    return a, (lst[0] if lst else "")


# ---------------------------------------------------------------- System und Wetter
CPU_PREV = [None, 0.0, None]
CPU_LOCK = threading.Lock()


def _cpu_sample():
    try:
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes

            class FT(ctypes.Structure):
                _fields_ = [("lo", wintypes.DWORD), ("hi", wintypes.DWORD)]
            i, k, u = FT(), FT(), FT()
            if not ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(i), ctypes.byref(k), ctypes.byref(u)):
                return None
            f = lambda x: (x.hi << 32) | x.lo
            return f(i), f(k) + f(u)
        if sys.platform == "darwin":
            return None
        with open("/proc/stat") as fh:
            v = [int(x) for x in fh.readline().split()[1:]]
        return v[3] + (v[4] if len(v) > 4 else 0), sum(v[:8])
    except Exception:
        return None


def cpu_prozent():
    with CPU_LOCK:
        now = time.time()
        if CPU_PREV[0] and now - CPU_PREV[1] < 0.6 and CPU_PREV[2] is not None:
            return CPU_PREV[2]
        a = CPU_PREV[0] if (CPU_PREV[0] and now - CPU_PREV[1] < 20) else None
        if a is None:
            a = _cpu_sample()
            if a is None:
                return None
            time.sleep(0.3)
        b = _cpu_sample()
        if b is None:
            return None
        di, dt = b[0] - a[0], b[1] - a[1]
        CPU_PREV[0], CPU_PREV[1] = b, time.time()
        if dt > 0:
            CPU_PREV[2] = max(0.0, min(100.0, 100.0 * (1 - di / dt)))
        return CPU_PREV[2]


def ram_gb():
    try:
        if os.name == "nt":
            import ctypes

            class MS(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("sullAvailExtendedVirtual", ctypes.c_ulonglong)]
            m = MS()
            m.dwLength = ctypes.sizeof(MS)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m)):
                return m.ullTotalPhys / 2 ** 30, m.ullAvailPhys / 2 ** 30
            return None
        mi = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":", 1)
                mi[k] = int(v.split()[0])
        return mi["MemTotal"] / 1048576, mi.get("MemAvailable", mi.get("MemFree", 0)) / 1048576
    except Exception:
        return None


def uptime_s():
    try:
        if os.name == "nt":
            import ctypes
            k = ctypes.windll.kernel32
            k.GetTickCount64.restype = ctypes.c_ulonglong
            return k.GetTickCount64() / 1000.0
        with open("/proc/uptime") as f:
            return float(f.read().split()[0])
    except Exception:
        return None


def dauer(sec):
    sec = int(sec)
    d, h, m = sec // 86400, sec % 86400 // 3600, sec % 3600 // 60
    if d:
        return f"{d} Tag{'e' if d > 1 else ''} {h} Std"
    if h:
        return f"{h} Std {m} Min"
    return f"{m} Min"


def system_info():
    s = {"kerne": os.cpu_count()}
    c = cpu_prozent()
    s["cpu"] = None if c is None else round(c)
    r = ram_gb()
    if r and r[0]:
        s["ram"] = round(100 * (r[0] - r[1]) / r[0])
        s["ram_belegt"], s["ram_gesamt"] = round(r[0] - r[1], 1), round(r[0], 1)
    else:
        s["ram"] = s["ram_belegt"] = s["ram_gesamt"] = None
    try:
        du = shutil.disk_usage(BASE)
        s["platte"] = round(100 * (du.total - du.free) / du.total)
        s["platte_frei"] = round(du.free / 1e9)
    except OSError:
        s["platte"] = s["platte_frei"] = None
    up = uptime_s()
    s["laufzeit"] = None if up is None else dauer(up)
    warn = []
    if s["cpu"] is not None and s["cpu"] >= 85:
        warn.append(f"CPU {s['cpu']} Prozent")
    if s["ram"] is not None and s["ram"] >= 90:
        warn.append(f"Arbeitsspeicher {s['ram']} Prozent")
    if s["platte"] is not None and s["platte"] >= 95:
        warn.append(f"Festplatte {s['platte']} Prozent")
    s["auffaellig"] = warn
    return s


WMO = {0: ("klar", "sonne"), 1: ("überwiegend klar", "sonne"), 2: ("teils bewölkt", "wolkig"), 3: ("bedeckt", "bedeckt"),
       45: ("Nebel", "nebel"), 48: ("Nebel", "nebel"), 51: ("leichter Nieselregen", "regen"), 53: ("Nieselregen", "regen"),
       55: ("Nieselregen", "regen"), 56: ("gefrierender Nieselregen", "regen"), 57: ("gefrierender Nieselregen", "regen"),
       61: ("leichter Regen", "regen"), 63: ("Regen", "regen"), 65: ("starker Regen", "regen"), 66: ("gefrierender Regen", "regen"),
       67: ("gefrierender Regen", "regen"), 71: ("leichter Schneefall", "schnee"), 73: ("Schneefall", "schnee"),
       75: ("starker Schneefall", "schnee"), 77: ("Schneegriesel", "schnee"), 80: ("Regenschauer", "regen"),
       81: ("Regenschauer", "regen"), 82: ("heftige Regenschauer", "regen"), 85: ("Schneeschauer", "schnee"),
       86: ("Schneeschauer", "schnee"), 95: ("Gewitter", "gewitter"), 96: ("Gewitter mit Hagel", "gewitter"),
       99: ("Gewitter mit Hagel", "gewitter")}
GEO_URL = os.environ.get("JARVIS_GEO_URL") or "https://geocoding-api.open-meteo.com/v1/search"
WETTER_URL = os.environ.get("JARVIS_WETTER_URL") or "https://api.open-meteo.com/v1/forecast"
ANTHROPIC = os.environ.get("JARVIS_ANTHROPIC_URL") or "https://api.anthropic.com"


def geocode(ort):
    def fetch():
        q = urllib.parse.urlencode({"name": ort, "count": 1, "language": "de", "format": "json"})
        j = get_json(GEO_URL + "?" + q, timeout=8)
        r = (j.get("results") or [None])[0]
        if not r:
            raise ValueError(f"Ort '{ort}' nicht gefunden")
        return r["latitude"], r["longitude"], r.get("name", ort)
    return cached("geo:" + ort.lower(), 86400, fetch)


def wetter(s):
    ort = (s.get("ort") or "Berlin").strip()
    if s.get("strikt_lokal"):
        return {"fehler": "Strikt lokal ist an, deshalb wird kein Wetter aus dem Internet geladen.", "ort": ort}

    def fetch():
        lat, lon, name = geocode(ort)
        q = urllib.parse.urlencode({"latitude": lat, "longitude": lon,
                                    "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day",
                                    "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
                                    "timezone": "auto", "forecast_days": 1})
        j = get_json(WETTER_URL + "?" + q, timeout=8)
        c, d = j["current"], j.get("daily") or {}
        text, icon = WMO.get(int(c["weather_code"]), ("wechselhaft", "wolkig"))
        if icon == "sonne" and not c.get("is_day", 1):
            icon = "mond"
        first = lambda k: (d.get(k) or [None])[0]
        return {"ort": name, "temp": round(float(c["temperature_2m"])), "gefuehlt": round(float(c["apparent_temperature"])),
                "text": text, "icon": icon, "wind": round(float(c.get("wind_speed_10m") or 0)),
                "tmax": None if first("temperature_2m_max") is None else round(first("temperature_2m_max")),
                "tmin": None if first("temperature_2m_min") is None else round(first("temperature_2m_min")),
                "regen": first("precipitation_probability_max"), "quelle": "Open-Meteo"}
    try:
        return cached("wetter:" + ort.lower(), 600, fetch)
    except Exception as e:
        return {"fehler": str(e)[:160] or type(e).__name__, "ort": ort}


def wetter_satz(w):
    if w.get("fehler"):
        return f"Wetter für {w.get('ort')}: nicht abrufbar ({w['fehler']}). Sag ehrlich, dass das Wetter gerade nicht lädt."
    t = f"Wetter in {w['ort']} jetzt: {w['temp']} Grad (gefühlt {w['gefuehlt']}), {w['text']}, Wind {w['wind']} km/h"
    if w.get("tmax") is not None:
        t += f", heute {w['tmin']} bis {w['tmax']} Grad"
    if w.get("regen") is not None:
        t += f", Regenwahrscheinlichkeit bis {w['regen']} Prozent"
    return t + ". Quelle: Open-Meteo."


def system_satz(si):
    p = lambda v, u: "nicht messbar" if v is None else f"{v}{u}"
    return (f"System jetzt: CPU {p(si['cpu'], ' Prozent')}, Arbeitsspeicher {p(si['ram'], ' Prozent')}, "
            f"Festplatte {p(si['platte'], ' Prozent belegt')}, Rechner läuft seit {p(si['laufzeit'], '')}. "
            f"Auffällig: {', '.join(si['auffaellig']) if si['auffaellig'] else 'nichts'}.")


# ---------------------------------------------------------------- Befehle erkennen (funktioniert mit jedem Modell)
ZAHL = {"ein": 1, "eine": 1, "einer": 1, "einem": 1, "zwei": 2, "drei": 3, "vier": 4, "fünf": 5, "fuenf": 5, "sechs": 6,
        "sieben": 7, "acht": 8, "neun": 9, "zehn": 10, "elf": 11, "zwölf": 12, "fünfzehn": 15, "zwanzig": 20,
        "dreißig": 30, "dreissig": 30, "vierzig": 40, "fünfzig": 50, "sechzig": 60, "halbe": 0.5}
BRIEF_RE = re.compile(r"\b(bist du da|bist du wach|was geht ab|wach auf|aufwachen|briefing|lagebericht|status ?bericht|status bitte|guten morgen|moin|melde dich)\b")
WETTER_RE = re.compile(r"wetter|regnet|regen|schnee|grad (draußen|draussen)|temperatur|draußen|draussen|regenschirm|jacke|sonnig|sonne scheint")
SYS_RE = re.compile(r"\b(system|cpu|prozessor|arbeitsspeicher|ram|festplatte|auslastung|speicherplatz|rechner)\b")
TIMER_RE = re.compile(r"(?:in|nach|für|auf)\s+(\d+(?:[.,]\d+)?|" + "|".join(ZAHL) + r")\s*(sekunden?|sek|minuten?|min|stunden?|std)\b")


def parse_timer(u):
    if not re.search(r"erinner|timer|wecker|weck mich|stopp?uhr|countdown|sag mir bescheid|sag bescheid", u):
        return None
    m = TIMER_RE.search(u)
    if not m:
        return None
    raw = m.group(1).replace(",", ".")
    n = ZAHL.get(raw)
    if n is None:
        try:
            n = float(raw)
        except ValueError:
            return None
    unit = m.group(2)
    sek = n * (3600 if unit.startswith(("stunde", "std")) else 60 if unit.startswith("min") else 1)
    if not 1 <= sek <= 86400:
        return None
    rest = u[m.end():].strip()
    rest = re.sub(r"^(an|daran|dass|das|zu|ans|mich|bitte)\s+", "", rest)
    rest = re.sub(r"^(dass|das|an)\s+", "", rest).strip(" .!?")
    rest = re.split(r"\s+(?:und|dann)\s+(?:öffne|oeffne|mach|zeig|stell|sag|wechsel|merk|starte|such)\b", rest)[0].strip(" ,.")
    if not rest:
        pre = re.sub(r".*?(erinner\w*\s+(mich\s+)?(an|daran)?)", "", u[:m.start()]).strip(" ,.")
        rest = pre if pre and len(pre) < 80 and not re.search(r"timer|weck|stell|countdown|stopp", pre) else ""
    return {"sek": int(sek), "text": rest[:120] or "Timer abgelaufen"}


def find_url(u, s):
    if not re.search(r"\b(öffne|oeffne|öffnen|mach .* auf|geh auf|gehe auf|zeig mir die seite|ruf .* auf|starte)\b", u):
        return None
    m = re.search(r"(https?://\S+|\b[\w-]+\.(?:de|com|org|net|io|tv|eu|info)\b\S*)", u)
    if m:
        url = m.group(1)
        return {"url": url if url.startswith("http") else "https://" + url, "name": url}
    for name in sorted(SITES, key=len, reverse=True):
        if re.search(r"\b" + re.escape(name) + r"\b", u):
            return {"url": SITES[name], "name": name.title()}
    return None


def merk_text(t):
    """'dass ich am Freitag Zahnarzt habe' -> 'Ich habe am Freitag Zahnarzt'."""
    t = t.strip(" .!?")
    m = re.match(r"(?i)(?:dass|das)\s+(.*)", t)
    if m:
        w = m.group(1).split()
        if len(w) >= 3:
            n = 2 if w[0].lower() in ("mein", "meine", "meinem", "meinen", "meiner", "dein", "deine", "unser", "unsere") else 1
            w = w[:n] + [w[-1]] + w[n:-1]
        t = " ".join(w)
    return t


def route(u, s, orig=None):
    """Erkennt Befehle vor dem KI-Aufruf. Liefert (aktionen, kontext, direkte_antwort)."""
    orig = orig or u
    actions, ctx, direct = [], [], None
    for r in s.get("routinen") or []:
        satz = _norm(r.get("satz", ""))
        if satz and satz in _norm(u):
            a, w = r.get("aktion"), (r.get("wert") or "").strip()
            if a == "briefing":
                u += " briefing"
            elif a == "webseite" and w:
                actions.append({"typ": "webseite", "url": w if w.startswith("http") else "https://" + w, "name": r["satz"]})
                ctx.append(f"Die Webseite {w} wird gerade geöffnet (Routine '{r['satz']}'). Bestätige in einem kurzen Satz.")
            elif a == "sagen" and w:
                direct = w
            elif a == "oberflaeche" and w in THEMES:
                actions.append({"typ": "oberflaeche", "name": w, "url": THEMES[w]})
                ctx.append(f"Die Oberfläche wechselt gleich auf {w}. Bestätige kurz.")
            elif a == "timer":
                try:
                    mins = float(w.replace(",", "."))
                    actions.append({"typ": "timer", "sek": int(mins * 60), "text": r["satz"]})
                    ctx.append(f"Ein Timer über {w} Minuten läuft jetzt (Routine '{r['satz']}'). Bestätige kurz.")
                except ValueError:
                    pass
            actions.append({"typ": "routine", "satz": r["satz"]})

    m = re.search(r"\b(merk dir|merke dir|speicher dir|speichere dir|notier dir|notiere dir|vergiss nicht)\b[:,]?\s*(.+)", orig, re.I | re.S)
    if m:
        it = mem_add(merk_text(m.group(2)))
        if it:
            actions.append({"typ": "gedaechtnis", "aktion": "gespeichert", "text": it["text"]})
            ctx.append(f"Du hast gerade im Gedächtnis gespeichert: '{it['text']}'. Bestätige kurz und natürlich.")
    m = re.search(r"\bvergiss\b\s+(?:bitte\s+)?(?:dass|das|die notiz)?\s*(.+)", u)
    if m and not re.search(r"vergiss nicht", u):
        n = mem_delete(match=m.group(1))
        actions.append({"typ": "gedaechtnis", "aktion": "geloescht", "text": m.group(1), "anzahl": n})
        ctx.append(f"Du hast {n} passende Notiz(en) aus dem Gedächtnis gelöscht." if n else
                   "Im Gedächtnis gab es dazu keine passende Notiz. Sag das ehrlich.")

    t = parse_timer(u)
    if t:
        actions.append({"typ": "timer", **t})
        mins = t["sek"] / 60
        ctx.append(f"Ein Timer läuft jetzt: {('%g Minuten' % mins) if t['sek'] >= 60 else str(t['sek']) + ' Sekunden'}"
                   f", Erinnerungstext: '{t['text']}'. Bestätige kurz.")

    w = find_url(u, s)
    if w and not any(a["typ"] == "webseite" for a in actions):
        actions.append({"typ": "webseite", **w})
        ctx.append(f"Die Webseite {w['name']} wird gerade geöffnet. Bestätige in einem kurzen Satz.")

    if re.search(r"oberfläche|oberflaeche|design|aussehen|skin|ansicht", u):
        for word, tid in THEME_WORDS.items():
            if re.search(r"\b" + word + r"\b", u):
                actions.append({"typ": "oberflaeche", "name": tid, "url": THEMES[tid]})
                ctx.append(f"Die Oberfläche wechselt gleich auf {tid}. Bestätige kurz.")
                break

    brief = bool(BRIEF_RE.search(u))
    if brief:
        si, w = system_info(), wetter(s)
        actions.append({"typ": "briefing", "system": si, "wetter": w})
        ctx.append("WECK-BRIEFING. Nutze nur diese echten Daten:\n" + system_satz(si) + "\n" + wetter_satz(w) +
                   "\nAblauf, locker gesprochen, ohne Aufzählungszeichen: 1) Sag, dass du da bist. Ist 'Auffällig' = nichts, sag "
                   "'dein System läuft sauber', sonst nenne das Auffällige. Nenne zwei der Werte. 2) Das Wetter in einem Satz. "
                   "3) 'Heute steht an': nur, was im GEDÄCHTNIS nach Termin, Vorhaben oder To-do klingt. Steht nichts drin, sag das "
                   "in einem Satz. 4) Kurze Frage, womit du helfen kannst. Höchstens sechs Sätze.")
    else:
        if WETTER_RE.search(u):
            w = wetter(s)
            actions.append({"typ": "wetter", "wetter": w})
            ctx.append(wetter_satz(w))
        if SYS_RE.search(u):
            si = system_info()
            actions.append({"typ": "system", "system": si})
            ctx.append(system_satz(si))
    return actions, ctx, direct


# ---------------------------------------------------------------- Datenschutz
def ist_cloud(s, anbieter):
    if anbieter == "claude":
        return True
    if anbieter == "openai":
        u = (s.get("openai_url") or "").lower()
        return not ("localhost" in u or "127.0.0.1" in u)
    return False


def _luhn(num):
    d = [int(x) for x in num][::-1]
    return sum(x if i % 2 == 0 else (x * 2 - 9 if x * 2 > 9 else x * 2) for i, x in enumerate(d)) % 10 == 0


PRIV_RE = [
    ("E-Mail-Adresse", re.compile(r"[\w.+-]+@[\w-]+\.[a-z]{2,}", re.I)),
    ("IBAN", re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b")),
    ("Adresse", re.compile(r"\b[A-ZÄÖÜa-zäöü][\wäöüß-]*(?:straße|strasse|str\.|weg|gasse|platz|allee|ring|damm|chaussee)\s+\d{1,4}\s?[a-z]?\b", re.I)),
    ("Postleitzahl", re.compile(r"\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß]{2,}")),
    ("API-Schlüssel", re.compile(r"\b(?:sk|pk|gsk|xai)[-_][A-Za-z0-9_-]{12,}")),
]
PHONE_RE = re.compile(r"(?<![\w.,])(?:\+|00)\d[\d\s/()-]{6,}\d|(?<![\w.,])0\d{2,5}[\s/-]?\d[\d\s/-]{3,}\d")
CARD_RE = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")
PRIV_WORT = {
    "Zugangsdaten": r"passwort|kennwort|password|\bpin\b|\btan\b|zugangsdaten|logindaten|login-daten|geheimzahl|api[- ]?key|api[- ]?schlüssel",
    "Gesundheit": r"diagnose|befund|\bkrank|arzt\b|ärztin|klinik|medikament|therapie|depression|arztbrief|blutwerte|krankschreibung|psychiat|schwanger",
    "Ausweis oder Steuer": r"ausweisnummer|personalausweis|reisepass|steuer-?id|steuernummer|steueridentifikation|sozialversicherungsnummer|versichertennummer",
    "Finanzen": r"kontonummer|kontostand|\bgehalt|kreditkarte|bankverbindung|schulden|kredit über",
}


def privat_erkennen(text, s):
    """Liefert eine Liste von Gründen, warum die Nachricht privat aussieht (leer = nichts erkannt)."""
    t = text or ""
    found = []
    if re.match(r"^\s*(privat|vertraulich|geheim)\b", t, re.I):
        found.append("als privat markiert")
    for name, rx in PRIV_RE:
        if rx.search(t):
            found.append(name)
    for m in ([] if "IBAN" in found else PHONE_RE.finditer(t)):
        if len(re.sub(r"\D", "", m.group(0))) >= 7:
            found.append("Telefonnummer")
            break
    for m in CARD_RE.finditer(t):
        d = re.sub(r"\D", "", m.group(0))
        if 13 <= len(d) <= 19 and _luhn(d):
            found.append("Kartennummer")
            break
    low = t.lower()
    for name, rx in PRIV_WORT.items():
        if re.search(rx, low):
            found.append(name)
    for w in re.split(r"[,;\n]+", s.get("privat_woerter") or ""):
        w = w.strip().lower()
        if len(w) >= 2 and re.search(r"(?<![\wäöüß])" + re.escape(w) + r"(?![\wäöüß])", low):
            found.append("eigenes Stichwort")
            break
    out = []
    for f in found:
        if f not in out:
            out.append(f)
    return out


def lokales_modell(s):
    om = ollama_models(s)
    if not om.get("ok"):
        return ""
    lst = om["models"]
    for cand in (s.get("lokal_modell"), s.get("modell") if s.get("anbieter") == "ollama" else ""):
        if cand and cand in lst:
            return cand
    return lst[0]


# ---------------------------------------------------------------- Prompt
LAENGE = {"kurz": "Antworte in der Regel in 1 bis 3 kurzen Sätzen.",
          "normal": "Antworte in der Regel in 2 bis 5 Sätzen.",
          "ausfuehrlich": "Antworte gründlich, aber gut vorlesbar."}
TAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"]


def system_prompt(s, ctx, websuche, mit_gedaechtnis=True):
    now = datetime.datetime.now()
    name = s.get("name") or "Jarvis"
    p = [f"Du bist {name}, ein persönlicher KI-Assistent im Stil von J.A.R.V.I.S.: ruhig, schlagfertig, hilfsbereit, mit einem "
         "Hauch trockenem Humor. Du sprichst Deutsch.",
         "Deine Antworten werden laut vorgelesen: kurze, natürliche Sätze. Kein Markdown, keine Sternchen, keine Aufzählungszeichen, "
         "keine Emojis, keine Links ausschreiben. " + LAENGE.get(s.get("antwortlaenge"), LAENGE["kurz"]),
         "Erfinde nichts. Wenn du etwas nicht weißt oder nicht nachsehen kannst, sag das ehrlich.",
         f"Heute ist {TAGE[now.weekday()]}, der {now.day}. {MONATE[now.month - 1]} {now.year}, es ist {now:%H:%M} Uhr."]
    if s.get("nutzer"):
        p.append(f"Dein Nutzer heißt {s['nutzer']}. Sprich ihn ab und zu mit Namen an.")
    if s.get("persona"):
        p.append("Zusätzliche Anweisungen deines Nutzers zu deiner Persönlichkeit: " + s["persona"])
    p.append("Fähigkeiten, die die Oberfläche selbst ausführt (der Nutzer muss es nur sagen): Timer und Erinnerungen, Webseiten "
             "öffnen, Wetter, Systemwerte, Weck-Briefing, Notizen merken und vergessen, Oberfläche wechseln. Behaupte nie, dass "
             "du etwas ausgeführt hast, wenn es unten nicht als erledigt steht.")
    if websuche:
        p.append("Du kannst das Web durchsuchen. Nutze es für aktuelle Fragen und nenne die Quelle in Worten.")
    else:
        p.append("Du hast keinen Internetzugang. Für aktuelle Ereignisse sag ehrlich, dass dein Wissen einen Stand hat.")
    if mit_gedaechtnis:
        p.append("GEDÄCHTNIS (was du dir über deinen Nutzer gemerkt hast):\n" + (mem_text() or "(noch leer)"))
    else:
        p.append("GEDÄCHTNIS: Aus Datenschutzgründen bleibt das Gedächtnis auf dem PC des Nutzers und wird dir nicht geschickt. "
                 "Fragt er danach oder nach 'heute steht an', sag kurz, dass die Notizen nur bei der lokalen KI verfügbar sind.")
    if s.get("auto_merken") and mit_gedaechtnis:
        p.append("Wenn der Nutzer dir etwas Dauerhaftes über sich erzählt (Name, Vorlieben, Projekte, Termine, Ziele), das noch "
                 "nicht im Gedächtnis steht, hänge ganz am Ende genau eine Zeile an: [merken: kurzer Satz in der dritten Person]. "
                 "Diese Zeile wird nicht vorgelesen. Sonst nie.")
    if ctx:
        p.append("GERADE ERLEDIGT / ECHTE DATEN:\n" + "\n".join(ctx))
    return "\n\n".join(p)


# ---------------------------------------------------------------- KI-Anbieter (Streaming)
class KIError(Exception):
    pass


def clean_history(msgs, ohne_privat=False):
    out = []
    for m in msgs or []:
        if ohne_privat and m.get("privat"):
            continue
        role = "assistant" if m.get("role") == "assistant" else "user"
        text = str(m.get("content") or "").strip()[:6000]
        if not text:
            continue
        if out and out[-1]["role"] == role:
            out[-1]["content"] += "\n" + text
        else:
            out.append({"role": role, "content": text})
    while out and out[0]["role"] != "user":
        out.pop(0)
    return out[-20:]


def stream_ollama(s, model, system, msgs):
    body = {"model": model, "stream": True, "messages": [{"role": "system", "content": system}] + msgs,
            "options": {"num_predict": 900}}
    try:
        with http(s["ollama_url"] + "/api/chat", body, timeout=300) as r:
            for line in r:
                if not line.strip():
                    continue
                j = json.loads(line.decode("utf-8"))
                if j.get("error"):
                    raise KIError("Ollama: " + str(j["error"]))
                c = (j.get("message") or {}).get("content") or ""
                if c:
                    yield c
                if j.get("done"):
                    break
    except urllib.error.HTTPError as e:
        msg = http_error_text(e)
        if e.code == 404 or "not found" in msg.lower():
            raise KIError(f"Das Modell '{model}' ist in Ollama nicht installiert. Im Terminal: ollama pull {model}")
        raise KIError("Ollama: " + msg)
    except urllib.error.URLError:
        raise KIError(f"Ollama ist nicht erreichbar ({s['ollama_url']}). Starte Ollama und versuch es nochmal.")


def _sse(r):
    for raw in r:
        line = raw.decode("utf-8", "replace").strip()
        if line.startswith("data:"):
            data = line[5:].strip()
            if data == "[DONE]":
                return
            try:
                yield json.loads(data)
            except ValueError:
                continue


def stream_claude(s, model, system, msgs, on_event):
    body = {"model": model, "max_tokens": 1200, "system": system, "messages": msgs, "stream": True}
    if s.get("websuche"):
        body["tools"] = [{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}]
    hdr = {"x-api-key": s.get("claude_key", ""), "anthropic-version": "2023-06-01"}
    try:
        with http(ANTHROPIC + "/v1/messages", body, hdr, timeout=300) as r:
            had_text = False
            for ev in _sse(r):
                t = ev.get("type")
                if t == "content_block_start":
                    b = ev.get("content_block") or {}
                    if b.get("type") == "server_tool_use":
                        on_event({"typ": "suche", "text": "Websuche läuft"})
                    elif b.get("type") == "text" and had_text:
                        yield " "
                elif t == "content_block_delta":
                    d = ev.get("delta") or {}
                    if d.get("type") == "text_delta" and d.get("text"):
                        had_text = True
                        yield d["text"]
                elif t == "error":
                    raise KIError("Claude: " + str((ev.get("error") or {}).get("message", "Fehler")))
    except urllib.error.HTTPError as e:
        msg = http_error_text(e)
        if e.code == 401:
            msg = "Schlüssel ungültig. Bitte in den Einstellungen prüfen."
        elif e.code == 400 and "credit" in msg.lower():
            msg = "Kein Guthaben mehr auf dem Anthropic-Konto."
        elif e.code == 404:
            msg = f"Modell '{model}' nicht gefunden."
        elif e.code == 529:
            msg = "Claude ist gerade überlastet. Gleich nochmal versuchen."
        raise KIError("Claude: " + msg)
    except urllib.error.URLError:
        raise KIError("Claude ist nicht erreichbar. Besteht eine Internetverbindung?")


def stream_openai(s, model, system, msgs):
    base, key = s.get("openai_url", ""), s.get("openai_key", "")
    body = {"model": model, "stream": True, "messages": [{"role": "system", "content": system}] + msgs}
    try:
        with http(base + "/chat/completions", body, {"Authorization": "Bearer " + key} if key else {}, timeout=300) as r:
            for ev in _sse(r):
                if ev.get("error"):
                    raise KIError("API: " + str(ev["error"].get("message") if isinstance(ev["error"], dict) else ev["error"]))
                ch = (ev.get("choices") or [{}])[0]
                c = (ch.get("delta") or {}).get("content")
                if c:
                    yield c
    except urllib.error.HTTPError as e:
        msg = http_error_text(e)
        if e.code == 401:
            msg = "Schlüssel ungültig. Bitte in den Einstellungen prüfen."
        elif e.code == 429:
            msg = "Limit erreicht oder kein Guthaben (429)."
        raise KIError("API: " + msg)
    except urllib.error.URLError:
        raise KIError(f"API nicht erreichbar ({base}).")


class TagFilter:
    """Entfernt <think>...</think> und [merken: ...] aus dem Strom und sammelt die Merk-Einträge."""

    def __init__(self):
        self.buf, self.think, self.merk = "", False, []

    def feed(self, text, final=False):
        self.buf += text
        out = []
        while self.buf:
            if self.think:
                j = self.buf.find("</think>")
                if j < 0:
                    self.buf = self.buf[-8:] if not final else ""
                    break
                self.buf, self.think = self.buf[j + 8:], False
                continue
            i1, i2 = self.buf.find("<think>"), self.buf.find("[")
            cand = [i for i in (i1, i2) if i >= 0]
            if not cand:
                hold = 0
                if not final:
                    for k in range(min(6, len(self.buf)), 0, -1):
                        if "<think>".startswith(self.buf[-k:]):
                            hold = k
                            break
                out.append(self.buf[:len(self.buf) - hold])
                self.buf = self.buf[len(self.buf) - hold:]
                break
            i = min(cand)
            out.append(self.buf[:i])
            self.buf = self.buf[i:]
            if self.buf.startswith("<think>"):
                self.buf, self.think = self.buf[7:], True
                continue
            j = self.buf.find("]")
            if j < 0:
                if final or len(self.buf) > 300:
                    out.append(self.buf)
                    self.buf = ""
                break
            tag, self.buf = self.buf[:j + 1], self.buf[j + 1:]
            m = re.match(r"\[\s*merken\s*:\s*(.+?)\s*\]$", tag, re.I | re.S)
            if m:
                self.merk.append(m.group(1))
            else:
                out.append(tag)
        return "".join(out)


# ---------------------------------------------------------------- Chat
def run_chat(payload, emit):
    s = load_settings()
    raw = [m for m in (payload.get("messages") or []) if isinstance(m, dict)]
    msgs = clean_history(raw)
    if not msgs:
        return emit({"t": "error", "message": "Leere Nachricht."})
    text = msgs[-1]["content"]
    u = text.lower()
    anbieter, model = pick_model(s)

    # ---- Datenschutz-Weiche: entscheidet VOR allem anderen, ob diese Nachricht den PC verlassen darf
    if s.get("strikt_lokal") and ist_cloud(s, anbieter):
        anbieter, model = "ollama", lokales_modell(s)
        if not model:
            return emit({"t": "error", "message": "Strikt lokal ist an, aber Ollama läuft nicht oder hat kein Modell. Es wurde nichts gesendet."})
    gruende = []
    if ist_cloud(s, anbieter) and s.get("privat_weiche") and not payload.get("erzwingen_cloud"):
        gruende = privat_erkennen(text, s)
        if gruende:
            lm = lokales_modell(s)
            if not lm:
                return emit({"t": "privat", "weiter": "blockiert", "gruende": gruende,
                             "message": "Private Daten erkannt (" + ", ".join(gruende) + "). Die lokale KI (Ollama) ist nicht erreichbar, "
                                        "deshalb habe ich nichts an die Cloud geschickt."})
            anbieter, model = "ollama", lm
            emit({"t": "privat", "weiter": "lokal", "gruende": gruende, "modell": lm})
    cloud = ist_cloud(s, anbieter)
    mem_ok = (not cloud) or bool(s.get("gedaechtnis_cloud"))

    actions, ctx, direct = route(u, s, text)
    for a in actions:
        emit({"t": "action", **a})
    if direct:
        emit({"t": "delta", "text": direct})
        return emit({"t": "done", "text": direct})
    # Merk-Befehle in der Cloud ohne Gedächtnis-Freigabe: lokal bestätigen, nichts senden
    memacts = [a for a in actions if a.get("typ") == "gedaechtnis"]
    if cloud and not mem_ok and memacts:
        a = memacts[0]
        if a["aktion"] == "gespeichert":
            reply = f"Alles klar, gemerkt: {a['text']}."
        elif a.get("anzahl"):
            reply = "Erledigt, ich habe " + ("eine Notiz" if a["anzahl"] == 1 else f"{a['anzahl']} Notizen") + " gelöscht."
        else:
            reply = "Dazu habe ich nichts gespeichert."
        emit({"t": "privat", "weiter": "lokal", "gruende": ["Gedächtnis bleibt lokal"], "modell": "ohne KI"})
        emit({"t": "delta", "text": reply})
        return emit({"t": "done", "text": reply})
    if cloud:
        msgs = clean_history(raw, ohne_privat=True)
        if not msgs or msgs[-1]["content"] != text:
            msgs = (msgs or []) + [{"role": "user", "content": text}]
            msgs = clean_history(msgs)
    if not model:
        hint = {"ollama": "Kein Ollama-Modell gefunden. Läuft Ollama und ist ein Modell installiert? (ollama pull llama3.2)",
                "claude": "Kein Claude-Modell verfügbar. Ist der Schlüssel in den Einstellungen eingetragen?",
                "openai": "Kein Modell verfügbar. Sind Basis-Adresse und Schlüssel in den Einstellungen eingetragen?"}[anbieter]
        return emit({"t": "error", "message": hint})
    emit({"t": "model", "anbieter": anbieter, "modell": model, "cloud": cloud})
    websuche = anbieter == "claude" and bool(s.get("websuche"))
    system = system_prompt(s, ctx, websuche, mem_ok)
    tf, full = TagFilter(), []
    try:
        if anbieter == "ollama":
            gen = stream_ollama(s, model, system, msgs)
        elif anbieter == "claude":
            gen = stream_claude(s, model, system, msgs, lambda e: emit({"t": "action", **e}))
        else:
            gen = stream_openai(s, model, system, msgs)
        for chunk in gen:
            out = tf.feed(chunk)
            if out:
                full.append(out)
                emit({"t": "delta", "text": out})
        out = tf.feed("", final=True)
        if out:
            full.append(out)
            emit({"t": "delta", "text": out})
    except KIError as e:
        return emit({"t": "error", "message": str(e)})
    except Exception as e:
        return emit({"t": "error", "message": f"Unerwarteter Fehler: {type(e).__name__}: {e}"[:300]})
    if s.get("auto_merken"):
        for m in tf.merk[:2]:
            it = mem_add(m)
            if it:
                emit({"t": "action", "typ": "gedaechtnis", "aktion": "gelernt", "text": it["text"]})
    emit({"t": "done", "text": "".join(full).strip()})


# ---------------------------------------------------------------- Sprachausgabe ElevenLabs
def eleven_tts(s, text):
    if s.get("strikt_lokal"):
        raise KIError("Strikt lokal ist an: ElevenLabs ist gesperrt.")
    key, vid = s.get("eleven_key"), s.get("eleven_voice")
    if not key or not vid:
        raise KIError("ElevenLabs: Schlüssel oder Stimmen-ID fehlt.")
    body = {"text": text[:1200], "model_id": s.get("eleven_modell") or "eleven_multilingual_v2",
            "voice_settings": {"stability": 0.45, "similarity_boost": 0.8}}
    try:
        with http(f"https://api.elevenlabs.io/v1/text-to-speech/{urllib.parse.quote(vid)}?output_format=mp3_44100_128", body,
                  {"xi-api-key": key, "accept": "audio/mpeg"}, timeout=60) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise KIError("ElevenLabs: " + http_error_text(e))
    except urllib.error.URLError:
        raise KIError("ElevenLabs nicht erreichbar.")


# ---------------------------------------------------------------- Webserver
STATIC = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
          ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
          ".mp3": "audio/mpeg", ".wav": "audio/wav", ".webp": "image/webp", ".gif": "image/gif", ".woff2": "font/woff2"}


class Handler(BaseHTTPRequestHandler):
    server_version = "Jarvis"

    def log_message(self, fmt, *args):
        pass

    def local(self):
        return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

    def send_json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 2_000_000:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except ValueError:
            return {}

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if not self.local():
            return self.send_json(403, {"error": "Nur vom eigenen Rechner erreichbar."})
        if path == "/":
            s = load_settings()
            self.send_response(302)
            self.send_header("Location", THEMES.get(s.get("oberflaeche"), "/jarvis.html"))
            self.end_headers()
            return
        if path == "/api/settings":
            return self.send_json(200, public_settings(load_settings()))
        if path == "/api/models":
            s = load_settings()
            ms = all_models(s)
            a, m = pick_model(s, ms)
            return self.send_json(200, {"anbieter": a, "modell": m, "liste": ms})
        if path == "/api/memory":
            return self.send_json(200, {"items": mem_load()})
        if path == "/api/system":
            return self.send_json(200, system_info())
        if path == "/api/wetter":
            return self.send_json(200, wetter(load_settings()))
        if path == "/api/status":
            return self.send_json(200, {"ok": True, "version": VERSION, "themes": THEMES})
        return self.static(path)

    def static(self, path):
        rel = urllib.parse.unquote(path).lstrip("/")
        full = os.path.realpath(os.path.join(BASE, rel))
        ext = os.path.splitext(full)[1].lower()
        if not full.startswith(BASE + os.sep) or ext not in STATIC or not os.path.isfile(full):
            return self.send_json(404, {"error": "Nicht gefunden: " + path})
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", STATIC[ext])
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if not self.local():
            return self.send_json(403, {"error": "Nur vom eigenen Rechner erreichbar."})
        data = self.body()
        if path == "/api/settings":
            s = update_settings(data)
            CACHE.clear()
            return self.send_json(200, public_settings(s))
        if path == "/api/test":
            s = load_settings()
            fn = {"ollama": ollama_models, "claude": claude_models, "openai": openai_models}.get(data.get("anbieter"))
            if not fn:
                return self.send_json(400, {"ok": False, "fehler": "Unbekannter Anbieter"})
            CACHE.clear()
            return self.send_json(200, fn(s))
        if path == "/api/memory":
            it = mem_add(data.get("text"))
            return self.send_json(200 if it else 400, {"item": it, "items": mem_load()})
        if path == "/api/memory/delete":
            mem_delete(mid=str(data.get("id") or ""))
            return self.send_json(200, {"items": mem_load()})
        if path == "/api/memory/clear":
            with LOCK:
                mem_save([])
            return self.send_json(200, {"items": []})
        if path == "/api/tts":
            try:
                audio = eleven_tts(load_settings(), str(data.get("text") or ""))
            except KIError as e:
                return self.send_json(502, {"error": str(e)})
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(audio)))
            self.end_headers()
            self.wfile.write(audio)
            return
        if path == "/api/chat":
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()

            def emit(obj):
                try:
                    self.wfile.write((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8"))
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass
            run_chat(data, emit)
            return
        return self.send_json(404, {"error": "Unbekannt: " + path})


def main():
    load_settings()
    srv, port = None, PORT
    for p in range(PORT, PORT + 10):
        try:
            srv = ThreadingHTTPServer((HOST, p), Handler)
            port = p
            break
        except OSError:
            continue
    if not srv:
        sys.exit(f"Kein freier Port zwischen {PORT} und {PORT + 9}. Läuft Jarvis schon?")
    url = f"http://localhost:{port}/"
    s = load_settings()
    print("=" * 56)
    print(f"  JARVIS · YouTube-Edition {VERSION}")
    print(f"  Oberfläche:  {url}")
    print(f"  KI:          {s['anbieter']}" + (f" ({s['modell']})" if s.get("modell") else " (Modell automatisch)"))
    print("  Beenden:     Strg + C")
    print("=" * 56)
    if not os.environ.get("JARVIS_KEIN_BROWSER"):
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nJarvis beendet.")


if __name__ == "__main__":
    main()
