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

/**
 * Haelt den Prozess am Leben.
 *
 * Die Zeitgeber der Warteschleife sind bewusst `unref` - sonst haengte ein
 * Test nach dem Anhalten des Workers noch bis zum naechsten Weckruf. Ohne
 * einen einzigen Zeitgeber mit Referenz haette Node hier aber nichts mehr zu
 * tun und beendete sich sofort nach dem Start. In der Anwendung haelt der
 * Webserver den Prozess; als eigenstaendiger Prozess muss es diese Zeile
 * tun.
 */
const keepAlive = setInterval(() => {}, 60_000);

async function shutdown(signal: string) {
  log.info('worker.signal', { signal });
  scheduler.stop();
  clearInterval(keepAlive);
  // Laufenden Auftrag zu Ende bringen: Ein mitten in der Texterkennung
  // abgebrochener Lauf haette halbe Ergebnisse hinterlassen.
  await worker.stop();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
