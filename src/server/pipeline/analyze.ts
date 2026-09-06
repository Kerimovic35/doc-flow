import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { analysisSchema, type AnalysisOutput } from '@/lib/ai/analysis-schema';
import { amountToCents } from '@/lib/parsing/amount';
import { resolveDeadline, type DeadlineUnit } from '@/lib/parsing/relative-deadline';
import { normalizeIdentifier } from '@/lib/text/normalize';
import { readFieldMeta, type FieldMeta } from '@/lib/validation/document';
import { aiProvider } from '@/server/ai/registry';
import { AiRefusalError, AiUnavailableError, type ContentPart } from '@/server/ai/provider';
import { buildAnalysisSystemPrompt, buildDocumentText } from '@/server/ai/prompts/analysis';
import { cappedConfidence, checkQuote, type PageText } from '@/server/ai/guard/verify-quote';
import { verifyValue, type ValueKind } from '@/server/ai/guard/verify-fields';
import { db } from '@/server/db';
import { PermanentJobError } from '@/server/jobs/types';
import { errorMessage, log } from '@/server/log';
import { storage } from '@/server/storage/local';

/**
 * Die Analyse.
 *
 * Dritter und letzter Schritt der Kette. Sie schickt den erkannten Text an
 * die KI, prueft jede Antwort gegen den Text zurueck und schreibt nur, was
 * die Pruefung ueberstanden hat.
 *
 * Drei Zusagen an den Benutzer, die dieser Schritt einhalten muss:
 *
 * 1. Was von Hand eingetragen wurde, bleibt. Ein Feld mit Herkunft USER
 *    wird nie ueberschrieben - sonst waere jede Korrektur bis zur naechsten
 *    Analyse gueltig, und die Anwendung naehme den Benutzer nicht ernst.
 * 2. Automatisch erkannte Aufgaben und Zahlungen sind Vorschlaege. Sie
 *    zaehlen nirgends mit, bis der Benutzer sie bestaetigt.
 * 3. Ein Fehler kostet nie das Dokument. Scheitert die KI, bleiben
 *    Originale und erkannter Text unberuehrt; der Schritt ist wiederholbar.
 */

/** Bis zu wie vielen Seitenbildern die KI zusaetzlich bekommt. */
const MAX_IMAGES = 8;

/** Unter diesem Wert gilt ein Kernfeld als pruefbeduerftig. */
const REVIEW_CONFIDENCE = 60;

const CORE_FIELDS = ['title', 'sender', 'documentDate'] as const;

export interface AnalyzeOptions {
  /** 'reanalyze' erzwingt einen neuen Lauf, auch bei gleichem Text. */
  reason?: 'initial' | 'reanalyze';
}

export async function runAnalyze(documentId: string, options: AnalyzeOptions = {}): Promise<void> {
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      userId: true,
      fieldMeta: true,
      documentDate: true,
      receivedDate: true,
      user: {
        select: {
          settings: {
            select: { aiEnabled: true, aiProvider: true, aiModel: true, aiEffort: true, analysisUseImages: true },
          },
          persons: {
            where: { active: true },
            select: { id: true, name: true, kind: true, birthDate: true },
            orderBy: { sortOrder: 'asc' },
          },
          categories: {
            where: { active: true },
            select: { id: true, slug: true, name: true },
            orderBy: { sortOrder: 'asc' },
          },
        },
      },
      pages: {
        orderBy: { pageNumber: 'asc' },
        select: {
          id: true,
          pageNumber: true,
          text: true,
          textSource: true,
          imageKey: true,
          ocrConfidence: true,
        },
      },
    },
  });

  if (!document) throw new PermanentJobError('Dokument existiert nicht mehr.');

  const settings = document.user.settings;
  if (settings && !settings.aiEnabled) {
    // Der Benutzer hat die KI abgeschaltet - kein Fehler, nur nichts zu tun.
    await db.document.update({
      where: { id: documentId },
      data: { processingStatus: 'DONE', processingStep: null, reviewState: 'NEEDED' },
    });
    return;
  }

  const pages: PageText[] = document.pages.map((page) => ({
    pageNumber: page.pageNumber,
    text: page.text,
    fromVision: page.textSource === 'VISION',
  }));

  if (pages.every((page) => !page.text?.trim())) {
    throw new PermanentJobError(
      'Für dieses Dokument liegt kein erkannter Text vor. Bitte zuerst die Texterkennung wiederholen.',
    );
  }

  const provider = aiProvider(settings?.aiProvider ?? 'ANTHROPIC');
  if (!provider.available()) {
    throw new AiUnavailableError(
      'Für die KI ist kein Schlüssel hinterlegt. Das Dokument bleibt erhalten und kann später analysiert werden.',
    );
  }

  const { text, truncated } = buildDocumentText(document.pages);
  // Gleicher Text, gleiche Einstellungen, gleiches Ergebnis: Ein zweiter
  // Lauf ohne Aenderung kostet nur Geld.
  const inputHash = createHash('sha256')
    .update(`${text}|${settings?.aiModel ?? ''}|${settings?.aiEffort ?? ''}`)
    .digest('hex');

  if (options.reason !== 'reanalyze') {
    const previous = await db.analysisRun.findFirst({
      where: { documentId, kind: 'ANALYSIS', status: 'SUCCEEDED', inputHash },
      select: { id: true },
    });

    if (previous) {
      log.info('analyze.skipped', { documentId, reason: 'unveraendert' });
      await db.document.update({
        where: { id: documentId },
        data: { processingStatus: 'DONE', processingStep: null },
      });
      return;
    }
  }

  const model = settings?.aiModel ?? 'claude-opus-5';
  const run = await db.analysisRun.create({
    data: {
      documentId,
      userId: document.userId,
      kind: 'ANALYSIS',
      status: 'RUNNING',
      provider: provider.name,
      model,
      inputHash,
    },
    select: { id: true },
  });

  await db.document.update({
    where: { id: documentId },
    data: {
      processingStatus: 'ANALYZING',
      processingStep: 'Analyse läuft',
      failedStep: null,
      lastError: null,
    },
  });

  try {
    const content: ContentPart[] = [{ type: 'text', text }];

    if (settings?.analysisUseImages !== false) {
      // Bilder helfen bei Briefkoepfen, Tabellen und Stempeln. Die
      // Belegpruefung laeuft trotzdem nur gegen den erkannten Text - was
      // die KI nur im Bild sieht, gilt als unbestaetigt.
      for (const image of await loadImages(document.pages)) {
        content.push(image);
      }
    }

    const system = buildAnalysisSystemPrompt({
      persons: document.user.persons.map((person) => ({
        id: person.id,
        name: person.name,
        kind: person.kind,
        birthDate: person.birthDate ? person.birthDate.toISOString().slice(0, 10) : null,
      })),
      categories: document.user.categories.map(({ slug, name }) => ({ slug, name })),
      today: new Date().toISOString().slice(0, 10),
    });

    const result = await provider.extract<AnalysisOutput>({
      system,
      content,
      schema: analysisSchema,
      model,
      effort: settings?.aiEffort ?? 'high',
    });

    await applyAnalysis({
      documentId,
      userId: document.userId,
      runId: run.id,
      output: result.data,
      pages,
      existingMeta: readFieldMeta(document.fieldMeta),
      persons: document.user.persons.map((person) => person.id),
      categories: document.user.categories,
      anchors: {
        documentDate: asDay(document.documentDate),
        receivedDate: asDay(document.receivedDate),
      },
      truncated,
      lowestOcrConfidence: lowestConfidence(document.pages),
    });

    await db.analysisRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costCents: result.usage.costCents,
        rawOutput: result.data as unknown as Prisma.InputJsonValue,
      },
    });

    log.info('analyze.done', {
      documentId,
      model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costCents: result.usage.costCents,
    });
  } catch (error) {
    await db.analysisRun
      .update({
        where: { id: run.id },
        data: { status: 'FAILED', finishedAt: new Date(), error: errorMessage(error) },
      })
      .catch(() => undefined);

    // Eine Ablehnung wiederholt sich beim naechsten Versuch genauso.
    if (error instanceof AiRefusalError) {
      throw new PermanentJobError(error.message);
    }
    throw error;
  }
}

interface ApplyInput {
  documentId: string;
  userId: string;
  runId: string;
  output: AnalysisOutput;
  pages: PageText[];
  existingMeta: FieldMeta;
  persons: string[];
  categories: Array<{ id: string; slug: string }>;
  anchors: { documentDate: string | null; receivedDate: string | null };
  truncated: boolean;
  lowestOcrConfidence: number;
}

/**
 * Prueft die Antwort und schreibt sie - alles in einer Transaktion.
 *
 * Entweder das Dokument traegt danach den vollstaendigen Stand der Analyse,
 * oder gar keinen. Ein halb geschriebenes Ergebnis waere schlimmer als
 * keines: Man saehe Felder ohne die dazugehoerigen Aufgaben.
 */
async function applyAnalysis(input: ApplyInput): Promise<void> {
  const meta: FieldMeta = { ...input.existingMeta };
  const documentData: Record<string, unknown> = {};
  let needsReview = input.truncated;

  /** Uebernimmt ein Feld, sofern es nicht von Hand gesetzt wurde. */
  const takeField = (
    field: string,
    column: string,
    value: string | null,
    confidence: number,
    evidence: { page: number; quote: string } | null,
    kind: ValueKind,
  ) => {
    if (input.existingMeta[field]?.source === 'USER') return;

    const check = checkQuote(evidence, input.pages);
    const verification = check.found
      ? verifyValue(kind, value, check.excerpt)
      : ('UNVERIFIED' as const);
    const finalConfidence = cappedConfidence(confidence, verification, check.fromVision);

    documentData[column] = value;
    meta[field] = {
      confidence: finalConfidence,
      page: check.page ?? evidence?.page,
      quote: check.excerpt ?? evidence?.quote,
      verification,
      source: 'AI',
    };

    if (
      (CORE_FIELDS as readonly string[]).includes(field) &&
      value !== null &&
      (verification === 'UNVERIFIED' || finalConfidence < REVIEW_CONFIDENCE)
    ) {
      needsReview = true;
    }
  };

  const output = input.output;

  takeField('title', 'title', output.title.value, output.title.confidence, output.title.evidence, 'TEXT');
  takeField(
    'documentType',
    'documentType',
    output.documentType.value,
    output.documentType.confidence,
    output.documentType.evidence,
    'TEXT',
  );
  takeField('sender', 'sender', output.sender.value, output.sender.confidence, output.sender.evidence, 'TEXT');
  takeField(
    'recipient',
    'recipient',
    output.recipient.value,
    output.recipient.confidence,
    output.recipient.evidence,
    'TEXT',
  );
  takeField('subject', 'subject', output.subject.value, output.subject.confidence, output.subject.evidence, 'TEXT');

  // Daten gehen als Date in die Datenbank, nicht als Text.
  takeDate('documentDate', output.documentDate);
  takeDate('receivedDate', output.receivedDate);

  function takeDate(
    field: 'documentDate' | 'receivedDate',
    entry: AnalysisOutput['documentDate'],
  ): void {
    if (input.existingMeta[field]?.source === 'USER') return;

    const check = checkQuote(entry.evidence, input.pages);
    const verification = check.found ? verifyValue('DATE', entry.value, check.excerpt) : 'UNVERIFIED';
    const confidence = cappedConfidence(entry.confidence, verification, check.fromVision);

    documentData[field] = entry.value ? new Date(`${entry.value}T00:00:00.000Z`) : null;
    meta[field] = {
      confidence,
      page: check.page ?? entry.evidence?.page,
      quote: check.excerpt ?? entry.evidence?.quote,
      verification,
      source: 'AI',
    };

    if (
      (CORE_FIELDS as readonly string[]).includes(field) &&
      entry.value !== null &&
      (verification === 'UNVERIFIED' || confidence < REVIEW_CONFIDENCE)
    ) {
      needsReview = true;
    }
  }

  // --- Person ------------------------------------------------------
  if (input.existingMeta.person?.source !== 'USER') {
    const personId =
      output.person.personId && input.persons.includes(output.person.personId)
        ? output.person.personId
        : null;

    documentData.personId = personId;
    documentData.personUncertain = output.person.uncertain || personId === null;
    meta.person = {
      confidence: Math.round(output.person.confidence),
      verification: 'QUOTE_ONLY',
      source: 'AI',
    };

    if (documentData.personUncertain) needsReview = true;
  }

  // --- Kategorie ---------------------------------------------------
  if (input.existingMeta.category?.source !== 'USER') {
    const category = input.categories.find((entry) => entry.slug === output.category.slug);
    documentData.categoryId = category?.id ?? null;
    meta.category = {
      confidence: Math.round(output.category.confidence),
      verification: 'QUOTE_ONLY',
      source: 'AI',
    };
  }

  // --- Zusammenfassung ---------------------------------------------
  if (input.existingMeta.summary?.source !== 'USER') {
    documentData.summary = output.summary.trim() || null;
    meta.summary = { confidence: 0, verification: 'QUOTE_ONLY', source: 'AI' };
  }

  if (input.lowestOcrConfidence < 60) needsReview = true;

  // --- Belegte Einzelangaben ---------------------------------------
  const identifiers = collectIdentifiers(output, input.pages);
  const payments = collectPayments(output, input.pages, input.anchors);
  const tasks = collectTasks(output, input.pages, input.anchors);

  if (payments.length > 0 || tasks.length > 0) needsReview = true;

  await db.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: input.documentId },
      data: {
        ...documentData,
        fieldMeta: meta as Prisma.InputJsonValue,
        analyzedAt: new Date(),
        processingStatus: 'DONE',
        processingStep: null,
        reviewState: needsReview ? 'NEEDED' : 'NONE',
      },
    });

    for (const identifier of identifiers) {
      await tx.documentIdentifier.upsert({
        where: {
          documentId_kind_normalized: {
            documentId: input.documentId,
            kind: identifier.kind,
            normalized: identifier.normalized,
          },
        },
        create: { ...identifier, documentId: input.documentId, userId: input.userId },
        // Von Hand eingetragene Nummern bleiben, wie sie sind.
        update: {},
      });
    }

    for (const payment of payments) {
      const existing = await tx.payment.findFirst({
        where: { documentId: input.documentId, dedupeKey: payment.dedupeKey },
        select: { id: true, status: true },
      });

      if (!existing) {
        await tx.payment.create({
          data: { ...payment, documentId: input.documentId, userId: input.userId },
        });
        continue;
      }

      // Bestaetigte Zahlungen bleiben unberuehrt; nur Vorschlaege werden
      // aktualisiert.
      if (existing.status === 'PROPOSED') {
        await tx.payment.update({ where: { id: existing.id }, data: payment });
      }
    }

    for (const task of tasks) {
      const existing = await tx.task.findFirst({
        where: { documentId: input.documentId, dedupeKey: task.dedupeKey },
        select: { id: true, status: true },
      });

      if (!existing) {
        await tx.task.create({
          data: { ...task, documentId: input.documentId, userId: input.userId },
        });
        continue;
      }

      if (existing.status === 'PROPOSED') {
        await tx.task.update({ where: { id: existing.id }, data: task });
      }
    }
  });
}

function collectIdentifiers(output: AnalysisOutput, pages: PageText[]) {
  const seen = new Set<string>();
  const result = [];

  for (const identifier of output.identifiers) {
    const check = checkQuote(identifier.evidence, pages);
    // Eine Nummer ohne Fundstelle ist wertlos - danach wird gesucht.
    if (!check.found) continue;

    const normalized = normalizeIdentifier(identifier.value);
    if (!normalized || seen.has(`${identifier.kind}-${normalized}`)) continue;
    seen.add(`${identifier.kind}-${normalized}`);

    const verification = verifyValue('TEXT', identifier.value, check.excerpt);

    result.push({
      kind: identifier.kind,
      value: identifier.value,
      normalized,
      page: check.page,
      quote: check.excerpt,
      verification,
      confidence: cappedConfidence(identifier.confidence, verification, check.fromVision),
      source: 'AI',
    });
  }

  return result;
}

function collectPayments(
  output: AnalysisOutput,
  pages: PageText[],
  anchors: { documentDate: string | null; receivedDate: string | null },
) {
  const result = [];

  for (const payment of output.payments) {
    const check = checkQuote(payment.evidence, pages);
    // Ein Betrag ohne Fundstelle wird nicht angezeigt. Lieber keine
    // Zahlungsuebersicht als eine erfundene.
    if (!check.found) continue;

    const cents = amountToCents(payment.amount);
    if (cents === null) continue;

    const amountCheck = verifyValue('AMOUNT', payment.amount, check.excerpt);
    // Der Betrag muss im Zitat stehen - sonst belegt das Zitat ihn nicht.
    if (amountCheck !== 'VERIFIED') continue;

    const due = resolveDue(payment.due, anchors);
    const iban = payment.iban && verifyValue('IBAN', payment.iban, check.excerpt) === 'VERIFIED'
      ? payment.iban.replace(/\s/g, '').toUpperCase()
      : null;

    result.push({
      status: 'PROPOSED' as const,
      direction: payment.direction,
      amount: (cents / 100).toFixed(2),
      currency: payment.currency || 'EUR',
      dueDate: due.iso ? new Date(`${due.iso}T00:00:00.000Z`) : null,
      dueUncertain: due.uncertain,
      dueRule: due.rule,
      purpose: payment.purpose,
      iban,
      recipient: payment.recipient,
      page: check.page,
      quote: check.excerpt,
      verification: amountCheck,
      confidence: cappedConfidence(payment.confidence, amountCheck, check.fromVision),
      source: 'AI',
      dedupeKey: `${cents}-${due.iso ?? 'ohne'}-${payment.direction}`,
    });
  }

  return result;
}

function collectTasks(
  output: AnalysisOutput,
  pages: PageText[],
  anchors: { documentDate: string | null; receivedDate: string | null },
) {
  const result = [];
  const seen = new Set<string>();

  const entries = [
    ...output.tasks.map((task) => ({ ...task, kind: 'TASK' as const })),
    ...output.deadlines.map((deadline) => ({
      ...deadline,
      description: null,
      kind: 'DEADLINE' as const,
    })),
  ];

  for (const entry of entries) {
    const check = checkQuote(entry.evidence, pages);
    if (!check.found) continue;

    const dedupeKey = `${entry.kind}-${normalizeIdentifier(entry.title).slice(0, 40)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const due = resolveDue(entry.due, anchors);

    result.push({
      kind: entry.kind,
      status: 'PROPOSED' as const,
      title: entry.title,
      description: entry.description ?? null,
      dueDate: due.iso ? new Date(`${due.iso}T00:00:00.000Z`) : null,
      dueUncertain: due.uncertain,
      dueRule: due.rule,
      page: check.page,
      quote: check.excerpt,
      verification: 'QUOTE_ONLY' as const,
      confidence: cappedConfidence(entry.confidence, 'QUOTE_ONLY', check.fromVision),
      source: 'AI',
      dedupeKey,
    });
  }

  return result;
}

/**
 * Macht aus der Fristangabe der KI ein Datum.
 *
 * Relative Fristen rechnet die Anwendung selbst, nicht das Modell: Das
 * Rechnen ist die eine Aufgabe, bei der ein Programm zuverlaessiger ist -
 * und das Ergebnis traegt seine Herleitung, damit der Benutzer sie
 * nachvollziehen kann.
 */
function resolveDue(
  due: AnalysisOutput['payments'][number]['due'],
  anchors: { documentDate: string | null; receivedDate: string | null },
): { iso: string | null; uncertain: boolean; rule: string | null } {
  if (due.kind === 'absolute') {
    return { iso: due.date, uncertain: false, rule: null };
  }

  if (due.kind === 'relative') {
    const resolved = resolveDeadline(
      { amount: due.amount, unit: due.unit as DeadlineUnit, anchor: due.anchor },
      anchors,
    );
    return { iso: resolved.iso, uncertain: resolved.uncertain, rule: resolved.rule };
  }

  return { iso: null, uncertain: false, rule: null };
}

async function loadImages(
  pages: Array<{ imageKey: string | null; pageNumber: number }>,
): Promise<ContentPart[]> {
  const parts: ContentPart[] = [];

  for (const page of pages.slice(0, MAX_IMAGES)) {
    if (!page.imageKey) continue;

    try {
      const data = await storage().read(page.imageKey);
      parts.push({
        type: 'image',
        mediaType: 'image/webp',
        data: Buffer.from(data).toString('base64'),
      });
    } catch {
      // Ein fehlendes Seitenbild ist kein Grund, die Analyse abzubrechen -
      // der erkannte Text ist die eigentliche Grundlage.
    }
  }

  return parts;
}

function lowestConfidence(pages: Array<{ ocrConfidence: number | null }>): number {
  const values = pages
    .map((page) => page.ocrConfidence)
    .filter((value): value is number => value !== null);

  return values.length > 0 ? Math.min(...values) : 100;
}

function asDay(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}
