import type { JobType } from '@/generated/prisma/enums';
import type { InputJsonValue } from '@/generated/prisma/internal/prismaNamespace';
import { db, type Tx } from '@/server/db';
import type { ClaimedJob } from './types';

/**
 * Auftragswarteschlange in PostgreSQL.
 *
 * Kein Redis, kein zusaetzlicher Dienst: Bei einem Benutzer und wenigen
 * Auftraegen pro Tag waere das unverhaeltnismaessig. Der Nebeneffekt ist
 * wertvoll - die Auftraege liegen im selben Backup wie die Daten, und ein
 * abgebrochener Lauf ist nach einem Neustart noch da.
 *
 * Zwei Bausteine tragen die Zuverlaessigkeit:
 *   1. FOR UPDATE SKIP LOCKED - zwei Worker greifen sich nie denselben
 *      Auftrag, ohne dass einer auf den anderen warten muss.
 *   2. Pacht (lockedUntil) statt reiner Sperre - stuerzt ein Worker mitten im
 *      Auftrag ab, holt der naechste Lauf ihn nach Ablauf zurueck. Eine
 *      Datenbanksperre waere mit der Verbindung verschwunden, der Auftrag
 *      aber fuer immer auf RUNNING stehen geblieben.
 */

/** Wie lange ein Worker einen Auftrag fuer sich beansprucht. */
export const LEASE_MS = 10 * 60 * 1000;

const BASE_BACKOFF_MS = 30 * 1000;

export interface EnqueueOptions {
  type: JobType;
  documentId?: string | null;
  userId?: string | null;
  payload?: Record<string, InputJsonValue>;
  /**
   * Unterscheidet Auftraege derselben Art am selben Dokument. Leer bedeutet
   * "es gibt nur einen" - ein zweiter Klick auf "Erneut versuchen" erzeugt
   * dann keinen doppelten Auftrag.
   */
  dedupeKey?: string;
  runAfter?: Date;
  maxAttempts?: number;
}

/**
 * Stellt einen Auftrag ein. Existiert bereits einer mit demselben
 * Eindeutigkeitsschluessel, wird er wiederbelebt statt verdoppelt: Ein
 * erledigter oder gescheiterter Auftrag geht zurueck auf PENDING, ein noch
 * offener bleibt, wie er ist.
 */
export async function enqueue(options: EnqueueOptions, tx: Tx = db): Promise<string> {
  const {
    type,
    documentId = null,
    userId = null,
    payload = {},
    dedupeKey = '',
    runAfter = new Date(),
    maxAttempts = 3,
  } = options;

  const existing = await tx.processingJob.findFirst({
    where: { documentId, type, dedupeKey },
    select: { id: true, status: true },
  });

  if (existing) {
    if (existing.status === 'PENDING' || existing.status === 'RUNNING') {
      return existing.id;
    }

    await tx.processingJob.update({
      where: { id: existing.id },
      data: {
        status: 'PENDING',
        payload,
        runAfter,
        attempts: 0,
        maxAttempts,
        lockedBy: null,
        lockedUntil: null,
        lastError: null,
        startedAt: null,
        finishedAt: null,
      },
    });
    return existing.id;
  }

  const job = await tx.processingJob.create({
    data: { type, documentId, userId, payload, dedupeKey, runAfter, maxAttempts },
    select: { id: true },
  });
  return job.id;
}

interface ClaimRow {
  id: string;
  type: JobType;
  document_id: string | null;
  user_id: string | null;
  payload: unknown;
  attempts: number;
  max_attempts: number;
}

/**
 * Holt den naechsten faelligen Auftrag und beansprucht ihn.
 *
 * Faellig ist ein Auftrag, wenn er wartet und seine Startzeit erreicht ist -
 * oder wenn er als laufend gilt, seine Pacht aber abgelaufen ist (der
 * bearbeitende Worker ist dann abgestuerzt).
 */
export async function claimNextJob(workerId: string, tx: Tx = db): Promise<ClaimedJob | null> {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + LEASE_MS);

  const rows = await tx.$queryRaw<ClaimRow[]>`
    UPDATE "processing_jobs" AS j
    SET "status" = 'RUNNING',
        "locked_by" = ${workerId},
        "locked_until" = ${lockedUntil},
        "started_at" = COALESCE(j."started_at", ${now}),
        "attempts" = j."attempts" + 1
    WHERE j."id" = (
      SELECT c."id"
      FROM "processing_jobs" AS c
      WHERE (c."status" = 'PENDING' AND c."run_after" <= ${now})
         OR (c."status" = 'RUNNING' AND c."locked_until" < ${now})
      ORDER BY c."run_after" ASC, c."created_at" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING j."id", j."type", j."document_id", j."user_id", j."payload",
              j."attempts", j."max_attempts"
  `;

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    type: row.type,
    documentId: row.document_id,
    userId: row.user_id,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}

export async function completeJob(jobId: string, tx: Tx = db): Promise<void> {
  await tx.processingJob.update({
    where: { id: jobId },
    data: {
      status: 'SUCCEEDED',
      finishedAt: new Date(),
      lockedBy: null,
      lockedUntil: null,
      lastError: null,
    },
  });
}

export interface FailureOutcome {
  /** Wird der Auftrag noch einmal versucht? */
  willRetry: boolean;
  nextRunAt: Date | null;
}

/**
 * Vermerkt einen Fehlschlag.
 *
 * Der Abstand zum naechsten Versuch waechst exponentiell (30 s, 60 s, 120 s).
 * Bei einem dauerhaften Hindernis - Netz weg, Schluessel abgelaufen - haette
 * sofortiges Wiederholen keinen Wert und wuerde nur das Protokoll fluten.
 *
 * `permanent` ueberspringt jede Wiederholung: Ein verschluesseltes PDF wird
 * beim dritten Versuch nicht lesbarer.
 */
export async function failJob(
  jobId: string,
  message: string,
  options: { permanent?: boolean } = {},
  tx: Tx = db,
): Promise<FailureOutcome> {
  const job = await tx.processingJob.findUniqueOrThrow({
    where: { id: jobId },
    select: { attempts: true, maxAttempts: true },
  });

  const exhausted = options.permanent === true || job.attempts >= job.maxAttempts;

  if (exhausted) {
    await tx.processingJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        lockedBy: null,
        lockedUntil: null,
        lastError: message.slice(0, 500),
      },
    });
    return { willRetry: false, nextRunAt: null };
  }

  const nextRunAt = new Date(Date.now() + BASE_BACKOFF_MS * 2 ** (job.attempts - 1));

  await tx.processingJob.update({
    where: { id: jobId },
    data: {
      status: 'PENDING',
      runAfter: nextRunAt,
      lockedBy: null,
      lockedUntil: null,
      lastError: message.slice(0, 500),
    },
  });

  return { willRetry: true, nextRunAt };
}

/** Loescht abgeschlossene Auftraege, die aelter sind als die Frist. */
export async function pruneFinishedJobs(keepDays = 30, tx: Tx = db): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000);
  const result = await tx.processingJob.deleteMany({
    where: { status: { in: ['SUCCEEDED', 'CANCELLED'] }, finishedAt: { lt: cutoff } },
  });
  return result.count;
}
