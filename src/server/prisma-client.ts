import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

/**
 * Die Fabrik fuer Datenbank-Clients.
 *
 * Bewusst ein eigenes Modul und nicht Teil von `@/server/db`: Die
 * Integrationstests ersetzen `@/server/db` durch ihre Testverbindung, und
 * ihre Testhilfe braucht genau diese Fabrik. Laege sie in `db.ts`, entstuende
 * ein Kreis - die Ersetzung laedt die Testhilfe, die Testhilfe laedt die
 * Ersetzung -, und der Testlauf bliebe wortlos haengen.
 *
 * Der Zeitzonenschalter ist der eigentliche Grund, warum es die Fabrik
 * ueberhaupt gibt (siehe unten).
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({
    /*
     * Die Sitzungszeitzone steht fest auf UTC.
     *
     * Der Treiber behandelt Zeitstempel sonst als ortszeitlich. Laeuft die
     * Sitzung unter Europe/Berlin - und genau das empfiehlt das README fuer
     * den Container -, liegen von Prisma geschriebene Werte und die
     * Datenbankuhr NOW() zwei Stunden auseinander. Ueber Prisma allein faellt
     * das nie auf, weil sich der Versatz beim Zurueckelesen aufhebt; in jeder
     * Rohabfrage dagegen schon. Genau daran stand die Auftragswarteschlange
     * einmal still, ohne eine Zeile im Protokoll.
     */
    adapter: new PrismaPg({ connectionString, options: '-c timezone=UTC' }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}
