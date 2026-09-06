import type { JobType } from '@/generated/prisma/enums';
import { runDailyMaintenance } from '@/server/pipeline/maintenance';
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
