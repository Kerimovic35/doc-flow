import { NextResponse } from 'next/server';
import { db } from '@/server/db';

// Immer frisch auswerten - eine zwischengespeicherte Antwort waere als
// Zustandspruefung wertlos.
export const dynamic = 'force-dynamic';

/**
 * Betriebspruefung fuer Reverse Proxy und Deployment-Skript.
 *
 * Meldet bewusst keine Versions- oder Verbindungsdetails: Der Endpunkt ist
 * ohne Anmeldung erreichbar und soll einem Fremden nichts ueber das System
 * verraten.
 */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok' });
  } catch {
    return NextResponse.json({ status: 'database_unavailable' }, { status: 503 });
  }
}
