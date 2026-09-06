import { db } from '@/server/db';
import { log } from '@/server/log';
import { pruneFinishedJobs } from '@/server/jobs/queue';

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

  log.info('maintenance.done', {
    sessionsDeleted: sessions.count,
    jobsDeleted: jobs,
  });
}
