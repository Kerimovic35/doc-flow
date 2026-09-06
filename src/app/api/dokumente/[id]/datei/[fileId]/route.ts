import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/context';
import { openOriginal } from '@/server/services/documents';

export const dynamic = 'force-dynamic';

/**
 * Liefert die Originaldatei aus.
 *
 * Immer erst anmelden, dann ausliefern - Speicherpfade sind von aussen nicht
 * erreichbar. Wer nicht darf, bekommt 404 statt 403: Ein 403 wuerde
 * bestaetigen, dass es die Datei gibt.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse(null, { status: 404 });

  const { id, fileId } = await params;
  const file = await openOriginal(user, id, fileId);
  if (!file) return new NextResponse(null, { status: 404 });

  const url = new URL(request.url);
  // Standard ist die Anzeige im Browser; zum Speichern reicht ?download=1.
  const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';

  return new NextResponse(Readable.toWeb(file.stream as Readable) as ReadableStream, {
    headers: {
      // Der gespeicherte Typ stammt aus der Signaturpruefung beim Hochladen,
      // nicht aus der Angabe des Browsers.
      'Content-Type': file.mimeType,
      'Content-Length': String(file.sizeBytes),
      'Content-Disposition': `${disposition}; filename="${safeFilename(file.originalName)}"`,
      // Privat: Ein zwischengeschalteter Proxy darf das nicht behalten.
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/**
 * Entfernt aus dem Anzeigenamen alles, was den Header zerlegen koennte.
 * Der Name stammt vom Benutzer und ist damit nicht vertrauenswuerdig.
 */
function safeFilename(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').slice(0, 100) || 'dokument';
}
