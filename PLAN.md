# Doc-Flow – Persönlicher Dokumentenmanager: Analyse & Architekturplan

## Kontext

Kerim möchte Papierbriefe und digitale Dokumente (AOK, Behörden, Verträge, Rechnungen …)
per iPhone erfassen, automatisch per OCR + KI verstehen lassen (Absender, Person, Typ,
Fristen, Zahlungen, Aufgaben, Zusammenfassung) und später per Suche oder KI-Assistent
wiederfinden. Private Nutzung auf eigenem VPS, ein Benutzerkonto mit mehreren
*Personen* (Kerim, Mutter, Vater). Kernregeln: Original nie verändern/verlieren, KI
erfindet nichts, jede dokumentenbasierte Aussage trägt eine Quelle (Dokument, Seite,
Textstelle).

Ausgangslage: `C:\Users\kerim\Doc-Flow` ist leer (nur eine aus TradeFlow kopierte
`CLAUDE.md`, wird ersetzt). Kein eigenes Git-Repo. Das Schwesterprojekt
`C:\Users\kerim\TradeFlow` liefert einen erprobten Stack und mehrere 1:1
übernehmbare Module (Auth, DB-Client, Dockerfile, Backup, Tests, UI-Basis).

### Getroffene Entscheidungen (mit Kerim bestätigt)

| Frage | Entscheidung |
|---|---|
| KI-Anbieter | Anthropic Claude primär (`claude-opus-5`), Provider-Interface, Ollama als zweiter Provider später |
| Deployment | Coolify wie TradeFlow: Dockerfile-Build, Auto-Deploy bei Push auf `master`, Postgres-Ressource, Volume `/data` |
| OCR | Tesseract lokal im Container (`deu+eng`) als Standard; Seiten mit niedriger Konfidenz optional per Claude-Vision nachbessern (Einstellung, standardmäßig aus) |
| Repository | Neues Repo in `Doc-Flow`, Hauptbranch `master`. Das verwaiste leere Repo in `C:\Users\kerim` bleibt unangetastet |

### Lokale Umgebung (geprüft)

- Windows 11, Node 24, npm 11, PostgreSQL 17 läuft als Dienst (`postgresql-x64-17`), `psql` nicht im PATH
- **Kein** Docker, **kein** Tesseract lokal → Tesseract per `winget install UB-Mannheim.TesseractOCR` (Phase 5, Pfad über `TESSERACT_PATH`), Docker nur auf dem VPS
- Ollama vorhanden (qwen2.5:7b, bge-m3) – Provider für Phase 10+, Embeddings später

---

## Phase 1 – Analyse: Risiken, Konflikte, Vereinfachungen

**Technische Risiken**
- Handyfotos → OCR-Qualität. Gegenmaßnahme: Vorverarbeitung mit `sharp` (EXIF-Rotation, Graustufen, `normalize()`, ~300 dpi), Tesseract-Konfidenz pro Seite speichern; unter Schwelle → „Prüfung erforderlich“ + optionale KI-Nachbesserung. Browser-Scanner mit Kantenerkennung (jscanify/OpenCV.js, ~8 MB WASM) erst in Phase 10.
- Halluzinationen. Gegenmaßnahme: serverseitige Quellenverifikation (unten) – kein Feld, keine Behauptung ohne im OCR-Text nachweisbares Zitat.
- Große PDFs blockieren den Server. Gegenmaßnahme: Hintergrund-Worker, Seiten einzeln, `await setImmediate()` zwischen Seiten, Fortschritt pro Seite. pdfjs-Rasterisierung läuft im JS-Thread → Worker-Modul framework-frei bauen, damit er später ein eigener Prozess sein kann.
- pdfjs + `@napi-rs/canvas` im Standalone-Build (Font-/CMap-Pfade, Bundling) → **Spike als erste Aufgabe in Phase 4**, Fallback poppler nur falls der Spike scheitert.
- `APP_ORIGIN` zur Bauzeit (Stolperstein aus TradeFlow) → Dockerfile `ARG`.
- Coolify-Volume `/data` vergessen → Dateiverlust. Entrypoint verweigert Start, wenn `/data/files` nicht beschreibbar.
- Kosten: ca. 0,05–0,15 USD je Brief mit Opus 5. Token/Kosten je Analyse speichern, Summe in Einstellungen; Modell/Effort umschaltbar.

**Fehlende Entscheidungen → selbst getroffen**
- Fristen vs. Aufgaben: eine Tabelle `Task` mit `kind` (`TASK` | `DEADLINE`). Zahlungen eigene Tabelle.
- Automatisch erkannte Aufgaben/Zahlungen bekommen Status `PROPOSED` (zählen nirgends mit, bis bestätigt). Kein automatisches Verwerfen nach X Tagen.
- „Prüfung erforderlich“ ist kein Pipeline-Status: `processingStatus` (UPLOADED/PREPARING/OCR/ANALYZING/DONE/FAILED) getrennt von `reviewState` (NONE/NEEDED/REVIEWED).
- Re-Analyse überschreibt nie vom Nutzer gesetzte Felder (`source: USER` in `fieldMeta`) und fasst bestätigte Aufgaben/Zahlungen nicht an.
- OCRResults → Spalten auf `DocumentPage`; Verlauf über `AnalysisRun`. DocumentMetadata → typisierte Spalten auf `Document` + `fieldMeta Json` + `DocumentIdentifier`. Notifications → `Reminder`, Settings → `UserSettings` + `SystemState`.
- Job-Queue: eigene Tabelle `ProcessingJob` (`FOR UPDATE SKIP LOCKED`, Lease, Backoff) – kein Redis, kein pg-boss.
- Rollen minimal: `USER` | `ADMIN` (ADMIN zusätzlich Backup/System), `assertRole` wie TradeFlow.
- API-Schlüssel nur in Env, nie in der DB.
- tesseract.js verworfen (langsamer, zweiter Codepfad); mupdf (AGPL) verworfen.

**Bewusste Vereinfachungen für v1**
- Keine Embeddings/pgvector; Retrieval über Postgres-Volltextsuche, die die KI per Tool anspricht.
- PWA = Manifest + Icons + minimaler Service Worker (Installierbarkeit), kein Offline-Modus.
- Erinnerungen nur in der App (Dashboard + Glocke), „materialisiert beim Lesen“ statt Timer. Push/E-Mail später.
- Ein Container (Web + Worker im selben Prozess, `WORKER_ENABLED`), lokal `npm run worker` als zweiter Prozess.
- Kein Audit-Log-Modell; technische Logs (pino, stdout) ohne Dokumentinhalte.
- Keine Offsite-Backups in v1 (Backups liegen unter `/data/backups`, optional `age`-verschlüsselt).

---

## Phase 2 – Architektur

### Technologie-Stack (identisch mit TradeFlow, Begründung: erprobt, Konventionen bekannt)

| Bereich | Wahl |
|---|---|
| Web | Next.js 16 App Router, React 19, TypeScript strict, Tailwind 4 (CSS-first, Auto-Dark-Mode) |
| API | Server Actions (dünn) für Formulare; Route Handler für Upload (multipart, Fortschritt), Dateiauslieferung, Status-Polling, Chat-Streaming (SSE) |
| DB | PostgreSQL 17, Prisma 7 + `@prisma/adapter-pg`, Client nach `src/generated/prisma` |
| Auth | Hand-rolled Sessions (Token-Hash + Pepper), `@node-rs/argon2`, Rate-Limit – aus TradeFlow |
| Dateien | Lokales Dateisystem `/data/files` hinter `StorageProvider`-Interface |
| Bilder/PDF | `sharp` (EXIF-Rotation, WebP, Thumbnails, OCR-PNG), `pdfjs-dist` (legacy build) + `@napi-rs/canvas` (Rasterisierung, Textextraktion born-digital) |
| OCR | Tesseract-CLI als Kindprozess (`-l deu+eng --psm 3 tsv`, `OMP_THREAD_LIMIT=1`), `OcrProvider`-Interface, `NullOcrProvider` für Tests, Vision-Provider optional |
| KI | `@anthropic-ai/sdk`: `messages.parse` + `zodOutputFormat` (Extraktion), `beta.messages.toolRunner` + `betaZodTool` (Chat, Streaming), adaptive thinking, `output_config.effort`; `AiProvider`-Interface, `FakeAiProvider` für Tests, Ollama-Provider später |
| Jobs | eigene `ProcessingJob`-Tabelle + Worker-Schleife (`src/server/jobs`) |
| Suche | `tsvector`-Spalten (`german`, GENERATED STORED, GIN) per Raw-Migration, `pg_trgm` nur auf kurzen Feldern |
| Tests | Vitest: `*.test.ts` ohne DB, `*.int.test.ts` gegen `docflow_test` (Mock von `@/server/db`, TRUNCATE) |
| Deploy | Dockerfile (node:24-bookworm-slim, + `tesseract-ocr tesseract-ocr-deu tesseract-ocr-osd postgresql-client-17 age`), Coolify, Volume `/data` |

### Verzeichnisstruktur

```
Doc-Flow/
  CLAUDE.md README.md .env.example .gitignore .dockerignore
  package.json tsconfig.json next.config.ts prisma.config.ts
  vitest.config.ts vitest.integration.config.ts eslint.config.mjs .prettierrc.json
  Dockerfile docker-entrypoint.sh
  .claude/launch.json                 # docflow-dev, docflow-worker
  scripts/{restore.sh, spike-pdf-render.ts}
  prisma/{schema.prisma, seed.ts, migrations/}
  public/ (Icons, Manifest-Assets)
  data/ (lokal: files/, backups/ – gitignored)
  src/
    app/
      layout.tsx globals.css manifest.ts page.tsx(→/start)
      login/{page,login-form,actions}
      (app)/layout.tsx loading.tsx error.tsx
      (app)/start/                    # Dashboard
      (app)/dokumente/{page, document-list, filters, actions}
      (app)/dokumente/neu/{page, upload-form, camera-capture}
      (app)/dokumente/[id]/{page, document-view, page-viewer, metadata-form, review-panel, proposals, ocr-text, chat-panel, actions}
      (app)/aufgaben/{page, task-list, payment-list, actions}
      (app)/suche/{page, search-form, results}
      (app)/ki/{page, [conversationId]/page, chat, actions}
      (app)/einstellungen/{page, konto/, personen/, kategorien/, ki/, erinnerungen/, system/}
      api/health/route.ts
      api/dokumente/upload/route.ts                 # Dokument anlegen + Dateien einzeln
      api/dokumente/[id]/abschliessen/route.ts      # INGEST anstoßen
      api/dokumente/[id]/status/route.ts
      api/dokumente/[id]/datei/[fileId]/route.ts    # Original
      api/dokumente/[id]/seite/[pageId]/route.ts    # Seitenbild (?thumb=1)
      api/ki/chat/route.ts                          # SSE
      api/system/backup/[name]/route.ts
    components/
      ui/{button,field,page-header,skeleton,icons,chip,badge,confidence-chip,sheet,tabs,empty-state}
      nav/{nav-items,bottom-nav,sidebar,header}
      documents/{status-badge,document-card,page-strip,source-popover}
      ai/{message,claim-footnotes,streaming-text}
    lib/                                # rein, ohne DB/Framework
      cn.ts form-state.ts labels.ts dates.ts money.ts
      text/{normalize,fuzzy-find,german-words}.ts
      parsing/{german-date,relative-deadline,amount,iban,identifiers}.ts
      validation/{auth,upload,document,person,category,task,payment,settings,search,chat}.ts
      ai/{analysis-schema,chat-schema}.ts           # Zod, geteilt Client/Server
    server/
      db.ts bootstrap.ts
      auth/{session,context,guard,password,rate-limit}.ts
      storage/{provider,local,keys}.ts
      files/{image,pdf,sniff}.ts
      ocr/{provider,tesseract-cli,vision-llm,null,confidence}.ts
      ai/{provider,anthropic,ollama,fake}.ts
      ai/prompts/{analysis,chat-global,chat-document}.ts
      ai/tools/{search-documents,get-document,get-document-pages,list-open-items}.ts
      ai/guard/{verify-quote,verify-fields,verify-claims}.ts
      jobs/{queue,worker,scheduler,types}.ts
      pipeline/{ingest,ocr,analyze,maintenance,status}.ts
      services/{auth,users,settings,persons,categories,tags,documents,document-files,pages,tasks,payments,reminders,search,analysis,conversations,dashboard,backup}.ts
    worker/main.ts                      # tsx-Einstieg (Entwicklung)
    instrumentation.ts middleware.ts
    test/{integration-db.ts, fake-ai.ts, fixtures/}
```

Schichtung wie TradeFlow: `app/` (dünne Adapter) → `server/services/` (Fachlogik, `actor: SessionUser` zuerst, Result-oder-Throw) → `lib/` (rein). Jede fachliche Zeile trägt `userId`; jeder Service filtert `where: { userId: actor.id }`.

### Datenmodell (Prisma, 20 Tabellen)

Enums: `UserRole {USER ADMIN}`, `PersonKind {SELF FAMILY OTHER}`, `DocumentLifecycle {ACTIVE ARCHIVED DONE}`, `ProcessingStatus {UPLOADED PREPARING OCR ANALYZING DONE FAILED}`, `ReviewState {NONE NEEDED REVIEWED}`, `TextSource {NONE PDF_TEXT OCR VISION}`, `RunKind {INGEST OCR ANALYSIS}`, `RunStatus {RUNNING SUCCEEDED FAILED SKIPPED}`, `JobType {INGEST OCR ANALYZE DAILY_MAINTENANCE BACKUP}`, `JobStatus {PENDING RUNNING SUCCEEDED FAILED CANCELLED}`, `TaskKind {TASK DEADLINE}`, `TaskStatus {PROPOSED OPEN DONE POSTPONED IGNORED}`, `PaymentDirection {OUTGOING INCOMING}`, `PaymentStatus {PROPOSED OPEN PAID IGNORED}`, `Verification {VERIFIED QUOTE_ONLY UNVERIFIED USER}`, `ConversationScope {GLOBAL DOCUMENT}`, `MessageRole {USER ASSISTANT}`, `AiProviderKind {ANTHROPIC OLLAMA}`.

| Modell | Kernfelder / Regeln |
|---|---|
| `User` | email @unique, name, passwordHash, role, active |
| `Session` | wie TradeFlow (tokenHash @unique, expiresAt, lastSeenAt) |
| `UserSettings` | 1:1; aiEnabled, aiProvider, aiModel (`claude-opus-5`), aiEffort (`high`), analysisUseImages, visionOcrEnabled, ocrConfidenceThreshold (70), reminderDays `[7,3,1,0]`, autoAnalyze, defaultCategoryId? |
| `SystemState` | key/value Json: Worker-Heartbeat, Seed-Version, letztes Backup |
| `Person` | userId, name, kind, birthDate?, notes?, sortOrder, active; @@unique(userId,name) |
| `Category` | userId, name, slug, sortOrder, isSystem; @@unique(userId,slug); 12 Seed-Kategorien |
| `Tag`, `DocumentTag` | @@unique(userId,name); @@id(documentId,tagId) |
| `Document` | processingStatus, processingStep?, progressDone/Total, failedStep?, lastError? (nie Inhalt), reviewState, lifecycle, deletedAt?; title, documentType, sender, recipient, subject, summary, documentDate @db.Date, receivedDate, personId?, personUncertain, categoryId?, `fieldMeta Json` `{feld: {confidence,page,quote,verification,source:'AI'|'USER'}}`, `searchVector Unsupported("tsvector")?`, analyzedAt?, ocrAt?, pageCount; Indizes (userId,deletedAt,lifecycle,createdAt desc), (userId,processingStatus), (userId,personId), (userId,categoryId), (userId,documentDate) |
| `DocumentFile` | Original, unveränderlich: storageKey @unique, originalName, mimeType, sizeBytes, sha256, sortOrder; @@index(userId,sha256) für Dubletten-Warnung |
| `DocumentPage` | documentId, fileId, pageNumber (1-basiert), pageInFile, width/height, rotation, imageKey/thumbKey/ocrInputKey, text?, textSource, ocrConfidence?, ocrRunId?, `searchVector Unsupported("tsvector")?`; @@unique(documentId,pageNumber) |
| `DocumentIdentifier` | kind (AKTENZEICHEN/KUNDENNUMMER/VERTRAGSNUMMER/REFERENZ/SONSTIGE), value, normalized, page?, quote?, verification, confidence, source; @@unique(documentId,kind,normalized), @@index(userId,normalized) |
| `AnalysisRun` | kind, status, provider?, model?, inputHash?, startedAt/finishedAt, inputTokens/outputTokens/costCents, rawOutput Json? (nur ANALYSIS), error? |
| `ProcessingJob` | type, status, documentId?, payload Json, dedupeKey, runAfter, attempts/maxAttempts (3), lockedBy?, lockedUntil?, lastError?; @@unique(documentId,type,dedupeKey), @@index(status,runAfter) |
| `Task` | kind, status, title, description?, dueDate?, dueUncertain, dueRule?, page?, quote?, verification, confidence?, source, analysisRunId?, dedupeKey?, postponedTo?, completedAt?; @@index(userId,status,dueDate) |
| `Payment` | status, direction, amount Decimal(12,2), currency, dueDate?, dueUncertain, purpose?, iban?, recipient?, page?, quote?, verification, confidence?, source, paidAt? |
| `Reminder` | taskId? / paymentId?, daysBefore, remindAt, seenAt?; @@unique(taskId,daysBefore), @@unique(paymentId,daysBefore) |
| `AiConversation` | scope, documentId?, title? |
| `AiMessage` | role, content, structured Json? (facts/interpretation/notFound nach Guard), provider/model/tokens |
| `AiSource` | messageId, documentId, pageId?, page, quote, verification, claimIndex |

Raw-SQL in Migrationen: `searchVector` als `GENERATED ALWAYS AS (…) STORED` (Document: title A, sender/subject B, summary C; Page: `to_tsvector('german', coalesce(text,''))`) + GIN; `pg_trgm`-GIN auf `documents.title`, `documents.sender`, `document_identifiers.normalized`. `Unsupported`-Felder im Schema deklarieren, damit `migrate dev` sie nicht als Drift löscht.

### Dateiablage

`/data/files/<userId>/<documentId>/original/<fileId>.<ext>` und `…/derived/<pageId>.webp | -thumb.webp | -ocr.png`. Schlüssel nur aus Server-IDs (kein Nutzer-Dateiname im Pfad), `path.resolve`-Prüfung gegen die Wurzel, Schreiben `tmp → fsync → rename`. `derived/` ist reproduzierbar (Backup lässt es aus, „Erneut verarbeiten“ löscht es). Auslieferung nur über auth-gated Route Handler, 404 statt 403 (kein ID-Enumerieren), Range-Support für PDFs.

### Verarbeitungspipeline

Jobs: `INGEST` → `OCR` → `ANALYZE`; daneben `DAILY_MAINTENANCE` (03:30: Sessions aufräumen, Erinnerungen, Backup enqueuen, alte Jobs löschen) und `BACKUP`.

**Worker** (`jobs/worker.ts`, framework-frei): alle 2 s (Leerlauf exponentiell bis 15 s) `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1` über `status='PENDING' AND runAfter<=now()` **oder** `status='RUNNING' AND lockedUntil<now()`; setzt RUNNING + `lockedUntil = now()+10 min`; Heartbeat in `SystemState`. Fehler → `attempts++`, `runAfter = now()+30 s·2^attempts`; bei `attempts>=maxAttempts` Job FAILED + Dokument FAILED mit `failedStep`. Nebenläufigkeit 1, SIGTERM beendet den laufenden Job sauber.

**INGEST** (idempotent: `derived/` + Pages löschen, neu aufbauen): sha256 der Originale prüfen; Bilder → sharp `rotate()` → WebP (≤1600 px), Thumb (300 px), OCR-PNG (~2500–3300 px, Graustufen, normalize); PDF → pdfjs `numPages` (Limit 300), je Seite `getTextContent()` + Heuristik (>200 Zeichen und >60 % echte Wörter → `PDF_TEXT`, sonst OCR nötig), Rasterisieren → gleiche Ableitungen; verschlüsseltes PDF → FAILED ohne Retry. UPLOADED → PREPARING → OCR (falls Seiten ohne Text) oder ANALYZING.

**OCR** (Checkpoint: Seiten mit Text überspringen): AnalysisRun(OCR); je Seite ggf. OSD-Drehung (`--psm 0`), `tesseract <png> stdout -l deu+eng --psm 3 tsv`, Text + längen-gewichtete Wortkonfidenz speichern, `processingStep = "OCR Seite 3 von 12"`, Zeitlimit 120 s/Seite. Optional Vision-OCR für Seiten unter Schwelle (`textSource=VISION`). Eine fehlgeschlagene Seite blockiert das Dokument nicht (Konfidenz 0, reviewState NEEDED). Danach ANALYZE (falls `autoAnalyze` + `aiEnabled`), sonst DONE + NEEDED.

**ANALYZE** (idempotent per `inputHash`, außer `reason='reanalyze'`): Eingabe = Seitentexte mit `<<Seite n>>`-Markern, Personen, Kategorien, heutiges Datum, optional bis 10 Seitenbilder → `provider.extract(AnalysisOutput)` → Guard → in einer Transaktion: Felder (nur wenn `source != USER`), Identifikatoren (upsert), Tasks/Payments als PROPOSED mit `dedupeKey`. `reviewState=NEEDED`, wenn ein Kernfeld <60 oder UNVERIFIED, `personUncertain`, PROPOSED vorhanden, Seitenkonfidenz unter Schwelle oder Eingabe gekürzt. Fehler (Refusal, Netz, Schema) → Run FAILED, Dokument FAILED `failedStep=ANALYZE`; OCR-Text bleibt, Dokument bleibt lesbar/durchsuchbar. „Erneut versuchen“ startet nur den fehlgeschlagenen Schritt.

**Suchindex**: generierte Spalten → kein eigener Job. **Status-UI**: `/api/dokumente/[id]/status` (2-s-Polling bis DONE/FAILED) → „Upload / Seiten werden vorbereitet / OCR läuft (3/12) / Analyse läuft / Fertig / Prüfung erforderlich / Fehler + Erneut versuchen“.

### KI-Architektur

**Interface** (`server/ai/provider.ts`):
```ts
interface AiProvider {
  kind: 'ANTHROPIC' | 'OLLAMA';
  extract<T>(req: { system; content: ContentPart[]; schema: z.ZodType<T>; model; effort? }): Promise<{ data: T; raw; usage }>;
  chat(req: { system; messages; tools: ToolDef[]; model; signal }): AsyncIterable<ChatEvent>; // text | tool_call | tool_result | final | refusal
}
```
Anthropic: `client.messages.parse({ model, max_tokens: 16000, thinking: {type:'adaptive'}, output_config: { format: zodOutputFormat(schema), effort } })`; Chat über `client.beta.messages.toolRunner({ stream: true, tools: betaZodTool(...) })`, `max_tokens` 64000. `stop_reason === 'refusal'` und `max_tokens` immer behandeln. System-Prompt + Tools stabil zuerst (Prompt-Caching), heutiges Datum am Ende; Dokument-Chat legt den Volltext als ersten User-Block mit `cache_control` ab.

**Analyse-Schema** (`lib/ai/analysis-schema.ts`): jedes Feld `{ value, confidence 0–100, evidence: {page, quote 6–240 Zeichen} | null }`; `affectedPerson {personId|null, confidence, uncertain, reasoning}`; `category {slug|null}`; `identifiers[]`, `payments[]` (amount, currency, direction, `due: absolute|relative{amount,unit,anchor}|none`, purpose, iban, evidence), `deadlines[]`, `tasks[]`, `summary` (max 1200, als „KI-Zusammenfassung“ gekennzeichnet).

**Guard** (`ai/guard/*`, reine Funktionen, unit-getestet):
1. Normalisieren (NFKC, Kleinschreibung, Silbentrennung am Zeilenende zusammenziehen, Anführungszeichen/Striche vereinheitlichen, Whitespace) mit Offset-Tabelle zum Original (für Hervorhebung).
2. Exakte Teilstringsuche → sonst Fuzzy-Fenster (Zitatlänge ±15 %, Levenshtein-Ratio ≥0,85 bei ≥20 Zeichen, ≥0,92 kürzer); Nachbarseiten prüfen, Seite korrigieren.
3. Wertkonsistenz: Datum/Betrag/IBAN aus dem Zitat parsen und mit `value` vergleichen.
4. Ergebnis `VERIFIED` / `QUOTE_ONLY` / `UNVERIFIED` (Konfidenz auf ≤30, reviewState NEEDED). Seiten aus `VISION` deckeln auf 70. Relative Fristen: Anker + n Einheiten, `dueUncertain=true`, `dueRule` als Klartext; ohne Anker `dueDate=null`.

**Chat-Tools** (alle mit `userId`-Filter): `search_documents`, `get_document`, `get_document_pages` (max 8 Seiten; Server protokolliert gelesene Seiten in `ToolContext.readPages`), `list_open_items`. Abschluss über Tool `final_answer` (strict): `{ facts: [{statement, documentId, page, quote}], interpretation|null, notFound[], answer }`. `verify-claims`: jeder Fakt muss auf eine **tatsächlich gelesene** Seite zeigen und das Zitat bestehen, sonst wird er entfernt und im Text als „(nicht belegt, entfernt)“ markiert; bleiben keine Fakten, wird die Antwort durch „In den Dokumenten wurde dazu nichts gefunden.“ ersetzt. Verifizierte Fakten → `AiSource` → Fußnoten mit Link `/dokumente/{id}?seite=n&hl=<quote>`. Dokument-Chat ohne Tools, gesamtes Dokument gilt als gelesen.

### Seiten & Navigation

Mobil `PRIMARY_NAV`: Start `/start`, Dokumente `/dokumente`, Aufgaben `/aufgaben`, Suche `/suche`, KI `/ki`; schwebender Button „Dokument hinzufügen“ → `/dokumente/neu`; Einstellungen über Header-Avatar. Desktop-Sidebar zusätzlich: Zahlungen (`/aufgaben?tab=zahlungen`), Personen, Kategorien, Einstellungen, System.

| Route | Inhalt |
|---|---|
| `/start` | Begrüßung, Handlungsbedarf (offene Aufgaben/Vorschläge), Heute wichtig, Offene Zahlungen, Zuletzt hinzugefügt, Personen, Kategorien, Glocke |
| `/dokumente` | Karten (mobil) / Tabelle (Desktop), Filter Person/Kategorie/Typ/Jahr/Status, Pagination |
| `/dokumente/neu` | Kamera-Mehrseitenaufnahme (`<input capture="environment">` je Seite, Vorschau, Reihenfolge), Galerie (multiple), PDF-Upload, Person/Kategorie vorab, Fortschritt (XHR) |
| `/dokumente/[id]` | Desktop Split: links Seitenbilder/Original, rechts Tabs Übersicht (Zusammenfassung, Handlungsbedarf, Zahlung, Vorschläge bestätigen/ignorieren), Metadaten (Formular mit Konfidenz-Chips + Quellen-Popover → springt zur Seite mit Hervorhebung), Text (OCR je Seite), Verlauf (AnalysisRuns), Chat. Mobil als Tabs untereinander. Lifecycle, Tags, Soft-Delete, „Erneut verarbeiten“ |
| `/aufgaben` | Tabs Aufgaben / Zahlungen / Vorschläge; erledigen, verschieben, ignorieren |
| `/suche` | Volltext + Filter, Snippets (`ts_headline`), Umschalter „KI fragen“ |
| `/ki`, `/ki/[id]` | Assistent mit Streaming, Blöcke Fakten / Interpretation / Nicht gefunden, Fußnoten, Verlauf |
| `/einstellungen/*` | konto (Profil, Passwort, Abmelden), personen, kategorien, ki (an/aus, Provider, Modell, Effort, Bilder, Vision-OCR, Kosten), erinnerungen (Vorlauftage), system (Backups, Worker-Status, Version) |

UI-Basis aus TradeFlow (`globals.css`-Tokens, `button`, `field`, `page-header`, `bottom-nav`, `sidebar`), erweitert um Chips, Badges, Tabs, Sheet. `Permissions-Policy` auf `camera=(self)`, CSP `img-src 'self' blob: data:`.

### Sicherheit

HTTPS via Coolify; Argon2id; Session-Cookie httpOnly/secure/lax; Rate-Limits für Login, Upload, Chat; Upload-Route prüft `Origin`/`Sec-Fetch-Site` gegen `APP_ORIGIN`; Magic-Byte-Sniffing (PDF/JPEG/PNG/WebP, HEIC sauber abgelehnt, SVG verboten), 50 MB/Datei, 20 Dateien/Dokument; Dateien nur über auth-gated Routes; alle Services filtern nach `userId`; Secrets nur in Env; Logs ohne Dokumentinhalte; nonce-CSP aus TradeFlow; Health-Endpoint ohne Versionsinfo (meldet Worker-Heartbeat informativ).

### Deployment (Coolify)

Dockerfile aus TradeFlow, ergänzt um `tesseract-ocr tesseract-ocr-deu tesseract-ocr-osd age`, `ENV FILES_DIR=/data/files BACKUP_DIR=/data/backups OMP_THREAD_LIMIT=1`, `outputFileTracingIncludes` für pdfjs-Fonts/CMaps, `serverExternalPackages` für `sharp`, `pdfjs-dist`, `@napi-rs/canvas`, `@node-rs/argon2`. Entrypoint: Env prüfen, `/data/files` beschreibbar (sonst Abbruch), `prisma migrate deploy`, Server starten. Coolify: Postgres-17-Ressource, Volume `/data` **vor** dem ersten Deploy, Env `DATABASE_URL`, `SESSION_SECRET`, `APP_ORIGIN` (Build-Zeit!), `ANTHROPIC_API_KEY`, `BOOTSTRAP_EMAIL/PASSWORD/NAME`, `TZ=Europe/Berlin`, optional `BACKUP_AGE_RECIPIENT`. Backups: nächtlich `pg_dump -Fc`, wöchentlich Voll-Tar der Originale + täglich inkrementell (`--newer-mtime`), Aufbewahrung 30 Tage; `scripts/restore.sh` dokumentiert und in Phase 3 einmal durchgespielt.

### Offene Entscheidungen (später, nicht blockierend)

1. Datenschutz-Schalter „dieses Dokument / diese Person nie an Cloud-KI“ (`aiPolicy`) – sinnvoll, sobald Ollama-Provider existiert.
2. Offsite-Backup (rclone/Storage Box) – dann `age`-Verschlüsselung Pflicht.
3. E-Mail-/Push-Erinnerungen – nach Phase 9 anhand echter Nutzung entscheiden.
4. Günstigeres Modell (`claude-sonnet-5`) für Massen-Re-Analysen als Einstellung anbieten – Default bleibt `claude-opus-5`.
5. Verwaistes Repo `C:\Users\kerim\.git` entfernen – Kerims Entscheidung, nicht Teil des Plans.

---

## Entwicklungsphasen (Arbeitspakete mit Verifikation)

### Phase 3 – Grundsystem
- **P3.1 Gerüst**: `git init`, `package.json` (Skripte wie TradeFlow + `worker`, `db:migrate:test`), tsconfig, `next.config.ts`, `middleware.ts`, `globals.css`, `.env.example`, `.gitignore` (+`data/`), `.dockerignore`, neue `CLAUDE.md`, `.claude/launch.json`. Verifikation: `npm run build`, `npm run typecheck`, Erst-Commit.
- **P3.2 DB + Auth**: vollständiges `schema.prisma` (spart Migrationen), `db.ts`, `auth/*`, `services/auth.ts`, Login, `(app)/layout.tsx`, Nav, `bootstrap.ts` (Erstnutzer aus Env, Seed: Personen Kerim/Mutter/Vater, 12 Kategorien), `seed.ts`; Dev-DBs `docflow_dev`/`docflow_test` anlegen. Tests: `guard`, `password`, `rate-limit` (unit), `auth.int` (Login, falsches Passwort, Ablauf, deaktiviert). Browser: Login → leerer `/start`, Bottom-Nav, Dark Mode.
- **P3.3 Jobs + Worker**: `jobs/*`, `worker/main.ts`, `instrumentation.ts`, Heartbeat, `/api/health`. Tests: `queue.int` (Dedupe, SKIP LOCKED bei zwei Claims, Lease-Ablauf, Backoff, maxAttempts → FAILED).
- **P3.4 Einstellungen**: Konto, Personen, Kategorien, Erinnerungstage, KI-Auswahl (noch ohne Funktion). Tests: `persons.int`, `categories.int` (Isolation fremder userId).
- **P3.5 Docker + Backup**: Dockerfile, Entrypoint, `services/backup.ts`, `scripts/restore.sh`, System-Seite. Verifikation: Coolify-Testdeploy baut, `/api/health` grün, Restore auf leerer DB durchgespielt.

### Phase 4 – Dokumente
- **P4.0 Spike** `scripts/spike-pdf-render.ts`: PDF → PNG + Text via pdfjs/@napi-rs/canvas auf Windows und im Docker-Image. Entscheidet über Fallback poppler.
- **P4.1 Storage + Dateien**: `storage/*`, `files/*`, `validation/upload.ts`. Tests: Traversal-Schutz, tmp→rename, Sniffing, EXIF-Drehung (Fixture), PDF-Seitenzahl/Textheuristik.
- **P4.2 Upload**: `services/documents.ts` (Dokument anlegen, Dateien einzeln, sha256, Dubletten-Warnung, `abschliessen` → INGEST), Route Handler mit Origin-Check und Limits. Tests: `documents.int` (Mehrbild → ein Dokument in Reihenfolge, PDF → n Seiten, kaputte Datei → 400, Original bleibt bei INGEST-Fehler).
- **P4.3 INGEST**: `pipeline/ingest.ts`, Statusmodell, Status-Route. Tests: `ingest.int` (born-digital PDF ohne OCR-Bedarf, Bild-Set, verschlüsseltes PDF → FAILED).
- **P4.4 UI**: `/dokumente`, `/dokumente/neu` (Kamera-Loop, Galerie, PDF, Fortschritt), `/dokumente/[id]` (Seiten, Original, Status, manuelles Metadatenformular, Lifecycle, Soft-Delete, Tags), Dateirouten. Tests: `file-access.int` (fremder Nutzer/keine Session/gelöscht → 404). Browser (iPhone im WLAN oder DevTools-Emulation): 3 Fotos → 1 Dokument, Statuswechsel sichtbar, Drehung korrekt.

### Phase 5 – OCR
- **P5.1** `ocr/*`, `pipeline/ocr.ts`, Text-Tab, Seitenkonfidenz, „OCR wiederholen“; Tesseract lokal per winget installieren. Tests: `confidence` (TSV-Parsing), `tesseract-cli.int` (`skipIf` ohne Binary, Fixture mit Umlauten), `ocr-pipeline.int` mit `NullOcrProvider` (Checkpoint-Resume, fehlerhafte Seite blockiert nicht).
- **P5.2** OSD-Drehung, Vision-OCR-Provider (Einstellung, aus).

### Phase 6 – KI-Analyse
- **P6.1** `lib/parsing/*`, `lib/text/*`. Tests: viele Fälle („innerhalb von zwei Wochen“, „bis zum 15.04.2026“, „14 Tage nach Zugang“, „1.234,56 €“, „EUR 12,-“, Trennstriche, OCR-Fehler im Zitat).
- **P6.2** `ai/provider.ts`, `anthropic.ts`, `fake.ts`, `analysis-schema.ts`, `prompts/analysis.ts`. Tests: Schema-Roundtrip; `anthropic.live.test` nur mit `AI_LIVE_TESTS=1`.
- **P6.3** Guard, `pipeline/analyze.ts`, `services/analysis.ts`, Tasks/Payments-Services. Tests: `verify-quote` (exakt, fuzzy, falsche Seite, erfundenes Zitat → UNVERIFIED), `analyze.int` mit `FakeAiProvider` (Felder geschrieben, USER-Feld bleibt, PROPOSED angelegt, keine Dublette bei zweiter Analyse, Refusal → FAILED ohne Datenverlust, reviewState-Logik).
- **P6.4 UI**: Übersicht-Tab, Konfidenz-Chips + Quellen-Popover mit Seitensprung, Vorschläge, Person-unsicher-Hinweis, Verlauf, `/aufgaben` inkl. Zahlungen. Tests: `tasks.int`, `payments.int`. Browser: echter Brief durch die Pipeline.

### Phase 7 – Suche
- **P7.1** Raw-Migration (tsvector, GIN, pg_trgm), `services/search.ts` (`websearch_to_tsquery('german')`, Dokument- oder Seitentreffer, `ts_rank_cd`, `ts_headline`, Filter, Pagination), `/suche`. Tests: `search.int` (Stemming „Bescheide“→„Bescheid“, Aktenzeichen exakt, Filterkombinationen, Isolation, Soft-Delete unsichtbar, stabile Pagination).
- **P7.2** Filterleiste in `/dokumente`, Facetten Jahr/Person.

### Phase 8 – KI-Assistent
- **P8.1** Tools, `ToolContext.readPages`, `chat-schema.ts`, `verify-claims.ts`, `services/conversations.ts`, `/api/ki/chat` (SSE, Rate-Limit, Abbruch). Tests: `verify-claims` (ungelesene Seite → entfernt, fuzzy ok, ohne Fakten → Standardtext), `conversations.int` (Speicherung, AiSource, Isolation), Tool-Ablauf mit FakeAiProvider.
- **P8.2 UI**: `/ki` mit Streaming und getrennten Blöcken, Fußnoten; Dokument-Chat-Tab. Browser: „Wann muss ich die Krankenkasse bezahlen?“ → Fakt mit Fußnote → Klick landet auf der Seite mit Hervorhebung.

### Phase 9 – Dashboard & Erinnerungen
- **P9.1** `services/reminders.ts` (`ensureReminders`, idempotent), `services/dashboard.ts`, `/start` komplett, Glocke, `DAILY_MAINTENANCE`. Tests: `reminders.int` (7/3/1/0 idempotent, erledigte Aufgabe erzeugt keine, Konfiguration greift), `dashboard.int`.
- **P9.2** PWA: `manifest.ts`, Icons, minimaler Service Worker, Safe-Area-Feinschliff, Ladeskelette.

### Phase 10 – Optimierung
- `EXPLAIN` auf 5k synthetischen Dokumenten (Seed-Skript), Cache-Header für Seitenbilder, Lazy-Loading, OCR-Parallelität 2.
- Browser-Scanner (jscanify, CSP `'wasm-unsafe-eval'`), Ollama-Provider, pgvector + bge-m3, Android Share-Target, Web-Push, separater Worker-Container (`WORKER_MODE`).
- README (Setup Windows/VPS, Restore, Kosten), Sicherheits-Review, CLAUDE.md-Feinschliff.

---

## Verifikation (gesamt)

- Jede Phase endet mit `npm run typecheck`, `npm run lint`, `npm run test:all` grün und einem Browser-Check der geänderten Seiten (Bundling-Fehler fangen Tests nicht).
- Ende Phase 6: ein echter Brief (Foto, 2–3 Seiten) und ein Scanner-PDF laufen fehlerfrei durch; alle Felder tragen Konfidenz und Quelle; ein Feld manuell ändern → Re-Analyse lässt es stehen.
- Ende Phase 8: Frage ohne Antwort in den Dokumenten liefert „nicht gefunden“, kein erfundener Fakt; jede Fußnote führt zu einer sichtbaren Textstelle.
- Ende Phase 9: Ablauf aus Abschnitt 54 des Master-Prompts (Brief → „+ Dokument hinzufügen“ → Fotos → Fertig → Ergebniskarte) auf dem iPhone in unter einer Minute Bedienzeit.
- Deployment: Coolify-Deploy grün, `/api/health` ok, Backup erzeugt, Restore einmal getestet.

## Wiederverwendete Vorlagen aus TradeFlow

`src/server/auth/{session,context,guard,password,rate-limit}.ts`, `src/server/services/auth.ts`, `src/app/login/*`, `src/server/db.ts`, `prisma.config.ts`, `src/instrumentation.ts`, `src/middleware.ts`, `next.config.ts`, `Dockerfile`, `docker-entrypoint.sh`, `src/server/services/backup.ts`, `src/lib/validation/upload.ts`, `src/app/api/dokumente/[id]/route.ts`, `src/test/integration-db.ts`, `vitest*.config.ts`, `src/app/globals.css`, `src/components/{ui,nav}/*`, `src/lib/form-state.ts`, `README.md` (Coolify-Abschnitte).
