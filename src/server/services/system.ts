import type { SessionUser } from '@/server/auth/session';
import { assertRole } from '@/server/auth/guard';
import { db } from '@/server/db';
import { listBackups, type BackupFile } from '@/server/services/backup';

/**
 * Zustand der Anwendung fuer die Systemseite.
 *
 * Die Rollenpruefung steht hier, nicht in der Seite: Ein selbst gebauter
 * Aufruf erreicht den Dienst auf demselben Weg wie die Oberflaeche.
 */
export interface SystemStatus {
  workerLabel: string;
  pendingJobs: number;
  runningJobs: number;
  failedJobs: number;
  documents: number;
  pages: number;
  backups: BackupFile[];
  backupsEncrypted: boolean;
}

/** Ohne Lebenszeichen seit dieser Spanne gilt der Worker als haengend. */
const WORKER_STALE_MS = 5 * 60 * 1000;

export async function getSystemStatus(actor: SessionUser): Promise<SystemStatus> {
  assertRole(actor, 'ADMIN');

  const [worker, pendingJobs, runningJobs, failedJobs, documents, pages, backups] =
    await Promise.all([
      db.systemState.findUnique({ where: { key: 'worker' } }),
      db.processingJob.count({ where: { status: 'PENDING' } }),
      db.processingJob.count({ where: { status: 'RUNNING' } }),
      db.processingJob.count({ where: { status: 'FAILED' } }),
      db.document.count({ where: { userId: actor.id, deletedAt: null } }),
      db.documentPage.count({ where: { userId: actor.id } }),
      listBackups(actor).catch(() => [] as BackupFile[]),
    ]);

  return {
    workerLabel: describeWorker((worker?.value as { at?: string } | null)?.at),
    pendingJobs,
    runningJobs,
    failedJobs,
    documents,
    pages,
    backups,
    backupsEncrypted: Boolean(process.env.BACKUP_AGE_RECIPIENT),
  };
}

function describeWorker(at: string | undefined): string {
  if (!at) return 'kein Lebenszeichen';

  const age = Date.now() - new Date(at).getTime();
  if (Number.isNaN(age)) return 'kein Lebenszeichen';
  if (age < WORKER_STALE_MS) return 'läuft';

  const minutes = Math.round(age / 60000);
  return `seit ${minutes} Minute(n) still`;
}
