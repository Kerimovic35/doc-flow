import { NextResponse } from 'next/server';
import { MAX_FILE_BYTES } from '@/lib/validation/upload';
import { getCurrentUser } from '@/server/auth/context';
import { isSameOrigin } from '@/server/http/request-origin';
import { addFile, createDocument } from '@/server/services/documents';
import { errorMessage, log } from '@/server/log';

export const dynamic = 'force-dynamic';
// Die Aufbereitung grosser Bilder braucht Zeit; der Standard von Vercel
// spielt hier keine Rolle, aber die Angabe dokumentiert die Erwartung.
export const maxDuration = 120;

/**
 * Dateien entgegennehmen.
 *
 * Route Handler statt Server Action, aus zwei Gruenden: Nur so gibt es eine
 * Fortschrittsanzeige waehrend des Hochladens, und zehn Fotos vom iPhone
 * sprengen jedes vernuenftige Limit fuer Formulardaten.
 *
 * Zwei Betriebsarten:
 *   ohne documentId - legt ein neues Dokument an und nimmt die erste Datei
 *   mit documentId  - haengt eine weitere Datei an
 *
 * Jede Datei wird einzeln gesendet. Wechselt der Benutzer waehrenddessen die
 * App, ist hoechstens die laufende Datei verloren, nicht der ganze Vorgang.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  }

  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Ungültige Herkunft.' }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Die Daten konnten nicht gelesen werden.' }, { status: 400 });
  }

  const file = form.get('datei');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Es wurde keine Datei gesendet.' }, { status: 400 });
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `Die Datei ist zu groß (höchstens ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB).` },
      { status: 413 },
    );
  }

  const existingId = form.get('documentId');
  let documentId = typeof existingId === 'string' && existingId ? existingId : null;

  try {
    if (!documentId) {
      const personId = asString(form.get('personId'));
      const categoryId = asString(form.get('categoryId'));
      const created = await createDocument(user, { personId, categoryId });
      documentId = created.id;
    }

    const content = new Uint8Array(await file.arrayBuffer());
    const result = await addFile(user, documentId, {
      content,
      originalName: file.name || 'unbenannt',
      declaredMimeType: file.type,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error, documentId }, { status: 400 });
    }

    return NextResponse.json({
      documentId,
      fileId: result.fileId,
      mimeType: result.mimeType,
      duplicateOf: result.duplicateOf,
    });
  } catch (error) {
    log.error('upload.failed', { documentId, error: errorMessage(error) });
    return NextResponse.json(
      { error: 'Die Datei konnte nicht gespeichert werden. Bitte erneut versuchen.', documentId },
      { status: 500 },
    );
  }
}

function asString(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value ? value : null;
}
