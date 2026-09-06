import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/context';
import { isSameOrigin } from '@/server/http/request-origin';
import { checkRateLimit, recordFailedAttempt } from '@/server/auth/rate-limit';
import { ask } from '@/server/services/conversations';

export const dynamic = 'force-dynamic';
// Werkzeugrunden und Nachdenken brauchen Zeit; eine Frage an den gesamten
// Bestand kann eine Minute dauern.
export const maxDuration = 180;

/**
 * Eine Frage an den Assistenten.
 *
 * Route Handler statt Server Action: Die Oberflaeche soll waehrend der
 * Antwort einen Ladezustand zeigen und den Verlauf selbst fortschreiben,
 * ohne die ganze Seite neu zu laden.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  }

  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Ungültige Herkunft.' }, { status: 403 });
  }

  // Jede Frage kostet Geld. Eine Begrenzung schuetzt vor einem versehentlich
  // laufenden Skript ebenso wie vor einem hängenden Formular.
  const limit = checkRateLimit(`ki|${user.id}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Zu viele Fragen in kurzer Zeit. Bitte einen Moment warten.' },
      { status: 429 },
    );
  }

  let body: { question?: unknown; conversationId?: unknown; documentId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Die Anfrage war nicht lesbar.' }, { status: 400 });
  }

  const question = typeof body.question === 'string' ? body.question.slice(0, 2000) : '';
  if (!question.trim()) {
    return NextResponse.json({ error: 'Keine Frage gestellt.' }, { status: 400 });
  }

  const result = await ask(user, {
    question,
    conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
    documentId: typeof body.documentId === 'string' ? body.documentId : null,
  });

  if (!result.ok) {
    // Zaehlt gegen die Begrenzung: Ein dauerhaft scheiternder Aufruf soll
    // sich nicht endlos wiederholen lassen.
    recordFailedAttempt(`ki|${user.id}`);
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    conversationId: result.conversationId,
    message: result.message,
  });
}
