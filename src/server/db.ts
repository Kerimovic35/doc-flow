import type { PrismaClient } from '@/generated/prisma/client';
import { createPrismaClient } from './prisma-client';

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
  // Plattformabhaengiges im Deployment. Die verbindlichen Einstellungen -
  // allen voran die Zeitzone - stehen in prisma-client.ts.
  return createPrismaClient(url);
}

export { createPrismaClient };

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
