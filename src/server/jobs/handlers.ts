import type { JobType } from '@/generated/prisma/enums';
import { runIngest } from '@/server/pipeline/ingest';
import { runDailyMaintenance } from '@/server/pipeline/maintenance';
import { runOcr } from '@/server/pipeline/ocr';
import { recordBackupRun, runScheduledBackup } from '@/server/services/backup';
import type { JobHandler } from './types';

/**
 * Zuordnung Auftragsart -> Bearbeitung.
 *
 * An einer Stelle gebuendelt, damit der Worker selbst nichts ueber die
 * Fachlichkeit wissen muss. Die Schritte der Dokumentverarbeitung kommen in
 * den folgenden Ausbaustufen dazu.
 */
export const HANDLERS: Partial<Record<JobType, JobHandler>> = {
  INGEST: async (job) => {
    if (!job.documentId) throw new Error('INGEST ohne Dokument');
    await runIngest(job.documentId);
  },

  OCR: async (job) => {
    if (!job.documentId) throw new Error('OCR ohne Dokument');
    await runOcr(job.documentId);
  },

  DAILY_MAINTENANCE: async () => {
    await runDailyMaintenance();
  },

  BACKUP: async () => {
    const result = await runScheduledBackup();
    if (!result.ok) {
      // Wirft, damit der Auftrag als gescheitert gilt und die Systemseite es
      // zeigt. Ein stillschweigend ausgefallenes Backup ist der gefaehrlichste
      // Zustand ueberhaupt.
      throw new Error(result.error);
    }
    await recordBackupRun(result.names);
  },
};
