import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/context';
import { hasRole } from '@/server/auth/guard';
import { openBackup } from '@/server/services/backup';

export const dynamic = 'force-dynamic';

/**
 * Ausliefern eines Abzugs.
 *
 * Ein Backup enthaelt saemtliche Dokumente im Klartext. Ohne Systemzugang
 * gibt es hier nichts - und zwar als 404, nicht als 403: Ein 403 wuerde
 * bestaetigen, dass die Datei existiert.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user, 'ADMIN')) {
    return new NextResponse(null, { status: 404 });
  }

  const { name } = await params;
  const result = await openBackup(user, name);
  if (!result.ok) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(Readable.toWeb(result.stream as Readable) as ReadableStream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(result.sizeBytes),
      // Der Name stammt aus einem festen Muster, nicht aus einer Eingabe.
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
