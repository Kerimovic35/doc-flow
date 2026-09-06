import { NextResponse } from 'next/server';
import { db } from '@/server/db';

// Immer frisch auswerten - eine zwischengespeicherte Antwort waere als
// Zustandspruefung wertlos.
export const dynamic = 'force-dynamic';

/** Ohne Lebenszeichen seit dieser Spanne gilt der Worker als haengend. */
const WORKER_STALE_MS = 5 * 60 * 1000;

/**
 * Betriebspruefung fuer Reverse Proxy und Deployment.
 *
 * Meldet bewusst keine Versions- oder Verbindungsdetails: Der Endpunkt ist
 * ohne Anmeldung erreichbar und soll einem Fremden nichts ueber das System
 * verraten.
 *
 * Der Zustand des Workers steht nur zur Information darin und fuehrt NICHT zu
 * 503. Sonst startete Coolify den Container mitten in einer laenger
 * laufenden Texterkennung neu - und genau die soll ungestoert zu Ende gehen.
 */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json({ status: 'database_unavailable' }, { status: 503 });
  }

  let worker: 'ok' | 'stale' | 'unknown' = 'unknown';
  try {
    const state = await db.systemState.findUnique({ where: { key: 'worker' } });
    const at = (state?.value as { at?: string } | null)?.at;
    if (at) {
      worker = Date.now() - new Date(at).getTime() < WORKER_STALE_MS ? 'ok' : 'stale';
    }
  } catch {
    worker = 'unknown';
  }

  return NextResponse.json({ status: 'ok', worker });
}
