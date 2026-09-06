import { z } from 'zod';
import type { SessionUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { searchDocuments } from '@/server/services/search';
import { listTasks } from '@/server/services/tasks';
import { listPayments } from '@/server/services/payments';
import type { ReadPage } from '@/server/ai/guard/verify-claims';

/**
 * Die Werkzeuge des Assistenten.
 *
 * Vier, nicht mehr: suchen, ein Dokument ansehen, Seiten lesen, offene
 * Posten auflisten. Jedes zusaetzliche Werkzeug verwaessert die Auswahl und
 * macht das Modell unentschlossener.
 *
 * Zwei Eigenschaften sind nicht verhandelbar:
 *
 * 1. Jede Abfrage filtert nach `userId`. Ein Werkzeug ist ein Weg in die
 *    Datenbank, den ein Modell steuert - dort ist die Rechtepruefung am
 *    wichtigsten, nicht am unwichtigsten.
 * 2. Jede ausgelieferte Seite wird mitgeschrieben. Nur worauf das Modell
 *    wirklich gesehen hat, darf es sich spaeter berufen.
 */

export interface ToolContext {
  actor: SessionUser;
  /** Alles, was das Modell in diesem Gespraech gelesen hat. */
  readPages: ReadPage[];
  /** Auf dieses Dokument beschraenkt (Dokument-Chat). */
  documentId?: string;
}

export interface ToolDefinition<I = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<I>;
  run(input: I, context: ToolContext): Promise<string>;
}

const searchInput = z.object({
  query: z.string().max(200).describe('Suchbegriff, z. B. "AOK Beitrag" oder ein Aktenzeichen'),
  personId: z.string().nullable().optional(),
  categorySlug: z.string().nullable().optional(),
  year: z.number().int().min(1900).max(2200).nullable().optional(),
  withDeadline: z.boolean().optional(),
});

const searchDocumentsTool: ToolDefinition<z.infer<typeof searchInput>> = {
  name: 'search_documents',
  description:
    'Sucht Dokumente über den erkannten Text, die Angaben und die Nummern. Liefert eine Liste mit ID, Titel, Absender, Datum und Seitenzahl - nicht den Text selbst.',
  schema: searchInput,

  async run(input, context) {
    const category = input.categorySlug
      ? await db.category.findFirst({
          where: { userId: context.actor.id, slug: input.categorySlug },
          select: { id: true },
        })
      : null;

    const result = await searchDocuments(context.actor, input.query ?? '', {
      personId: input.personId ?? null,
      categoryId: category?.id ?? null,
      year: input.year ?? null,
      withDeadline: input.withDeadline ?? false,
      pageSize: 10,
    });

    if (result.hits.length === 0) {
      return JSON.stringify({ treffer: [], hinweis: 'Keine Dokumente gefunden.' });
    }

    return JSON.stringify({
      treffer: result.hits.map((hit) => ({
        documentId: hit.id,
        titel: hit.title,
        absender: hit.sender,
        datum: hit.documentDate ? hit.documentDate.toISOString().slice(0, 10) : null,
        person: hit.personName,
        kategorie: hit.categoryName,
        seiten: hit.pageCount,
        trefferSeite: hit.matchPage,
      })),
      gesamt: result.total,
    });
  },
};

const documentInput = z.object({
  documentId: z.string().max(40),
});

const getDocumentTool: ToolDefinition<z.infer<typeof documentInput>> = {
  name: 'get_document',
  description:
    'Liefert die Angaben zu einem Dokument: Titel, Absender, Datum, Person, Kategorie, Nummern sowie die daraus erkannten Aufgaben und Zahlungen. Ohne den Seitentext.',
  schema: documentInput,

  async run(input, context) {
    const document = await db.document.findFirst({
      where: { id: input.documentId, userId: context.actor.id, deletedAt: null },
      select: {
        id: true,
        title: true,
        documentType: true,
        sender: true,
        recipient: true,
        subject: true,
        summary: true,
        documentDate: true,
        pageCount: true,
        person: { select: { name: true } },
        category: { select: { name: true } },
        identifiers: { select: { kind: true, value: true } },
        tasks: {
          where: { status: { in: ['PROPOSED', 'OPEN', 'POSTPONED'] } },
          select: { title: true, status: true, dueDate: true },
        },
        payments: {
          where: { status: { in: ['PROPOSED', 'OPEN'] } },
          select: { amount: true, currency: true, direction: true, status: true, dueDate: true },
        },
      },
    });

    if (!document) return JSON.stringify({ fehler: 'Dokument nicht gefunden.' });

    return JSON.stringify({
      documentId: document.id,
      titel: document.title,
      art: document.documentType,
      absender: document.sender,
      empfaenger: document.recipient,
      betreff: document.subject,
      zusammenfassung: document.summary,
      datum: document.documentDate?.toISOString().slice(0, 10) ?? null,
      person: document.person?.name ?? null,
      kategorie: document.category?.name ?? null,
      seiten: document.pageCount,
      nummern: document.identifiers.map((entry) => `${entry.kind}: ${entry.value}`),
      aufgaben: document.tasks.map((task) => ({
        titel: task.title,
        status: task.status,
        faellig: task.dueDate?.toISOString().slice(0, 10) ?? null,
      })),
      zahlungen: document.payments.map((payment) => ({
        betrag: payment.amount.toString(),
        waehrung: payment.currency,
        richtung: payment.direction,
        status: payment.status,
        faellig: payment.dueDate?.toISOString().slice(0, 10) ?? null,
      })),
      hinweis:
        'Für Zitate den Seitentext mit get_document_pages anfordern. Nur gelesene Seiten dürfen belegt werden.',
    });
  },
};

const pagesInput = z.object({
  documentId: z.string().max(40),
  pages: z.array(z.number().int().min(1).max(1000)).min(1).max(8),
});

const getDocumentPagesTool: ToolDefinition<z.infer<typeof pagesInput>> = {
  name: 'get_document_pages',
  description:
    'Liefert den erkannten Text einzelner Seiten. Nur aus diesen Texten darf zitiert werden - höchstens acht Seiten je Aufruf.',
  schema: pagesInput,

  async run(input, context) {
    const pages = await db.documentPage.findMany({
      where: {
        documentId: input.documentId,
        userId: context.actor.id,
        pageNumber: { in: input.pages },
        document: { deletedAt: null },
      },
      orderBy: { pageNumber: 'asc' },
      select: { pageNumber: true, text: true, ocrConfidence: true, textSource: true },
    });

    if (pages.length === 0) {
      return JSON.stringify({ fehler: 'Keine Seiten gefunden.' });
    }

    for (const page of pages) {
      if (!page.text) continue;
      // Mitschreiben: Worauf sich das Modell spaeter berufen darf.
      context.readPages.push({
        documentId: input.documentId,
        page: page.pageNumber,
        text: page.text,
      });
    }

    return JSON.stringify({
      documentId: input.documentId,
      seiten: pages.map((page) => ({
        seite: page.pageNumber,
        text: page.text ?? '(kein Text erkannt)',
        erkennungsguete: page.ocrConfidence,
        herkunft: page.textSource,
      })),
    });
  },
};

const openItemsInput = z.object({
  kind: z.enum(['aufgaben', 'zahlungen']),
  personId: z.string().nullable().optional(),
});

const listOpenItemsTool: ToolDefinition<z.infer<typeof openItemsInput>> = {
  name: 'list_open_items',
  description:
    'Listet offene Aufgaben oder Zahlungen mit Fälligkeit und zugehörigem Dokument. Vorschläge, die noch nicht bestätigt wurden, sind gekennzeichnet.',
  schema: openItemsInput,

  async run(input, context) {
    if (input.kind === 'zahlungen') {
      const payments = await listPayments(context.actor, { status: ['OPEN', 'PROPOSED'] });
      return JSON.stringify({
        zahlungen: payments.map((payment) => ({
          betrag: (payment.amountCents / 100).toFixed(2),
          waehrung: payment.currency,
          richtung: payment.direction,
          faellig: payment.dueDate?.toISOString().slice(0, 10) ?? null,
          unsicher: payment.dueUncertain,
          zweck: payment.purpose,
          bestaetigt: payment.status === 'OPEN',
          documentId: payment.documentId,
          dokument: payment.documentTitle,
          seite: payment.page,
        })),
      });
    }

    const tasks = await listTasks(context.actor, {
      status: ['OPEN', 'POSTPONED', 'PROPOSED'],
      personId: input.personId ?? undefined,
    });

    return JSON.stringify({
      aufgaben: tasks.map((task) => ({
        titel: task.title,
        faellig: task.dueDate?.toISOString().slice(0, 10) ?? null,
        unsicher: task.dueUncertain,
        bestaetigt: task.status !== 'PROPOSED',
        documentId: task.documentId,
        dokument: task.documentTitle,
        person: task.personName,
        seite: task.page,
      })),
    });
  },
};

export const CHAT_TOOLS: ToolDefinition<never>[] = [
  searchDocumentsTool,
  getDocumentTool,
  getDocumentPagesTool,
  listOpenItemsTool,
] as unknown as ToolDefinition<never>[];

/** Werkzeuge fuer den Chat zu genau einem Dokument. */
export const DOCUMENT_TOOLS: ToolDefinition<never>[] = [
  getDocumentPagesTool,
] as unknown as ToolDefinition<never>[];
