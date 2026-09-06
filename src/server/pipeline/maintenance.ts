import { db } from '@/server/db';
import { log } from '@/server/log';
import { enqueue, pruneFinishedJobs } from '@/server/jobs/queue';

/**
 * Taegliche Aufraeumarbeiten.
 *
 * Laeuft als gewoehnlicher Auftrag in derselben Warteschlange wie alles
 * andere - ein eigener Zeitgeber waere ein zweiter Mechanismus mit eigenem
 * Protokoll und eigenen Fehlern.
 */
export async function runDailyMaintenance(): Promise<void> {
  const sessions = await db.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  const jobs = await pruneFinishedJobs(30);

  // Das Backup als eigener Auftrag: Scheitert es, bleibt die Wartung selbst
  // erledigt - und der gescheiterte Backup-Auftrag ist auf der Systemseite
  // sichtbar, statt in einem Sammelfehler unterzugehen.
  if (process.env.BACKUP_ENABLED !== 'false') {
    await enqueue({ type: 'BACKUP', dedupeKey: new Date().toISOString().slice(0, 10) });
  }

  log.info('maintenance.done', {
    sessionsDeleted: sessions.count,
    jobsDeleted: jobs,
  });
}
