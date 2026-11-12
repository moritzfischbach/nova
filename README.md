# Nova

Nova ist eine persönliche Assistentin als installierbare Web-App (PWA) – mobil zuerst, deutsche Oberfläche. Module: **Aufgaben**, **Kalender** (Google-ähnlich, mit Wiederholungen und Sync), **Finanzplaner**, **Ziele** (Sparziele + allgemeine Ziele) sowie die **Grok-Bot-Anbindung** und **Mitteilungen** (Web Push).

Fachdaten liegen lokal im Browser (IndexedDB). Ein kleiner Server (`server/`) übernimmt alles, was Geheimnisse braucht: Grok-Bot-Webhook, Google-OAuth-Tokens, Push-Versand. **Kein Schlüssel gelangt in den Browser, ins Bundle oder in Logs.**

## Schnellstart (lokal)

```bash
cd nova
npm install
npm run gen:vapid        # Push-Schlüssel erzeugen → .env (einmalig, wird nie ausgegeben)
npm run build            # PWA nach dist/
npm start                # Server + PWA: http://localhost:8787
```

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Vite-Entwicklung auf :5173 (leitet `/api` an :8787 weiter – Server parallel mit `npm run server` starten) |
| `npm start` / `npm run server` | kombinierter Server: API + gebaute PWA aus `dist/` (Port `PORT`, Standard 8787) |
| `npm test` | Unit-/Integrationstests (Vitest, Frontend + Server) |
| `npm run test:e2e` | Playwright mit installiertem Chrome gegen Server + Mocks (Grok-Webhook, Google, Push-Dienst) |
| `npm run gen:vapid` | VAPID-Schlüssel erzeugen (`--force` erneuert sie; bestehende Abos werden dann ungültig) |

Konfiguration steht in `.env` (Vorlage: `.env.example`). `.env` und `server/data/` sind in `.gitignore`.

## Design & Logo

- Dunkles, ruhiges Farbschema: fast schwarze Flächen (`#0a0a0b`), feine Haarlinien, Weiß/Silber mit dezentem Champagner-Akzent; Tab-Leiste aus Milchglas. Alle Farben als CSS-Variablen in `src/styles.css`; Kalender-, Ziel- und Kategorie-Farben in `src/shared/palette.ts` (ältere, gespeicherte Farben werden automatisch auf die dunkle Palette abgebildet).
- Schrift: SF Pro auf Apple-Geräten, sonst Inter (selbst gehostet über `@fontsource-variable/inter`).
- Logo: verschachtelte, innen berührende Kreise, die spiralförmig zu einem kleinen Kreis zusammenlaufen – als Vektor in `scripts/logo.mjs` konstruiert. `node scripts/logo.mjs` erzeugt `public/logo.svg`, `src/assets/logo.svg` (In-App-Zeichen) und alle Icons (180, 192, 512, maskable mit Schutzrand, Favicon PNG + SVG) auf reinem Schwarz.
- Screenshots: `node e2e/screens.mjs <url> <ordner>` (iPhone-Größe, mit Beispieldaten).

## Nur-statisch (GitHub Pages)

Die Pages-Action baut mit `NOVA_BASE=/<repo>/` und – solange die Repo-Variable `NOVA_API_BASE` leer ist – mit `VITE_NOVA_STATIC=1`. Dann ruft Nova keinen Server auf; Grok Bot, Mitteilungen und Google/Apple-Sync zeigen „Braucht den Nova-Server, kommt nach der Server-Einrichtung.“ Aufgaben, Finanzen, Ziele, Kalender, Sprache und ICS funktionieren lokal. Sobald ein Server läuft: Repo-Variable `NOVA_API_BASE=https://<server>/` setzen und `ALLOWED_ORIGINS=https://<user>.github.io` auf dem Server.

## Struktur

```
nova/
  public/sw.js                 # Service Worker: Offline-Cache (ohne /api), Push + Klick auf Mitteilung
  src/
    app.ts router.ts types.ts  # Shell, 5 Tabs, Hash-Router mit Parametern (#/ziele?id=…)
    data/db.ts                 # IndexedDB v2 (Migration v1 → v2 für Termine)
    shared/
      api.ts                   # Server-Basis-URL, App-Zugangscode
      grokbot.ts               # Client für /api/bot inkl. Offline-Warteschlange
      reminderPlan.ts          # plant Erinnerungen aus Terminen, Aufgaben, Zielen
      reminders.ts             # Push aktivieren/abmelden, Plan an den Server
      voice.ts numberWords.ts  # Spracheingabe
    modules/
      overview/ todos/ finance/
      goals/                   # Ziele: match.ts (Spar-Erkennung), repo.ts, goals.ts
      calendar/                # calendar.ts (EventCalendar), recurrence.ts, ics.ts, remote.ts
      grok/                    # Grok-Bot-Bildschirm
      settings/                # Zugangscode, Mitteilungen
  server/
    app.js                     # Hono-App (portabel): /api/bot, Kalender, Push
    node.js                    # Node-Start: .env, Datei-Speicher, Scheduler, statische PWA
    worker.js                  # Cloudflare-Workers-Einstieg (siehe Hosting)
    validate.js auth.js store.js google-map.js calendar.js push.js scheduler.js
    scripts/gen-vapid.js
    testing/                   # Mock-Google, lokaler HTTPS-Push-Dienst
  tests/  e2e/
```

## Nova Chat (KI)

Mittlerer Tab **Chat** (Logo) bzw. „Mit Nova chatten“ auf der Übersicht. Nova ist eine warme, knappe deutsche Assistentin auf Basis von **Grok (xAI)**.

- **Server-Proxy** `POST /api/chat` → `https://api.x.ai/v1/chat/completions` (Streaming/SSE). Der Schlüssel `XAI_API_KEY` bleibt **nur auf dem Server**; Modell über `XAI_MODEL` (Standard `grok-4.7`). Schutz: `NOVA_APP_TOKEN` (öffentlich Pflicht), Origin-Allowlist, Rate-Limit `CHAT_RATE_LIMIT_PER_MINUTE` (Standard 20/min/IP), Größenlimits. Status: `GET /api/chat/status`.
- **Kontext**: Auf Wunsch (Schalter „Nova-Daten teilen“ unter dem Eingabefeld) schickt Nova pro Anfrage eine kurze Zusammenfassung mit – offene Aufgaben, Termine der nächsten 7 Tage, Monatsfinanzen nach Kategorie, Ziele. Nichts davon wird auf dem Server gespeichert.
- **Aktionen**: Nova kann Aufgaben, Termine, Ausgaben/Einnahmen und Sparziel-Einzahlungen vorschlagen. Jede Aktion erscheint als Karte und wird **erst nach „Ausführen“** lokal in Nova angelegt; danach antwortet Nova mit dem Ergebnis.
- **Grok-App**: Für Recherche, E-Mails, Buchungen usw. schlägt Nova „An Grok Bot weitergeben“ vor – das geht über `/api/bot` an die Routine „Nova Inbox“, die Antwort kommt im **Grok-App-Chat**.
- **Verläufe** in IndexedDB (mehrere Chats, löschen/leeren), Spracheingabe, Markdown ohne rohes HTML.
- **Kopplung**: Damit der öffentliche Build keinen Zugangscode enthält, wird ein Gerät einmalig per Link gekoppelt: `https://<pages>/#/koppeln?code=<NOVA_APP_TOKEN>` (der Teil nach `#` geht nie an GitHub; Nova speichert ihn lokal und entfernt ihn sofort aus der Adresszeile). Alternativ: Einstellungen → Zugangscode.
- Ohne Server (reiner Pages-Build) zeigt der Chat den Hinweis „Nova Chat braucht den Nova-Server und einen xAI-Schlüssel …“.

## Grok-Bot-Anbindung

Nova → `POST /api/bot` (eigener Server) → Webhook der Grok-Bot-Routine. Die Antwort erscheint **im Grok-Bot-Chat**, nicht in Nova.

**Einrichten**
1. In Grok Bot die Routine (z. B. „Nova Inbox“) mit Webhook-Auslöser öffnen, **Webhook-URL** und **Schlüssel** kopieren.
2. In `.env` eintragen (lokal) bzw. als Secret beim Hoster:
   ```
   GROKBOT_WEBHOOK_URL=https://…
   GROKBOT_WEBHOOK_KEY=…
   ```
3. Server neu starten. In Nova → Grok Bot steht dann „Verbunden“. Test: Aufgabe `ping` senden.

**Ablauf**
- Body an den Webhook: `{ task, module, context, request_id }`, Header `Authorization: Bearer <KEY>`, `X-Automation-Key: <KEY>`, `Content-Type: application/json`.
- `module` ∈ `todos | kalender | finanzen | ziele | allgemein`; `task` 1–2000 Zeichen, `context` bis 4000.
- 8 s Timeout, genau ein Versuch, klare JSON-Fehler (`not_configured` 503, `upstream_error` 502, `upstream_timeout` 504, `rate_limited` 429, `unauthorized` 401, `forbidden_origin` 403, `invalid_task`, `invalid_module` u. a. 400, `upstream_unreachable` 502).
- `GET /api/bot/status` → `{ configured: true|false }`.
- Schutz: Origin-Allowlist (gleiche Origin + `ALLOWED_ORIGINS`), Rate-Limit pro IP (`RATE_LIMIT_PER_MINUTE`), optional `NOVA_APP_TOKEN` (in Nova → Einstellungen eintragen).
- Im Frontend: Textfeld mit Mikrofon, Modulwahl, Liste mit Status *gesendet / Fehler / wartend*. Offline-Anfragen werden gespeichert und automatisch gesendet, sobald wieder Netz da ist. Schnellaktionen: „An Grok Bot schicken“ bei Aufgaben, Terminen, Zielen und in der Übersicht.

## Ziele

- **Sparziele**: Zielbetrag, optionales Zieldatum, Fortschrittsbalken, Monatsrate bis zum Datum, Einzahlungen.
- **Allgemeine Ziele**: Titel, Zieldatum, Notiz, Status offen/erreicht.
- **Finanzplaner/Sprache**: „50 Euro Sparen Urlaub“ (auch gesprochen: „fünfzig Euro sparen fürs Auto“) wird als Buchung in der Kategorie *Sparen* erfasst und dem passenden Sparziel gutgeschrieben (Titel oder Stichwörter). Löscht man die Buchung, verschwindet die Einzahlung mit.
- **Kalender**: Ziele mit Datum erscheinen als Markierung am Zieltag (ganztägige Zeile); Tippen öffnet das Ziel. Aus einem Termin-Tag lässt sich direkt ein Ziel anlegen.

## Kalender

**Bibliothek: [@event-calendar/core](https://github.com/vkurko/calendar) (MIT)** – Monat, Woche, Tag (Zeitraster) und Agenda. Begründung: Überlappungs-Layout, Ganztägig-Zeile, Jetzt-Linie und Touch-Drag selbst zu bauen wäre aufwendig und fehleranfällig; FullCalendar wäre deutlich schwerer. EventCalendar ist ~48 KB gzip und wird nur beim Öffnen des Kalenders nachgeladen. Wiederholungen hat die Bibliothek nicht – die sind eigener Code (`recurrence.ts`).

- Wischen oder Pfeile zum Blättern, **Heute**-Knopf, gewählte Ansicht wird gemerkt.
- Freien Slot antippen → neuer Termin zu dieser Uhrzeit; Bereich ziehen → Termin über den Bereich; Termin antippen → bearbeiten/löschen; Termine verschieben und in der Länge ziehen.
- Überlappende Termine nebeneinander, ganztägige und **mehrtägige** Termine, **Farbe pro Termin**.
- **Wiederholungen**: täglich/wöchentlich (mit Wochentagen)/monatlich/jährlich, Intervall, Ende nach Anzahl oder Datum (RRULE-Teilmenge `FREQ, INTERVAL, COUNT, UNTIL, BYDAY` + `EXDATE`). Löschen: „nur dieser Termin“ oder „ganze Serie“.
- **Erinnerung** pro Termin (zum Beginn, 10 Min., 1 Std., 1 Tag vorher).
- **ICS** Export/Import mit `RRULE`, `EXDATE`, `COLOR`, `VALARM`.
- **Migration**: Termine aus der alten Version werden beim ersten Start übernommen (DB v1 → v2) und für den Google-Sync vorgemerkt.

### Google Kalender – Zwei-Wege-Sync (über den Server)

- OAuth-Code-Flow, `access_type=offline`, Scope `calendar.events`. Tokens liegen **nur auf dem Server** (`server/data/store.json`, Dateirechte 600).
- „Jetzt synchronisieren“: Nova schickt geänderte Termine und Löschungen; der Server lädt sie zu Google hoch (neu/ändern/löschen), holt dann inkrementell per `syncToken` alle Google-Änderungen (bei `410 Gone` vollständig neu) und gibt sie an Nova zurück. Konfliktregel: neuere Änderung gewinnt.
- Getestet gegen einen Google-Mock (`server/testing/mock-google.js`), nicht gegen das echte Google-Konto.

**Benötigte Zugangsdaten (einmalig, in der Google Cloud Console)**
1. Projekt anlegen → **Google Calendar API** aktivieren.
2. **OAuth-Zustimmungsbildschirm**: Typ „Extern“, App-Name „Nova“, eigene Adresse als Testnutzer eintragen (Testmodus reicht für dich allein; Refresh-Tokens laufen im Testmodus nach 7 Tagen ab → später „In Produktion“ schalten, für den eingeschränkten Scope ggf. Prüfung nötig).
3. **Anmeldedaten → OAuth-Client-ID → Webanwendung**, autorisierte Weiterleitungs-URI: `https://<dein-server>/api/calendar/google/callback`.
4. In `.env` bzw. als Secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (genau die URI aus Schritt 3), optional `GOOGLE_CALENDAR_ID` (Standard `primary`).

### Apple Kalender

- **Umgesetzt: Abo-Feed (Einweg Nova → Apple).** `CALENDAR_FEED_TOKEN` setzen (lokal bereits erzeugt), in Nova → Kalender → Sync → „Feed aktualisieren“. Die angezeigte `…/api/calendar/feed/<token>.ics`-Adresse in Apple Kalender unter *Ablage → Neues Kalenderabonnement* (iPhone: *Einstellungen → Kalender → Accounts → Abonnierter Kalender*) eintragen. Braucht eine öffentliche HTTPS-Adresse.
- **Nicht umgesetzt: CalDAV-Zwei-Wege** mit iCloud. Dafür bräuchte der Server deine Apple-ID und ein **app-spezifisches Passwort** (appleid.apple.com → Anmeldung & Sicherheit → App-spezifische Passwörter). Die Schnittstelle (`caldav.configured`) ist vorbereitet; ehrlicherweise ist das der nächste größere Baustein. Bis dahin: Abo-Feed + ICS-Import.

## Mitteilungen (Web Push)

Kostenlos, ohne Drittanbieter: eigene **VAPID-Schlüssel** (`npm run gen:vapid` → `.env`), Versand mit `web-push` direkt an den Push-Dienst des Browsers (Apple/Google/Mozilla).

- Nova → Einstellungen → **Mitteilungen aktivieren** (fragt die Erlaubnis, meldet das Gerät am Server an), „Test senden“.
- Erinnerungen: **Termine** (eigene Vorlaufzeit), **Aufgaben** mit Fälligkeitsdatum/-uhrzeit und Häkchen „Erinnern“, **Ziele/Sparziele** (Vortag und Zieltag 9:00). Nova plant die nächsten 30 Tage und schickt den Plan nach jeder Änderung an den Server; der Server-Scheduler prüft alle 30 s und sendet fällige Mitteilungen (gespeichert in `server/data/store.json`). Tippen auf die Mitteilung öffnet den passenden Bildschirm.
- **iPhone**: Web Push gibt es ab **iOS 16.4** und **nur**, wenn Nova über **HTTPS** geöffnet und **zum Home-Bildschirm hinzugefügt** wurde. In Safari zeigt Nova dafür eine Anleitung statt des Knopfes.
- Abgelaufene Geräte-Abos (404/410) entfernt der Server automatisch.

## Sicherheit

- Geheimnisse nur in `.env` bzw. Host-Secrets: `GROKBOT_WEBHOOK_KEY`, `GOOGLE_CLIENT_SECRET`, `VAPID_PRIVATE_KEY`, `CALENDAR_FEED_TOKEN`, `NOVA_APP_TOKEN`, `XAI_API_KEY`. Tests prüfen, dass sie weder in Antworten noch im Bundle (`dist/`) auftauchen.
- Ohne `NOVA_APP_TOKEN` sind Kalender- und Push-Endpunkte nur von `localhost` erreichbar. **Sobald der Server öffentlich läuft, `NOVA_APP_TOKEN` setzen** (langer Zufallswert) und in Nova → Einstellungen eintragen.
- Der Service Worker cached nie `/api/…`.

## Hosting (wenn es soweit ist)

GitHub Pages kann **nur den statischen Teil** (`dist/`). Für Grok-Bot, Google-Sync und Push braucht es einen Server.

| Variante | Statisch | Server | Hinweise |
| --- | --- | --- | --- |
| **Ein Node-Host** (Render, Fly.io, Railway, kleiner VPS mit Caddy) – *empfohlen* | ja, derselbe Server | `npm start` | Alles inklusive Scheduler und Datei-Speicher; persistentes Volume für `server/data/` nötig. |
| **GitHub Pages + Node-Host** | GitHub Pages | Render/Fly/VPS | Beim Build `VITE_NOVA_API_BASE=https://<server>/` setzen und `ALLOWED_ORIGINS=https://<name>.github.io` auf dem Server. |
| **Cloudflare Pages + Workers** | Pages | `server/worker.js` | Grok-Bot-Brücke läuft sofort (Secrets per `wrangler secret put`). Für Kalender/Push fehlen noch ein KV-Speicher statt `memoryStore`, ein Cron-Trigger für den Scheduler und ein Workers-tauglicher Push-Sender (`web-push` ist Node-only). |
| **Vercel / Netlify Functions** | ja | Hono-Adapter | Ähnlich wie Workers: Brücke ok, für Scheduler Cron + externer Speicher nötig. |

### Render (Free-Plan) – aktuelle Einrichtung

`render.yaml` beschreibt den Dienst `nova-server` (Node 22, `npm ci && npm run build`, Start `node server/node.js`, Health-Check `/api/health`, Region Frankfurt).

1. Render → *New → Blueprint* → Repo `moritzfischbach/nova`, Branch `main` (oder Web Service manuell mit denselben Werten).
2. Secrets im Dashboard eintragen (stehen absichtlich nicht im Repo): `XAI_API_KEY`, `NOVA_APP_TOKEN` (`openssl rand -hex 24`), `GROKBOT_WEBHOOK_URL`, `GROKBOT_WEBHOOK_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CALENDAR_FEED_TOKEN`, `PUBLIC_BASE_URL=https://<dienst>.onrender.com`, `ALLOWED_ORIGINS=https://moritzfischbach.github.io`.
3. GitHub → Settings → Variables → `NOVA_API_BASE=https://<dienst>.onrender.com/` und den Pages-Workflow neu starten. Danach Gerät per Kopplungslink verbinden.

**Free-Plan-Einschränkungen:** kein persistenter Speicher – `server/data/store.json` (Push-Abos, Erinnerungsplan, Google-Tokens) geht bei jedem Deploy/Neustart verloren; Nova meldet Push-Abo und Erinnerungsplan bei jedem Öffnen erneut an, Google muss nach einem Neustart ggf. neu verbunden werden. Der Dienst schläft nach ~15 min ohne Anfragen ein (erste Antwort dann ~30–60 s), Erinnerungen werden im Schlaf nicht verschickt. Für zuverlässige Push-Erinnerungen später: bezahlte Instanz + Disk (Block in `render.yaml` ist auskommentiert).

Für iPhone-Installation, Spracheingabe und Push ist **HTTPS** Pflicht.

## Offene Schritte mit Konten (nicht automatisch erledigt)

1. **Hoster** wählen und Konto anlegen (z. B. GitHub für Pages + Render/Fly für den Server, oder ein Node-Host für alles). Secrets dort eintragen, `NOVA_APP_TOKEN` setzen, `PUBLIC_BASE_URL` auf die HTTPS-Adresse.
2. **Grok-Bot-Webhook**: URL + Schlüssel der Routine als Secrets.
3. **Google Cloud**: Projekt, Calendar API, Zustimmungsbildschirm, OAuth-Client „Webanwendung“ mit Callback-URI (siehe oben).
4. **Apple**: Kalender-Abo-URL eintragen; für späteres CalDAV ein app-spezifisches Passwort.
5. **Später SMS/Anrufe (Twilio)**: Konto, Telefonnummer, `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` – noch nicht eingebaut; Web Push deckt Erinnerungen kostenlos ab.

## Spracheingabe

Mikrofon-Buttons in Aufgaben, Finanzen und Grok Bot (Web Speech API, `de-DE`). Gesprochene Zahlen werden umgewandelt („zwölf Komma fünf Euro Tanken“). iPhone: nur über HTTPS, Siri & Diktieren muss aktiv sein, als Home-Bildschirm-App fragt iOS die Mikrofon-Erlaubnis nach jedem Neustart. Bei Problemen hilft die Diktiertaste der Tastatur.

## Ein neues Modul hinzufügen

1. Ordner `src/modules/<name>/` mit `repo.ts` und einer `render…(root)`-Funktion.
2. Typen in `src/types.ts`, ggf. Object Store in `src/data/db.ts` (Version erhöhen, Migration).
3. Route in `src/router.ts`, Tab/Karte in `src/app.ts`.
4. Für Grok Bot: Modulname in `server/validate.js` (`MODULES`) und `src/shared/grokbot.ts` ergänzen.
