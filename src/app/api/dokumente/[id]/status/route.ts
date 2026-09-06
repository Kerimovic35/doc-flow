import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/context';
import { getProcessingStatus } from '@/server/services/documents';

export const dynamic = 'force-dynamic';

/**
 * Verarbeitungsstand eines Dokuments.
 *
 * Die Detailseite fragt im Sekundentakt nach, solange die Kette laeuft. Ein
 * dauerhaft offener Kanal waere hier unverhaeltnismaessig: Es geht um wenige
 * Minuten je Dokument, und ein Abbruch der Verbindung darf nichts kosten.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse(null, { status: 404 });

  const { id } = await params;
  const status = await getProcessingStatus(user, id);
  if (!status) return new NextResponse(null, { status: 404 });

  return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } });
}
