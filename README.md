# Jarvis Android

Persönlicher KI-Assistent mit Stimme, Gedächtnis, Automation und 7 animierten Oberflächen – als **Android-App (APK)** und als **Web-App**.

Grundlage ist das Open-Source-Projekt [FreeJarvis](https://github.com/Max902507/FreeJarvis) (MIT-Lizenz, © 2026 irgendwasmitIT, siehe `LICENSE-FreeJarvis`).
Die Oberflächen sind 1:1 übernommen. Der Python-Server (`server.py`) wurde nach JavaScript übertragen (`web/core/backend.js`), damit alles ohne PC direkt auf dem Handy läuft.

## APK herunterladen

Unter **Releases → „Jarvis – Test-APK“** liegt immer die neueste Version (`Jarvis-Test.apk`). Sie wird bei jeder Änderung automatisch gebaut.

## KI einrichten (oben links: Einstellungen → KI & Modelle)

| Variante | Einstellung |
|---|---|
| **Ollama auf dem Handy** (Termux, offline, kostenlos) | Adresse `http://localhost:11434`, Schlüssel leer |
| **Ollama Cloud** (kostenlos mit Konto auf ollama.com) | Adresse `https://ollama.com`, API-Schlüssel von ollama.com/settings/keys |
| **Claude** | API-Schlüssel von console.anthropic.com |
| **OpenAI / Groq / OpenRouter** | Basis-Adresse und Schlüssel des Dienstes |

### Ollama auf dem Handy (Termux)
1. **Termux** aus F-Droid installieren (nicht die alte Play-Store-Version).
2. In Termux: `pkg update && pkg install ollama`
3. Starten: `ollama serve` (Termux offen lassen)
4. In einer zweiten Termux-Sitzung ein kleines Modell laden, z. B. `ollama pull llama3.2:3b` oder `ollama pull qwen2.5:3b`
5. In Jarvis: Anbieter „Lokal · Ollama“, Adresse `http://localhost:11434`, „Verbindung testen“.

## Aufbau

- `web/` – Oberflächen (HTML/CSS/JS), dieselben Dateien für App und Web-Version
- `web/core/backend.js` – ersetzt `server.py` (Einstellungen, Gedächtnis, Befehle, Datenschutz-Weiche, KI-Streaming)
- `app/` – Android-Hülle (WebView, Spracherkennung, Sprachausgabe, Netzwerk ohne CORS-Grenzen)
- `original/` – unveränderte Originaldateien von FreeJarvis zum Nachschlagen

Einstellungen, API-Schlüssel und Gedächtnis liegen nur auf dem Gerät.

## „Hey Jarvis“
Die Weckwort-Erkennung nutzt [openWakeWord](https://github.com/dscripka/openWakeWord) (Code: Apache 2.0). Das vortrainierte Modell „hey_jarvis“ steht unter CC BY-NC-SA 4.0 – nur für private, nicht-kommerzielle Nutzung.
