import { dayKey, millisecondsUntilNextRun } from '@/lib/schedule-time';
import { db } from '@/server/db';
import { errorMessage, log } from '@/server/log';
import { enqueue } from './queue';

/**
 * Stellt die taeglichen Auftraege ein.
 *
 * Kein Cron-Paket: Die Schleife rechnet aus, wie lange es bis zum naechsten
 * Termin ist, und legt sich so lange schlafen. Der Eindeutigkeitsschluessel
 * ist das Datum - laeuft die Anwendung an einem Tag mehrfach an, entsteht
 * trotzdem nur ein Auftrag.
 *
 * Die Zeitrechnung steht in @/lib/schedule-time und ist dort ohne Datenbank
 * testbar.
 */

export interface SchedulerHandle {
  stop(): void;
}

export function startScheduler(): SchedulerHandle {
  const hour = clamp(Number(process.env.MAINTENANCE_HOUR ?? '3'), 0, 23, 3);
  const minute = clamp(Number(process.env.MAINTENANCE_MINUTE ?? '30'), 0, 59, 30);

  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    const delay = millisecondsUntilNextRun(new Date(), hour, minute);

    timer = setTimeout(async () => {
      try {
        const now = new Date();
        await enqueue({ type: 'DAILY_MAINTENANCE', dedupeKey: dayKey(now) });
        await db.systemState
          .upsert({
            where: { key: 'maintenance' },
            create: { key: 'maintenance', value: { lastEnqueuedAt: now.toISOString() } },
            update: { value: { lastEnqueuedAt: now.toISOString() } },
          })
          .catch(() => undefined);
      } catch (error) {
        log.error('scheduler.enqueue_failed', { error: errorMessage(error) });
      }
      schedule();
    }, delay);

    // Der Zeitgeber soll den Prozess nicht am Beenden hindern.
    timer.unref?.();
  };

  schedule();
  log.info('scheduler.start', { hour, minute });

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
