/**
 * Einstiegspunkt fuer den Worker als eigener Prozess.
 *
 * In der Entwicklung der Normalfall: `npm run worker` in einem zweiten
 * Terminal. Liefe die Schleife im Entwicklungsserver mit, legte jedes
 * Neuladen bei einer Codeaenderung eine weitere an.
 *
 * In Produktion startet dieselbe Schleife aus instrumentation.ts im
 * Anwendungsprozess. Derselbe Code, zwei Startwege - deshalb darf hier
 * nichts aus next/* hineingeraten.
 */
import 'dotenv/config';
import { startWorker } from '@/server/jobs/worker';
import { HANDLERS } from '@/server/jobs/handlers';
import { startScheduler } from '@/server/jobs/scheduler';
import { log } from '@/server/log';

const worker = startWorker(HANDLERS);
const scheduler = startScheduler();

async function shutdown(signal: string) {
  log.info('worker.signal', { signal });
  scheduler.stop();
  // Laufenden Auftrag zu Ende bringen: Ein mitten in der Texterkennung
  // abgebrochener Lauf haette halbe Ergebnisse hinterlassen.
  await worker.stop();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
