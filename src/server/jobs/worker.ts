import { randomUUID } from 'node:crypto';
import type { JobType } from '@/generated/prisma/enums';
import { db } from '@/server/db';
import { errorMessage, log } from '@/server/log';
import { claimNextJob, completeJob, failJob } from './queue';
import { PermanentJobError, type ClaimedJob, type JobHandler } from './types';

/**
 * Die Hintergrundschleife.
 *
 * Wichtig: Diese Datei und alles, was sie laedt, darf nichts aus `next/*`
 * importieren. Nur so laesst sich der Worker sowohl im Anwendungsprozess
 * (Produktion) als auch als eigener Prozess (`npm run worker`) starten - und
 * spaeter ohne Umbau in einen eigenen Container ziehen.
 *
 * Nebenlaeufigkeit bewusst eins: Texterkennung und Bildaufbereitung sind
 * rechenintensiv. Zwei gleichzeitige Laeufe auf einem kleinen VPS machen
 * beide langsam, nicht einen schnell.
 */

const IDLE_MIN_MS = 2000;
const IDLE_MAX_MS = 15000;
const HEARTBEAT_KEY = 'worker';

export interface WorkerHandle {
  stop(): Promise<void>;
}

type HandlerMap = Partial<Record<JobType, JobHandler>>;

export function startWorker(handlers: HandlerMap): WorkerHandle {
  const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;
  let running = true;
  let idleMs = IDLE_MIN_MS;
  let currentJob: Promise<void> | null = null;

  log.info('worker.start', { workerId });

  const loop = (async () => {
    while (running) {
      let job: ClaimedJob | null = null;

      try {
        job = await claimNextJob(workerId);
      } catch (error) {
        // Datenbank kurz weg: warten und weitermachen, nicht sterben.
        log.error('worker.claim_failed', { error: errorMessage(error) });
        await sleep(idleMs);
        idleMs = Math.min(idleMs * 2, IDLE_MAX_MS);
        continue;
      }

      if (!job) {
        await sleep(idleMs);
        // Bei Leerlauf immer traeger nachfragen; sobald etwas kam, wieder
        // aufmerksam werden.
        idleMs = Math.min(Math.round(idleMs * 1.5), IDLE_MAX_MS);
        await heartbeat(workerId, 'idle');
        continue;
      }

      idleMs = IDLE_MIN_MS;
      currentJob = runJob(job, handlers);
      await currentJob;
      currentJob = null;
      await heartbeat(workerId, 'busy');
    }
  })();

  return {
    async stop() {
      running = false;
      // Laufenden Auftrag zu Ende bringen, keinen neuen mehr annehmen.
      if (currentJob) await currentJob.catch(() => undefined);
      await loop.catch(() => undefined);
      log.info('worker.stop', { workerId });
    },
  };
}

async function runJob(job: ClaimedJob, handlers: HandlerMap): Promise<void> {
  const handler = handlers[job.type];
  const startedAt = Date.now();

  if (!handler) {
    await failJob(job.id, `Kein Handler fuer ${job.type}`, { permanent: true });
    log.error('worker.no_handler', { jobId: job.id, type: job.type });
    return;
  }

  try {
    await handler(job);
    await completeJob(job.id);
    log.info('job.done', {
      jobId: job.id,
      type: job.type,
      documentId: job.documentId,
      ms: Date.now() - startedAt,
    });
  } catch (error) {
    const permanent = error instanceof PermanentJobError;
    const message = errorMessage(error);
    const outcome = await failJob(job.id, message, { permanent }).catch(() => null);

    // Aufgegeben: Das Dokument traegt den Fehler, damit die Oberflaeche ihn
    // zeigen und einen erneuten Versuch anbieten kann. Die Originale und
    // alles bereits Erkannte bleiben erhalten.
    if (outcome && !outcome.willRetry && job.documentId) {
      await db.document
        .update({
          where: { id: job.documentId },
          data: {
            processingStatus: 'FAILED',
            failedStep: job.type,
            // Die Meldung stammt aus dem eigenen Code, nie aus dem Dokument.
            lastError: message.slice(0, 500),
            processingStep: null,
          },
        })
        .catch(() => undefined);
    }

    log.error('job.failed', {
      jobId: job.id,
      type: job.type,
      documentId: job.documentId,
      attempt: job.attempts,
      permanent,
      willRetry: outcome?.willRetry ?? false,
      // Die Meldung stammt aus dem Code, nicht aus dem Dokument - sie darf
      // ins Protokoll.
      error: message,
    });
  }
}

/**
 * Lebenszeichen. Die Systemseite kann damit zeigen, ob die Verarbeitung
 * ueberhaupt laeuft - ohne das bliebe ein haengender Worker unbemerkt, und
 * Dokumente stuenden ewig auf "wird verarbeitet".
 */
async function heartbeat(workerId: string, state: 'idle' | 'busy'): Promise<void> {
  await db.systemState
    .upsert({
      where: { key: HEARTBEAT_KEY },
      create: { key: HEARTBEAT_KEY, value: { workerId, state, at: new Date().toISOString() } },
      update: { value: { workerId, state, at: new Date().toISOString() } },
    })
    .catch(() => undefined);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Haelt den Prozess nicht am Leben, wenn sonst nichts mehr laeuft.
    timer.unref?.();
  });
}
