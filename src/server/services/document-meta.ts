import type { DocumentMetaInput } from '@/lib/validation/document';
import { readFieldMeta, type FieldMeta } from '@/lib/validation/document';
import type { SessionUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { log } from '@/server/log';

/**
 * Vom Benutzer bearbeitete Angaben eines Dokuments.
 *
 * Der Kern steht in `markUserEdited`: Jedes von Hand gesetzte Feld bekommt in
 * `fieldMeta` die Herkunft `USER`. Die Analyse liest das und ruehrt solche
 * Felder nie wieder an.
 *
 * Ohne diese Markierung waere jede Korrektur bis zur naechsten Analyse
 * gueltig - und der Benutzer haette den Eindruck, die Anwendung nehme ihn
 * nicht ernst.
 */

export type MetaUpdateResult = { ok: true } | { ok: false; error: string };

export async function updateDocumentMeta(
  actor: SessionUser,
  documentId: string,
  input: DocumentMetaInput,
): Promise<MetaUpdateResult> {
  const document = await db.document.findFirst({
    where: { id: documentId, userId: actor.id, deletedAt: null },
    select: {
      id: true,
      title: true,
      documentType: true,
      sender: true,
      recipient: true,
      subject: true,
      documentDate: true,
      receivedDate: true,
      personId: true,
      categoryId: true,
      fieldMeta: true,
    },
  });

  if (!document) return { ok: false, error: 'Dokument nicht gefunden.' };

  // Fremde Person oder Kategorie werden stillschweigend verworfen statt
  // uebernommen - ein praeparierter Aufruf soll nichts zuordnen koennen.
  const personId = input.personId
    ? ((
        await db.person.findFirst({
          where: { id: input.personId, userId: actor.id },
          select: { id: true },
        })
      )?.id ?? null)
    : null;

  const categoryId = input.categoryId
    ? ((
        await db.category.findFirst({
          where: { id: input.categoryId, userId: actor.id },
          select: { id: true },
        })
      )?.id ?? null)
    : null;

  const meta = readFieldMeta(document.fieldMeta);
  const changed: string[] = [];

  markIfChanged(meta, changed, 'title', document.title, input.title);
  markIfChanged(meta, changed, 'documentType', document.documentType, input.documentType);
  markIfChanged(meta, changed, 'sender', document.sender, input.sender);
  markIfChanged(meta, changed, 'recipient', document.recipient, input.recipient);
  markIfChanged(meta, changed, 'subject', document.subject, input.subject);
  markIfChanged(meta, changed, 'documentDate', asDay(document.documentDate), input.documentDate);
  markIfChanged(meta, changed, 'receivedDate', asDay(document.receivedDate), input.receivedDate);
  markIfChanged(meta, changed, 'person', document.personId, personId);
  markIfChanged(meta, changed, 'category', document.categoryId, categoryId);

  await db.document.update({
    where: { id: documentId },
    data: {
      title: input.title,
      documentType: input.documentType,
      sender: input.sender,
      recipient: input.recipient,
      subject: input.subject,
      documentDate: toDate(input.documentDate),
      receivedDate: toDate(input.receivedDate),
      personId,
      categoryId,
      // Wer die Angaben von Hand geprueft hat, hat die Prüfung erledigt.
      personUncertain: false,
      reviewState: 'REVIEWED',
      fieldMeta: meta as object,
    },
  });

  log.info('document.meta_updated', { documentId, fields: changed.length });
  return { ok: true };
}

/**
 * Vermerkt ein geaendertes Feld als vom Benutzer gesetzt.
 *
 * Nur bei echter Aenderung: Wer ein Formular oeffnet und ohne Aenderung
 * speichert, soll nicht versehentlich alle erkannten Angaben einfrieren.
 */
function markIfChanged(
  meta: FieldMeta,
  changed: string[],
  field: string,
  before: string | null,
  after: string | null,
): void {
  if ((before ?? null) === (after ?? null)) return;

  meta[field] = { source: 'USER', verification: 'USER', confidence: 100 };
  changed.push(field);
}

function asDay(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
