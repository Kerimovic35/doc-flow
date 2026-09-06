import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/context';
import { isSameOrigin } from '@/server/http/request-origin';
import { finishUpload } from '@/server/services/documents';

export const dynamic = 'force-dynamic';

/** Beendet das Erfassen und stellt den Verarbeitungsauftrag ein. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Ungültige Herkunft.' }, { status: 403 });
  }

  const { id } = await params;
  const result = await finishUpload(user, id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, documentId: id });
}
