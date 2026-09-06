import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/context';
import { openPageImage } from '@/server/services/documents';

export const dynamic = 'force-dynamic';

/**
 * Liefert ein Seitenbild aus - in voller Anzeigegroesse oder als Vorschau.
 *
 * Diese Bilder sind Ableitungen: Sie aendern sich nur, wenn das Dokument neu
 * verarbeitet wird, und tragen dann eine neue Seiten-ID. Deshalb darf der
 * Browser sie lange behalten, solange er sie nicht weitergibt.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse(null, { status: 404 });

  const { id, pageId } = await params;
  const variant = new URL(request.url).searchParams.get('vorschau') === '1' ? 'thumb' : 'display';

  const image = await openPageImage(user, id, pageId, variant);
  if (!image) return new NextResponse(null, { status: 404 });

  return new NextResponse(Readable.toWeb(image.stream as Readable) as ReadableStream, {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
