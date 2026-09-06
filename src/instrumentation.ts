/**
 * Wird von Next.js einmalig beim Serverstart ausgefuehrt.
 *
 * Der einzige Ort, an dem sich in einer Next-Anwendung zuverlaessig
 * Hintergrundarbeit starten laesst - eine Seite oder Route waere dafuer
 * ungeeignet, weil sie erst beim ersten Aufruf ausgefuehrt wuerde.
 */
export async function register() {
  // Next fuehrt diese Datei auch fuer die Edge-Laufzeit aus. Dort gibt es
  // weder Kindprozesse noch Dateisystem - beides wird gebraucht.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const isProduction = process.env.NODE_ENV === 'production';

  // Erstinitialisierung nur in Produktion. Lokal entstehen die Startdaten
  // ueber `npm run db:seed`.
  if (isProduction) {
    try {
      const { bootstrap } = await import('./server/bootstrap');
      const result = await bootstrap();

      if (result.userCreated) {
        console.log('[bootstrap] Erstzugang angelegt — Passwort nach der Anmeldung ändern');
      }
      if (result.categoriesCreated || result.personsCreated) {
        console.log(
          `[bootstrap] ${result.categoriesCreated} Kategorie(n), ${result.personsCreated} Person(en) angelegt`,
        );
      }
      if (result.note) {
        console.log(`[bootstrap] ${result.note}`);
      }
    } catch (error) {
      // Ein Fehler hier darf den Server nicht am Starten hindern - sonst
      // waere die Anwendung wegen der Startdaten unerreichbar.
      console.error('[bootstrap] fehlgeschlagen:', error);
    }
  }

  // In der Entwicklung laeuft der Worker als eigener Prozess (npm run
  // worker). Ohne diese Bremse legte jedes Neuladen des Entwicklungsservers
  // eine weitere Schleife an.
  const workerWanted = isProduction || process.env.WORKER_ENABLED === 'true';
  if (!workerWanted) return;

  const { startWorker } = await import('./server/jobs/worker');
  const { HANDLERS } = await import('./server/jobs/handlers');
  const { startScheduler } = await import('./server/jobs/scheduler');

  const worker = startWorker(HANDLERS);
  const scheduler = startScheduler();

  const shutdown = () => {
    scheduler.stop();
    void worker.stop();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
