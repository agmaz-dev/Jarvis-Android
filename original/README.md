# JARVIS · YouTube-Edition

Persönlicher KI-Assistent im Browser, mit Stimme, Gedächtnis, Automation und 7 animierten Oberflächen.

**Eine Version für alles:** lokal mit **Ollama** (kostenlos, ohne Schlüssel), **Claude** per API oder **OpenAI-kompatible** Dienste (OpenAI, Groq, OpenRouter, LM Studio). Gewechselt wird oben rechts per Klick, ohne Code zu ändern.

**Datenschutz-Modus (ab 1.1):** Anzeige LOKAL/CLOUD, private Nachrichten (Telefonnummer, IBAN, Passwort, eigene Stichwörter ...) gehen automatisch an die lokale KI statt in die Cloud, das Gedächtnis bleibt standardmäßig lokal, und „Strikt lokal“ sperrt alle Online-Dienste. Details in `anleitung.txt`, Abschnitt 15.

## Start

1. Python 3.8+ installieren (Haken bei „Add python.exe to PATH“)
2. Ordner entpacken, `start.bat` doppelklicken
3. Browser öffnet `http://localhost:5050` → **AKTIVIEREN**
4. Oben links **Einstellungen** → KI einrichten

Die komplette Anleitung mit Fehlerbehebung steht in **`anleitung.txt`**.

## Oberflächen

| Datei | Stil |
|---|---|
| `jarvis.html` | **Vortex**: HUD mit Energie-Wirbel (Hauptoberfläche) |
| `oberflaechen/nova.html` | Nova: glühender Funken-Kern |
| `oberflaechen/sphaeren.html` | Sphären: Glas-Sphären mit Neuronennetz |
| `oberflaechen/aura.html` | Aura: Glaskugel mit Neon-Schleifen |
| `oberflaechen/gitter.html` | Gitter: grünes Drahtgitter |
| `oberflaechen/begleiter.html` | Begleiter: Kugel mit Augen |
| `oberflaechen/band.html` | Band: Lichtband-Ring |

Keine Installation von Paketen nötig, nur Python-Standardbibliothek.
`einstellungen.json` und `gedaechtnis.json` enthalten persönliche Daten und Schlüssel. Sie werden nicht mit hochgeladen (`.gitignore`).
