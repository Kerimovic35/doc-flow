import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTestDb, seedBasics, testDb } from '@/test/integration-db';

vi.mock('@/server/db', async () => {
  const { testDb: client } = await import('@/test/integration-db');
  return { db: client };
});

const { enqueue, claimNextJob, completeJob, failJob, pruneFinishedJobs } = await import('./queue');

let userId: string;

beforeEach(async () => {
  await resetTestDb();
  ({ userId } = await seedBasics());
});

async function documentId(): Promise<string> {
  const document = await testDb.document.create({
    data: { userId },
    select: { id: true },
  });
  return document.id;
}

describe('Auftrag einstellen', () => {
  it('legt denselben Auftrag nicht zweimal an', async () => {
    const docId = await documentId();

    const first = await enqueue({ type: 'INGEST', documentId: docId, userId });
    const second = await enqueue({ type: 'INGEST', documentId: docId, userId });

    // Zwei Klicks auf "Erneut verarbeiten" duerfen nicht zwei Laeufe
    // ausloesen - sonst arbeiten zwei Worker am selben Dokument.
    expect(second).toBe(first);
    expect(await testDb.processingJob.count()).toBe(1);
  });

  it('belebt einen gescheiterten Auftrag wieder', async () => {
    const docId = await documentId();
    const jobId = await enqueue({ type: 'OCR', documentId: docId, userId });

    await testDb.processingJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', attempts: 3, lastError: 'kaputt' },
    });

    const again = await enqueue({ type: 'OCR', documentId: docId, userId });

    expect(again).toBe(jobId);
    const job = await testDb.processingJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe('PENDING');
    expect(job.attempts).toBe(0);
    expect(job.lastError).toBeNull();
  });

  it('trennt Auftragsarten am selben Dokument', async () => {
    const docId = await documentId();
    await enqueue({ type: 'INGEST', documentId: docId, userId });
    await enqueue({ type: 'OCR', documentId: docId, userId });

    expect(await testDb.processingJob.count()).toBe(2);
  });
});

describe('Auftrag holen', () => {
  it('gibt denselben Auftrag nicht an zwei Worker', async () => {
    await enqueue({ type: 'DAILY_MAINTENANCE', dedupeKey: 'a' });
    await enqueue({ type: 'DAILY_MAINTENANCE', dedupeKey: 'b' });

    // Gleichzeitig greifen - genau der Fall, den SKIP LOCKED abfangen muss.
    const [first, second] = await Promise.all([
      claimNextJob('worker-1'),
      claimNextJob('worker-2'),
    ]);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.id).not.toBe(second!.id);
  });

  it('gibt nichts heraus, was noch nicht fällig ist', async () => {
    await enqueue({
      type: 'DAILY_MAINTENANCE',
      dedupeKey: 'spaeter',
      runAfter: new Date(Date.now() + 60_000),
    });

    expect(await claimNextJob('worker-1')).toBeNull();
  });

  it('holt einen Auftrag zurück, dessen Pacht abgelaufen ist', async () => {
    const jobId = await enqueue({ type: 'DAILY_MAINTENANCE', dedupeKey: 'verwaist' });
    await claimNextJob('worker-abgestuerzt');

    // Solange die Pacht laeuft, ruehrt ihn niemand an.
    expect(await claimNextJob('worker-2')).toBeNull();

    await testDb.processingJob.update({
      where: { id: jobId },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });

    // Nach Ablauf schon: Ein abgestuerzter Worker darf einen Auftrag nicht
    // fuer immer blockieren.
    const wiederholt = await claimNextJob('worker-2');
    expect(wiederholt?.id).toBe(jobId);
    expect(wiederholt?.attempts).toBe(2);
  });

  it('holt auch einen Auftrag, dessen Fälligkeit die Datenbank gesetzt hat', async () => {
    // Der Fall, der die Warteschlange einmal stillstehen liess: Ein JS-Date
    // als Parameter einer Rohabfrage wird von Prisma um den
    // Zeitzonenversatz verschoben. Verglich man damit gegen einen von der
    // Datenbank gesetzten Zeitpunkt, galt ein gerade eingestellter Auftrag
    // als "noch nicht faellig" - ohne Fehlermeldung, ohne Spur im
    // Protokoll. Deshalb rechnet die Abfrage jetzt mit NOW().
    const jobId = await enqueue({ type: 'DAILY_MAINTENANCE', dedupeKey: 'db-zeit' });
    await testDb.$executeRawUnsafe(
      `UPDATE "processing_jobs" SET "run_after" = NOW() - interval '1 second' WHERE "id" = $1`,
      jobId,
    );

    const job = await claimNextJob('worker-1');
    expect(job?.id).toBe(jobId);
  });

  it('lässt einen von der Datenbank in die Zukunft gesetzten Auftrag liegen', async () => {
    const jobId = await enqueue({ type: 'DAILY_MAINTENANCE', dedupeKey: 'db-zukunft' });
    await testDb.$executeRawUnsafe(
      `UPDATE "processing_jobs" SET "run_after" = NOW() + interval '1 hour' WHERE "id" = $1`,
      jobId,
    );

    expect(await claimNextJob('worker-1')).toBeNull();
  });

  it('zählt die Versuche mit', async () => {
    await enqueue({ type: 'DAILY_MAINTENANCE', dedupeKey: 'zaehlen' });
    const job = await claimNextJob('worker-1');
    expect(job?.attempts).toBe(1);
  });

  it('reicht die Nutzdaten durch', async () => {
    const docId = await documentId();
    await enqueue({
      type: 'ANALYZE',
      documentId: docId,
      userId,
      payload: { reason: 'reanalyze' },
    });

    const job = await claimNextJob('worker-1');
    expect(job?.payload).toEqual({ reason: 'reanalyze' });
    expect(job?.documentId).toBe(docId);
  });
});

describe('Fehlschlag', () => {
  it('plant einen erneuten Versuch mit wachsendem Abstand', async () => {
    await enqueue({ type: 'DAILY_MAINTENANCE', dedupeKey: 'retry' });
    const job = await claimNextJob('worker-1');

    const outcome = await failJob(job!.id, 'Netz weg');

    expect(outcome.willRetry).toBe(true);
    expect(outcome.nextRunAt!.getTime()).toBeGreaterThan(Date.now() + 20_000);

    const row = await testDb.processingJob.findUniqueOrThrow({ where: { id: job!.id } });
    expect(row.status).toBe('PENDING');
    expect(row.lockedUntil).toBeNull();
  });

  it('gibt nach der letzten Wiederholung auf', async () => {
    await enqueue({ type: 'DAILY_MAINTENANCE', dedupeKey: 'aufgeben', maxAttempts: 2 });

    const first = await claimNextJob('worker-1');
    await failJob(first!.id, 'einmal');
    await testDb.processingJob.update({
      where: { id: first!.id },
      data: { runAfter: new Date() },
    });

    const second = await claimNextJob('worker-1');
    const outcome = await failJob(second!.id, 'zweimal');

    expect(outcome.willRetry).toBe(false);
    const row = await testDb.processingJob.findUniqueOrThrow({ where: { id: first!.id } });
    expect(row.status).toBe('FAILED');
    expect(row.lastError).toBe('zweimal');
  });

  it('wiederholt einen dauerhaften Fehler gar nicht', async () => {
    await enqueue({ type: 'INGEST', documentId: await documentId(), userId });
    const job = await claimNextJob('worker-1');

    // Ein verschluesseltes PDF wird beim dritten Versuch nicht lesbarer.
    const outcome = await failJob(job!.id, 'PDF ist verschluesselt', { permanent: true });

    expect(outcome.willRetry).toBe(false);
    const row = await testDb.processingJob.findUniqueOrThrow({ where: { id: job!.id } });
    expect(row.status).toBe('FAILED');
  });
});

describe('Aufräumen', () => {
  it('löscht nur alte, erledigte Aufträge', async () => {
    const alt = await enqueue({ type: 'DAILY_MAINTENANCE', dedupeKey: 'alt' });
    const neu = await enqueue({ type: 'DAILY_MAINTENANCE', dedupeKey: 'neu' });
    const offen = await enqueue({ type: 'DAILY_MAINTENANCE', dedupeKey: 'offen' });

    await completeJob(alt);
    await completeJob(neu);
    await testDb.processingJob.update({
      where: { id: alt },
      data: { finishedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
    });

    const deleted = await pruneFinishedJobs(30);

    expect(deleted).toBe(1);
    expect(await testDb.processingJob.findUnique({ where: { id: alt } })).toBeNull();
    expect(await testDb.processingJob.findUnique({ where: { id: neu } })).not.toBeNull();
    expect(await testDb.processingJob.findUnique({ where: { id: offen } })).not.toBeNull();
  });
});
