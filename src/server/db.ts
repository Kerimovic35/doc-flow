import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

/**
 * Prisma-Client als Singleton.
 *
 * Im Entwicklungsmodus laedt Next.js Module bei jeder Aenderung neu. Ohne
 * Zwischenspeicher am globalen Objekt entstuende dabei pro Neuladen ein
 * weiterer Verbindungspool, bis PostgreSQL keine Verbindungen mehr annimmt.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL ist nicht gesetzt. Lege eine .env nach dem Vorbild von .env.example an.',
    );
  }

  // Prisma 7 verbindet ueber einen Treiber-Adapter statt ueber eine native
  // Engine-Binary. Fuer den VPS bedeutet das: reines JavaScript, nichts
  // Plattformabhaengiges im Deployment.
  //
  // Die Sitzungszeitzone steht fest auf UTC. Der Grund ist eine Falle, die
  // einmal die ganze Warteschlange stillstehen liess: Der Treiber behandelt
  // Zeitstempel als ortszeitlich. Laeuft die Sitzung unter Europe/Berlin -
  // und genau das empfiehlt das README fuer den Container -, liegen von
  // Prisma geschriebene Werte und die Datenbankuhr NOW() zwei Stunden
  // auseinander. Ueber Prisma allein faellt das nie auf, weil sich der
  // Versatz beim Zurueckelesen aufhebt; in jeder Rohabfrage dagegen schon.
  // Mit UTC ist der Versatz null, und beide Wege stimmen ueberein.
  const adapter = new PrismaPg({ connectionString: url, options: '-c timezone=UTC' });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const db: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}

/**
 * Transaktionskontext: derselbe Typ wie `db`, aber auf den Ausschnitt
 * beschraenkt, den `db.$transaction` an den Rueckruf uebergibt.
 *
 * Alle Service-Funktionen nehmen diesen Typ entgegen. Dadurch koennen sie
 * sowohl eigenstaendig als auch als Teil einer groesseren Transaktion
 * aufgerufen werden - entscheidend dafuer, dass eine Analyse mit allen
 * Feldern, Aufgaben und Zahlungen atomar geschrieben wird.
 */
export type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;
