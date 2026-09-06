# Doc-Flow

Persönliche Dokumentenablage. Briefe werden mit dem Telefon fotografiert oder als PDF
hochgeladen; die Anwendung erkennt den Text, lässt ihn analysieren und macht Absender,
Person, Frist, Zahlung und Aufgabe auffindbar.

Für **eine** Privatperson auf dem eigenen Server. Kein Dokumentenmanagement für
Unternehmen, keine Freigaben, keine Mandanten.

## Technischer Überblick

| Bereich | Wahl |
|---|---|
| Oberfläche | Next.js 16 (App Router), React 19, Tailwind 4, mobile-first |
| Server | Server Actions für Formulare, Route Handler für Upload, Dateien und Streaming |
| Datenbank | PostgreSQL 17, Prisma 7 über den pg-Adapter |
| Anmeldung | eigene Sitzungen, Argon2id, serverseitig widerrufbar |
| Dateien | lokales Dateisystem hinter einer austauschbaren Ablageschicht |
| Texterkennung | Tesseract (deutsch), optional Nachlesen durch ein Bildmodell |
| Analyse | Anthropic Claude hinter einer austauschbaren Anbieterschicht |
| Hintergrund | eigene Auftragstabelle in PostgreSQL, kein Redis |
| Betrieb | Docker-Image, Deployment über Coolify |

### Verzeichnisse

```
src/app/          Routen, Server Actions (dünne Adapter)
src/server/       Fachlogik: Dienste, Warteschlange, Verarbeitung, KI
src/lib/          reine Funktionen: Parsen, Normalisieren, Validieren
prisma/           Datenmodell und Migrationen
scripts/          Wiederherstellung
data/             Originaldateien und Backups (lokal, nicht im Repository)
```

Die Schichtung ist verbindlich: Geschäftslogik steht nie in einer React-Komponente. Nur
so ist sie ohne laufenden Server testbar und die Rechteprüfung vom Browser nicht
umgehbar.

## Einrichtung

### 1. PostgreSQL

PostgreSQL 17 installieren. Ein Rolle mit dem Recht, Datenbanken anzulegen, genügt.

### 2. Datenbanken anlegen

```bash
createdb docflow_dev
createdb docflow_test
```

`docflow_test` wird von den Integrationstests zwischen den Durchläufen geleert und darf
niemals Echtdaten enthalten. Die Testhilfe verweigert die Arbeit, wenn der Datenbankname
nicht `docflow_test` enthält.

### 3. Umgebungsvariablen

```bash
cp .env.example .env
```

Dann `DATABASE_URL`, `TEST_DATABASE_URL` und `SESSION_SECRET` eintragen. Den Schlüssel
erzeugen mit:

```bash
openssl rand -hex 32
```

Unter Windows zusätzlich `PG_DUMP_PATH` setzen — der Installer trägt PostgreSQL nicht in
den Suchpfad ein.

### 4. Abhängigkeiten, Schema, Startdaten

```bash
npm install
npm run db:migrate
npm run db:seed
```

Die Testdatenbank braucht dieselben Migrationen:

```bash
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
```

### 5. Texterkennung (ab Ausbaustufe 5)

Windows:

```bash
winget install UB-Mannheim.TesseractOCR
```

Danach `TESSERACT_PATH` in der `.env` auf `tesseract.exe` zeigen lassen. Im Container ist
Tesseract samt deutschem Sprachmodell bereits enthalten.

### 6. Starten

```bash
npm run dev
```

Und in einem **zweiten** Terminal die Hintergrundverarbeitung:

```bash
npm run worker
```

Ohne den Worker bleiben hochgeladene Dokumente auf „wird verarbeitet" stehen. In
Produktion läuft er im selben Prozess wie die Anwendung; in der Entwicklung wäre das
lästig, weil jedes Neuladen eine weitere Schleife anlegte.

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver |
| `npm run worker` | Hintergrundverarbeitung |
| `npm test` | Modultests, ohne Datenbank |
| `npm run test:int` | Integrationstests gegen `docflow_test` |
| `npm run test:all` | beide Suiten nacheinander |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm run build` | Produktions-Build |
| `npm run db:migrate` | Migration erzeugen und einspielen |
| `npm run db:seed` | Startdaten |
| `npm run db:studio` | Datenbank im Browser |

## Deployment über Coolify

### 1. PostgreSQL-Ressource anlegen

PostgreSQL 17 als eigene Ressource. Die **interne** Verbindungszeichenkette verwenden —
sie zeigt auf den Dienstnamen im Docker-Netz, nicht auf localhost. `?schema=public`
anhängen.

### 2. Anwendung anlegen

Build Pack `Dockerfile`, Port 3000, automatisches Deployment bei Push auf `master`.

### 3. Volume einhängen — vor dem ersten Deployment

Ein Volume auf **`/data`**. Dort liegen die Originaldokumente und die Backups. Ohne das
Volume sind beim nächsten Deployment alle Dokumente weg; der Start bricht deshalb ab,
wenn `/data/files` nicht beschreibbar ist.

### 4. Umgebungsvariablen

| Variable | Hinweis |
|---|---|
| `DATABASE_URL` | interne Zeichenkette der PostgreSQL-Ressource |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `APP_ORIGIN` | `https://…` — **muss „Available during build" sein** |
| `ANTHROPIC_API_KEY` | für Analyse und Assistent |
| `BOOTSTRAP_EMAIL`, `BOOTSTRAP_PASSWORD`, `BOOTSTRAP_NAME` | nur für den allerersten Start |
| `TZ` | `Europe/Berlin` |
| `BACKUP_AGE_RECIPIENT` | optional, verschlüsselt die Abzüge |

`APP_ORIGIN` ist der häufigste Stolperstein: Next friert den Wert beim Build in die
Konfiguration ein. Fehlt er dort, scheitert hinter dem Proxy jedes Speichern mit einem
CSRF-Fehler.

`BOOTSTRAP_PASSWORD` nach der ersten Anmeldung wieder entfernen und das Passwort in der
Anwendung ändern.

### 5. Erreichbarkeit prüfen

```bash
curl https://<domain>/api/health
```

Antwortet mit `{"status":"ok","worker":"ok"}`, sobald die Hintergrundverarbeitung läuft.

## Backups

Jede Nacht um 3:30 Uhr (Serverzeit) läuft ein Auftrag, der beides sichert:

- die Datenbank als `pg_dump` im eigenen Format
- die **Originaldateien** als Archiv, wöchentlich vollständig und dazwischen nur den
  Zuwachs. Seitenbilder und Vorschauen werden ausgelassen, sie sind jederzeit neu
  erzeugbar.

Aufbewahrung 30 Tage; das jüngste vollständige Dateiarchiv bleibt immer erhalten, weil
ohne es alle Zuwachs-Archive wertlos wären. Aufgeräumt wird erst nach einem erfolgreichen
neuen Abzug — ein dauerhaft scheiternder Lauf soll nicht nach und nach alles löschen.

Ist `BACKUP_AGE_RECIPIENT` gesetzt, gehen beide Abzüge durch `age`. Ohne den Schlüssel
liegen sie im Klartext auf dem Volume.

### Wiederherstellung

Bewusst über die Kommandozeile, nicht über eine Schaltfläche: Der Vorgang überschreibt
die laufende Datenbank.

```bash
./scripts/restore.sh /data/backups/docflow-db-2026-09-06T03-30-00.dump
```

Danach die Dateiarchive auspacken, ältestes zuerst:

```bash
for f in /data/backups/docflow-files-*.tar.gz; do tar -xzf "$f" -C /data/files; done
```

Verschlüsselte Abzüge vorher entschlüsseln:

```bash
age -d -i schluessel.txt datei.dump.age > datei.dump
```

## Sicherheit

- HTTPS über den Proxy, HSTS in Produktion
- Passwörter mit Argon2id, Sitzungen nur als Hash in der Datenbank
- Content-Security-Policy mit Nonce, kein `unsafe-inline` für Skripte
- Dateien werden ausschließlich nach Anmeldung ausgeliefert; Speicherpfade bestehen nur
  aus serverseitigen IDs
- Zugriffe auf fremde Daten scheitern mit 404 statt 403 — ein 403 verriete, dass es das
  Objekt gibt
- API-Schlüssel stehen nur in der Umgebung, nie in der Datenbank
- Im Protokoll stehen Ereignisse und IDs, niemals Dokumentinhalte

## Grundregeln der Datenhaltung

1. **Das Original ist unantastbar.** Eine hochgeladene Datei wird nach dem Speichern nie
   wieder geschrieben. Alles Abgeleitete — Seitenbilder, erkannter Text, Metadaten — ist
   jederzeit neu erzeugbar.
2. **Nichts wird gelöscht, nur ausgeblendet.** Die Anwendung ist ein Langzeitarchiv. Es
   gibt kein automatisches endgültiges Löschen.
3. **Keine Behauptung ohne Beleg.** Jede von der KI erkannte Angabe trägt Seitenzahl und
   wörtliches Zitat; der Server prüft, ob das Zitat im erkannten Text dieser Seite
   wirklich vorkommt.
4. **Der Benutzer hat das letzte Wort.** Jede erkannte Angabe ist bearbeitbar, und eine
   erneute Analyse überschreibt niemals einen selbst gesetzten Wert.
5. **Ein Fehler in der Verarbeitung kostet niemals das Dokument.** Schlägt Texterkennung
   oder Analyse fehl, bleibt die Datei erhalten und lesbar; der Schritt lässt sich
   wiederholen.
