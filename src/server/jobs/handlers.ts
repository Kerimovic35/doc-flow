import type { JobType } from '@/generated/prisma/enums';
import { runDailyMaintenance } from '@/server/pipeline/maintenance';
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
};
