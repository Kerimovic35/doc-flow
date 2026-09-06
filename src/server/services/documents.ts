import { createHash } from 'node:crypto';
import type { DocumentLifecycle, ProcessingStatus } from '@/generated/prisma/enums';
import {
  MAX_FILES_PER_DOCUMENT,
  checkUpload,
  extensionFor,
  type AllowedMimeType,
} from '@/lib/validation/upload';
import type { SessionUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { enqueue } from '@/server/jobs/queue';
import { log } from '@/server/log';
import { originalKey, documentPrefix } from '@/server/storage/keys';
import { storage } from '@/server/storage/local';

/**
 * Dokumente: anlegen, Dateien annehmen, ausblenden.
 *
 * Der Ablauf beim Erfassen ist bewusst dreiteilig - Dokument anlegen, Dateien
 * einzeln senden, abschliessen. Ein einzelner Aufruf mit zehn Fotos waere auf
 * dem Telefon zerbrechlich: Ein Wechsel in eine andere App reicht, und der
 * ganze Upload beginnt von vorn. So bleibt jede Datei fuer sich, und was
 * angekommen ist, bleibt angekommen.
 */

export interface CreatedDocument {
  id: string;
}

export async function createDocument(
  actor: SessionUser,
  options: { personId?: string | null; categoryId?: string | null } = {},
): Promise<CreatedDocument> {
  // Personen- und Kategorie-ID muessen dem Benutzer gehoeren, sonst wuerde
  // ein praeparierter Aufruf ein Dokument einer fremden Person zuordnen.
  const personId = await ownedIdOrNull(actor, 'person', options.personId);
  const categoryId = await ownedIdOrNull(actor, 'category', options.categoryId);

  const document = await db.document.create({
    data: { userId: actor.id, personId, categoryId },
    select: { id: true },
  });

  log.info('document.created', { documentId: document.id, userId: actor.id });
  return { id: document.id };
}

async function ownedIdOrNull(
  actor: SessionUser,
  kind: 'person' | 'category',
  id: string | null | undefined,
): Promise<string | null> {
  if (!id) return null;

  const found =
    kind === 'person'
      ? await db.person.findFirst({ where: { id, userId: actor.id }, select: { id: true } })
      : await db.category.findFirst({ where: { id, userId: actor.id }, select: { id: true } });

  return found?.id ?? null;
}

export type AddFileResult =
  | { ok: true; fileId: string; mimeType: AllowedMimeType; duplicateOf: string | null }
  | { ok: false; error: string };

/**
 * Nimmt eine Datei zu einem Dokument entgegen.
 *
 * Reihenfolge ist wichtig: erst pruefen, dann in die Ablage schreiben, dann
 * in die Datenbank eintragen. Bricht der Vorgang dazwischen ab, bleibt
 * hoechstens eine verwaiste Datei liegen - nie ein Datenbankeintrag, der auf
 * nichts zeigt.
 */
export async function addFile(
  actor: SessionUser,
  documentId: string,
  input: { content: Uint8Array; originalName: string; declaredMimeType: string },
): Promise<AddFileResult> {
  const document = await db.document.findFirst({
    where: { id: documentId, userId: actor.id, deletedAt: null },
    select: { id: true, processingStatus: true, _count: { select: { files: true } } },
  });

  if (!document) {
    return { ok: false, error: 'Dokument nicht gefunden.' };
  }

  if (document.processingStatus !== 'UPLOADED') {
    return { ok: false, error: 'Das Dokument wird bereits verarbeitet.' };
  }

  if (document._count.files >= MAX_FILES_PER_DOCUMENT) {
    return {
      ok: false,
      error: `Höchstens ${MAX_FILES_PER_DOCUMENT} Dateien je Dokument.`,
    };
  }

  const checked = checkUpload(input.content, input.declaredMimeType);
  if (!checked.ok) {
    return { ok: false, error: checked.error };
  }

  const sha256 = createHash('sha256').update(input.content).digest('hex');

  // Dubletten werden gemeldet, nicht verhindert: Vielleicht liegt derselbe
  // Bescheid absichtlich zweimal vor. Die Entscheidung trifft der Benutzer.
  const duplicate = await db.documentFile.findFirst({
    where: { userId: actor.id, sha256, documentId: { not: documentId } },
    select: { documentId: true },
  });

  const file = await db.documentFile.create({
    data: {
      documentId,
      userId: actor.id,
      // Vorlaeufiger Schluessel; der endgueltige braucht die ID, die es erst
      // nach dem Anlegen gibt.
      storageKey: `pending/${documentId}/${sha256}`,
      originalName: input.originalName.slice(0, 255),
      mimeType: checked.mimeType,
      sizeBytes: input.content.byteLength,
      sha256,
      sortOrder: document._count.files,
    },
    select: { id: true },
  });

  const key = originalKey(actor.id, documentId, file.id, extensionFor(checked.mimeType));

  try {
    await storage().write(key, input.content);
  } catch (error) {
    // Ohne Datei ist der Eintrag wertlos - beides muss zusammen entstehen.
    await db.documentFile.delete({ where: { id: file.id } }).catch(() => undefined);
    throw error;
  }

  await db.documentFile.update({ where: { id: file.id }, data: { storageKey: key } });

  log.info('document.file_added', {
    documentId,
    fileId: file.id,
    bytes: input.content.byteLength,
    mimeType: checked.mimeType,
  });

  return {
    ok: true,
    fileId: file.id,
    mimeType: checked.mimeType,
    duplicateOf: duplicate?.documentId ?? null,
  };
}

export type FinishUploadResult = { ok: true } | { ok: false; error: string };

/** Schliesst das Erfassen ab und startet die Verarbeitung. */
export async function finishUpload(
  actor: SessionUser,
  documentId: string,
): Promise<FinishUploadResult> {
  const document = await db.document.findFirst({
    where: { id: documentId, userId: actor.id, deletedAt: null },
    select: { id: true, processingStatus: true, _count: { select: { files: true } } },
  });

  if (!document) return { ok: false, error: 'Dokument nicht gefunden.' };
  if (document._count.files === 0) {
    return { ok: false, error: 'Es wurde keine Datei hochgeladen.' };
  }
  if (document.processingStatus !== 'UPLOADED') {
    return { ok: true };
  }

  await enqueue({ type: 'INGEST', documentId, userId: actor.id });
  log.info('document.upload_finished', { documentId, files: document._count.files });

  return { ok: true };
}

/**
 * Verwirft ein Dokument, das nie fertig erfasst wurde.
 *
 * Nur solange nichts verarbeitet ist - danach gilt die Regel, dass nichts
 * geloescht, sondern nur ausgeblendet wird.
 */
export async function discardDraft(actor: SessionUser, documentId: string): Promise<void> {
  const document = await db.document.findFirst({
    where: { id: documentId, userId: actor.id, processingStatus: 'UPLOADED' },
    select: { id: true },
  });
  if (!document) return;

  await storage().removePrefix(documentPrefix(actor.id, documentId));
  await db.document.delete({ where: { id: documentId } });
  log.info('document.draft_discarded', { documentId });
}

export interface DocumentListItem {
  id: string;
  title: string | null;
  sender: string | null;
  documentDate: Date | null;
  createdAt: Date;
  processingStatus: ProcessingStatus;
  processingStep: string | null;
  progressDone: number;
  progressTotal: number;
  reviewState: 'NONE' | 'NEEDED' | 'REVIEWED';
  lifecycle: DocumentLifecycle;
  pageCount: number;
  personName: string | null;
  categoryName: string | null;
  thumbPageId: string | null;
}

export interface DocumentListFilter {
  personId?: string | null;
  categoryId?: string | null;
  lifecycle?: DocumentLifecycle | null;
  needsReview?: boolean;
  page?: number;
  pageSize?: number;
}

export interface DocumentListResult {
  items: DocumentListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listDocuments(
  actor: SessionUser,
  filter: DocumentListFilter = {},
): Promise<DocumentListResult> {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 25));

  const where = {
    userId: actor.id,
    deletedAt: null,
    ...(filter.personId ? { personId: filter.personId } : {}),
    ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
    ...(filter.lifecycle ? { lifecycle: filter.lifecycle } : {}),
    ...(filter.needsReview ? { reviewState: 'NEEDED' as const } : {}),
  };

  const [total, documents] = await Promise.all([
    db.document.count({ where }),
    db.document.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        sender: true,
        documentDate: true,
        createdAt: true,
        processingStatus: true,
        processingStep: true,
        progressDone: true,
        progressTotal: true,
        reviewState: true,
        lifecycle: true,
        pageCount: true,
        person: { select: { name: true } },
        category: { select: { name: true } },
        pages: {
          where: { pageNumber: 1 },
          select: { id: true, thumbKey: true },
          take: 1,
        },
      },
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    items: documents.map((document) => ({
      id: document.id,
      title: document.title,
      sender: document.sender,
      documentDate: document.documentDate,
      createdAt: document.createdAt,
      processingStatus: document.processingStatus,
      processingStep: document.processingStep,
      progressDone: document.progressDone,
      progressTotal: document.progressTotal,
      reviewState: document.reviewState,
      lifecycle: document.lifecycle,
      pageCount: document.pageCount,
      personName: document.person?.name ?? null,
      categoryName: document.category?.name ?? null,
      thumbPageId: document.pages[0]?.thumbKey ? document.pages[0].id : null,
    })),
  };
}

export async function getDocument(actor: SessionUser, documentId: string) {
  return db.document.findFirst({
    where: { id: documentId, userId: actor.id, deletedAt: null },
    select: {
      id: true,
      title: true,
      documentType: true,
      sender: true,
      recipient: true,
      subject: true,
      summary: true,
      documentDate: true,
      receivedDate: true,
      personId: true,
      personUncertain: true,
      categoryId: true,
      fieldMeta: true,
      processingStatus: true,
      processingStep: true,
      progressDone: true,
      progressTotal: true,
      failedStep: true,
      lastError: true,
      reviewState: true,
      lifecycle: true,
      pageCount: true,
      ocrAt: true,
      analyzedAt: true,
      createdAt: true,
      person: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      files: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          sortOrder: true,
        },
      },
      pages: {
        orderBy: { pageNumber: 'asc' },
        select: {
          id: true,
          pageNumber: true,
          width: true,
          height: true,
          text: true,
          textSource: true,
          ocrConfidence: true,
          imageKey: true,
          thumbKey: true,
        },
      },
    },
  });
}

/** Kurzfassung fuer die Fortschrittsanzeige. */
export async function getProcessingStatus(actor: SessionUser, documentId: string) {
  return db.document.findFirst({
    where: { id: documentId, userId: actor.id, deletedAt: null },
    select: {
      processingStatus: true,
      processingStep: true,
      progressDone: true,
      progressTotal: true,
      reviewState: true,
      pageCount: true,
      lastError: true,
    },
  });
}

export type DocumentUpdateResult = { ok: true } | { ok: false; error: string };

export async function setLifecycle(
  actor: SessionUser,
  documentId: string,
  lifecycle: DocumentLifecycle,
): Promise<DocumentUpdateResult> {
  const updated = await db.document.updateMany({
    where: { id: documentId, userId: actor.id, deletedAt: null },
    data: { lifecycle },
  });
  return updated.count > 0 ? { ok: true } : { ok: false, error: 'Dokument nicht gefunden.' };
}

/**
 * Blendet ein Dokument aus.
 *
 * Die Datei bleibt liegen. Die Anwendung ist ein Langzeitarchiv; ein
 * versehentlich entferntes Dokument muss zurueckholbar sein.
 */
export async function softDeleteDocument(
  actor: SessionUser,
  documentId: string,
): Promise<DocumentUpdateResult> {
  const updated = await db.document.updateMany({
    where: { id: documentId, userId: actor.id, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  if (updated.count === 0) return { ok: false, error: 'Dokument nicht gefunden.' };
  log.info('document.soft_deleted', { documentId });
  return { ok: true };
}

export async function restoreDocument(
  actor: SessionUser,
  documentId: string,
): Promise<DocumentUpdateResult> {
  const updated = await db.document.updateMany({
    where: { id: documentId, userId: actor.id, deletedAt: { not: null } },
    data: { deletedAt: null },
  });
  return updated.count > 0 ? { ok: true } : { ok: false, error: 'Dokument nicht gefunden.' };
}

/** Startet die Verarbeitung erneut - nach einem Fehler oder auf Wunsch. */
export async function reprocessDocument(
  actor: SessionUser,
  documentId: string,
): Promise<DocumentUpdateResult> {
  const document = await db.document.findFirst({
    where: { id: documentId, userId: actor.id, deletedAt: null },
    select: { id: true },
  });
  if (!document) return { ok: false, error: 'Dokument nicht gefunden.' };

  await db.document.update({
    where: { id: documentId },
    data: {
      processingStatus: 'UPLOADED',
      processingStep: null,
      progressDone: 0,
      failedStep: null,
      lastError: null,
    },
  });

  await enqueue({ type: 'INGEST', documentId, userId: actor.id });
  return { ok: true };
}

/** Datei zum Ausliefern - immer mit Pruefung, wem sie gehoert. */
export async function openOriginal(actor: SessionUser, documentId: string, fileId: string) {
  const file = await db.documentFile.findFirst({
    where: {
      id: fileId,
      documentId,
      userId: actor.id,
      document: { deletedAt: null },
    },
    select: { storageKey: true, mimeType: true, originalName: true, sizeBytes: true },
  });

  if (!file) return null;

  try {
    const stream = await storage().openRead(file.storageKey);
    return { stream, ...file };
  } catch {
    return null;
  }
}

/** Seitenbild oder Vorschau. */
export async function openPageImage(
  actor: SessionUser,
  documentId: string,
  pageId: string,
  variant: 'display' | 'thumb',
) {
  const page = await db.documentPage.findFirst({
    where: { id: pageId, documentId, userId: actor.id, document: { deletedAt: null } },
    select: { imageKey: true, thumbKey: true },
  });

  const key = variant === 'thumb' ? page?.thumbKey : page?.imageKey;
  if (!key) return null;

  try {
    return { stream: await storage().openRead(key) };
  } catch {
    return null;
  }
}
