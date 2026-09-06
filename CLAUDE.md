# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Was Doc-Flow ist

Persönlicher Dokumentenmanager für **eine** Privatperson auf dem eigenen VPS. Briefe
werden mit dem iPhone fotografiert oder als PDF hochgeladen; die Anwendung erkennt den
Text, lässt ihn von einer KI analysieren und macht Absender, Person, Frist, Zahlung und
Aufgabe auffindbar. Kein DMS für Unternehmen, keine Freigaben, keine Mandantenfähigkeit.

Mobile-first (iPhone), Oberfläche und Code-Kommentare durchgängig deutsch. Deployment
über Coolify bei Push auf `master`.

Vollständige Planung (Datenmodell, Pipeline, Phasen) siehe [PLAN.md](PLAN.md).
Einrichtung und Betrieb stehen im [README](README.md).

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver |
| `npm run worker` | Hintergrundverarbeitung (zweites Terminal, in der Entwicklung Pflicht) |
| `npm test` | Modultests, ohne Datenbank |
| `npm run test:int` | Integrationstests gegen `docflow_test` |
| `npm run test:all` | beide Suiten nacheinander |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm run build` | Produktions-Build (`output: standalone`) |
| `npm run db:migrate` | Migration erzeugen und einspielen |
| `npm run db:seed` | Startdaten |

**Einzelne Testdatei:**

```bash
npx vitest run src/lib/parsing/german-date.test.ts
```

```bash
npx vitest run --config vitest.integration.config.ts src/server/pipeline/analyze.int.test.ts
```

**Nach jeder Schemaänderung** zusätzlich die Testdatenbank migrieren — sonst scheitern
*alle* Integrationstests mit „column does not exist":

```bash
DATABASE_URL="postgresql://docflow:docflow_dev@localhost:5432/docflow_test?schema=public" npx prisma migrate deploy
```

## Architektur

Die Schichtung ist der Kern: `src/app/` (Routen, Server Actions als **dünne** Adapter) →
`src/server/services/` (Fachlogik, ohne Framework-Abhängigkeit) → `src/lib/` (reine
Funktionen: Parsen, Normalisieren, Validieren). Geschäftslogik gehört nie in
React-Komponenten.

**Service-Signatur.** Erster Parameter ist immer `actor: SessionUser` (bei reinen
Lesefunktionen `_actor`). Jede Abfrage filtert `where: { userId: actor.id }` — auch
wenn es heute nur einen Benutzer gibt. Transaktionsinterne Bausteine nehmen `tx: Tx`
zuerst; der Typ `Tx` (`src/server/db.ts`) schließt verschachtelte `$transaction` aus.

**Result oder Throw.** `{ ok: false, error }` für erwartbare fachliche Absagen, die als
Formularfehler erscheinen. Geworfen wird bei Rechte- und Invariantenbrüchen
(`ForbiddenError`).

**Prisma.** Client nach `src/generated/prisma`, gitignored — Importe lauten
`@/generated/prisma/client` bzw. `@/generated/prisma/enums`, **nie** `@prisma/client`.
Treiber-Adapter `@prisma/adapter-pg`, keine Engine-Binärdatei.

**Das Original ist unantastbar.** `DocumentFile` wird nach dem Hochladen nie wieder
geschrieben. Alles Abgeleitete (Seitenbilder, OCR-Text, Metadaten) ist jederzeit neu
erzeugbar und liegt getrennt unter `derived/`. Schlägt OCR oder KI fehl, bleibt das
Dokument erhalten und lesbar — Fehler setzen nur `processingStatus`.

**Hintergrundverarbeitung.** Alles Langlaufende (Seitenaufbereitung, OCR, KI) läuft über
die Tabelle `ProcessingJob` und den Worker in `src/server/jobs/`. Diese Module dürfen
**nichts aus `next/*` importieren**, damit der Worker auch als eigener Prozess startet.

**Zwei getrennte Zustände am Dokument.** `processingStatus` beschreibt die Pipeline
(UPLOADED → PREPARING → OCR → ANALYZING → DONE/FAILED), `reviewState` die inhaltliche
Prüfung (NONE/NEEDED/REVIEWED). Ein fertiges Dokument kann Prüfung brauchen.

**Auth.** `requireUser()` (`src/server/auth/context.ts`) **redirectet** nach `/login`, es
wirft nicht: Next rendert Layout und Seite nebenläufig, eine Exception landete in der
Error-Boundary, bevor der Redirect greift.

**Hart geprüfte Umgebungsvariablen:** `DATABASE_URL`, `SESSION_SECRET` (mindestens 32
Zeichen), `FILES_DIR` und `APP_ORIGIN`. Letztere muss zur **Bauzeit** gesetzt sein — Next
friert sie beim Standalone-Build ein; fehlt sie, scheitert hinter dem Proxy jede Server
Action mit einem CSRF-Fehler (siehe `Dockerfile`).

## Regeln für die KI-Nutzung

Diese Regeln tragen die Glaubwürdigkeit der gesamten Anwendung.

1. **Keine Behauptung ohne Beleg.** Jedes extrahierte Feld und jede Aussage im Chat trägt
   Seitenzahl und wörtliches Zitat. Der Server prüft, ob das Zitat im OCR-Text dieser
   Seite wirklich vorkommt (`src/server/ai/guard/`). Was die Prüfung nicht besteht, wird
   verworfen oder als `UNVERIFIED` markiert — niemals stillschweigend übernommen.
2. **Im Chat zählt nur, was gelesen wurde.** Belege dürfen sich ausschließlich auf Seiten
   beziehen, die das Modell in diesem Gespräch über ein Werkzeug angefordert hat.
3. **Fakt und Deutung sind getrennt.** Was im Dokument steht, und was es bedeuten könnte,
   erscheinen in der Oberfläche als zwei verschiedene Blöcke.
4. **Findet die KI nichts, sagt sie das.** „In den Dokumenten wurde dazu nichts
   gefunden." ist eine richtige Antwort, Raten nicht.
5. **Der Benutzer hat das letzte Wort.** Jedes automatisch erkannte Feld ist bearbeitbar.
   Eine erneute Analyse überschreibt niemals einen Wert mit `source: 'USER'` und fasst
   bestätigte Aufgaben oder Zahlungen nicht an.
6. **Automatisch erkannte Aufgaben und Zahlungen sind Vorschläge** (`PROPOSED`) und
   zählen nirgends mit, bis sie bestätigt wurden.
7. **Keine Dokumentinhalte in Logs.** Protokolliert werden Ereignisse und IDs, niemals
   OCR-Text, Zitate oder Beträge.

## Fallstricke

- **Server Actions gehören direkt ins Formular.** Steht im `<form action={…}>` eine
  Client-Funktion, die die Action erst ihrerseits aufruft, behandelt React das Ganze als
  reine Client-Aktion — die Schaltfläche bleibt wirkungslos, solange die Seite noch nicht
  hydriert ist. Feste Werte über verborgene Felder mitgeben, nicht über Closures.
- **Keine Server-Module in Client-Komponenten importieren**, auch nicht für eine einzelne
  Konstante: Das zieht Prisma und `pg` ins Browser-Bundle und die Seite bricht mit
  `Can't resolve 'dns'` ab. Gemeinsame Werte gehören nach `src/lib/`.
- **React 19 leert Formulare nach jeder Aktion**, auch nach einer fehlgeschlagenen.
  Eingaben, die stehen bleiben sollen, aus der Action zurückgeben und als `defaultValue`
  setzen.
- **Typprüfung und Tests fangen Bundling-Fehler nicht ab.** Geänderte Seiten zusätzlich
  im Browser aufrufen.
- **Die Datenbanksitzung läuft fest auf UTC** (`options: '-c timezone=UTC'` in
  `src/server/db.ts`). Ohne das behandelt der Treiber Zeitstempel als Ortszeit: Von
  Prisma geschriebene Werte und `NOW()` liegen dann um den Zeitzonenversatz
  auseinander. Über Prisma allein fällt das nie auf, weil sich der Versatz beim
  Zurücklesen aufhebt — in jeder Rohabfrage aber schon, und dort lautlos. Genau daran
  stand die Auftragswarteschlange einmal still, ohne eine Zeile im Protokoll.
- **Zeitstempel sind `@db.Timestamptz(3)`**, Kalenderdaten (`documentDate`, `dueDate`)
  bleiben `@db.Date`. Neue `DateTime`-Felder brauchen die Angabe ausdrücklich.
- **Rohe SQL-Indizes gehören ins Schema**, nicht nur in eine Migration: Sonst schlägt
  die nächste Migration vor, sie zu löschen. GIN-Indizes lassen sich als
  `@@index([feld(ops: raw("gin_trgm_ops"))], type: Gin)` deklarieren.
- **`prisma migrate dev` wartet auf eine Eingabe** und blockiert damit ein Skript. Für
  nicht-interaktive Läufe `migrate deploy` verwenden oder `--create-only` und danach
  `deploy`.
- **Dateiuploads laufen über Route Handler**, nicht über Server Actions: nur so gibt es
  eine Fortschrittsanzeige, und mehrere Fotos sprengen sonst das Body-Limit.

---

# Verhaltensregeln

Behavioral guidelines to reduce common LLM coding mistakes.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"
