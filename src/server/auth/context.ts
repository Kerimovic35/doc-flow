import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { UserRole } from '@/generated/prisma/enums';
import { SESSION_COOKIE, validateSession, type SessionUser } from './session';
import { assertRole } from './guard';

export { ForbiddenError } from './guard';

/** Liest den angemeldeten Benutzer aus dem Sitzungs-Cookie. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSession(token);
}

/**
 * Verlangt einen angemeldeten Benutzer.
 *
 * Diese Pruefung steht am Anfang jeder Server Action und jedes geschuetzten
 * Datenzugriffs - nicht in der Oberflaeche. Ein nachgebauter Request kann sie
 * dadurch nicht umgehen.
 *
 * Bei fehlender Sitzung wird weitergeleitet statt eine Ausnahme zu werfen.
 * Grund: Next.js rendert Layout und Seite nebenlaeufig. Eine Ausnahme in der
 * Seite landet dann in der Fehlergrenze, bevor die Weiterleitung des Layouts
 * greift - der Benutzer saehe eine Fehlermeldung statt der Anmeldung. Aus
 * einer Server Action heraus fuehrt die Weiterleitung den Browser ebenfalls
 * zur Anmeldung, was nach einem Sitzungsablauf genau das Richtige ist.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/**
 * Verlangt eine bestimmte Rolle.
 *
 * Duenne Huelle um `assertRole` - die eigentliche Regel steht in `guard.ts`
 * und ist dort ohne laufenden Server testbar.
 */
export async function requireRole(role: UserRole): Promise<SessionUser> {
  const user = await requireUser();
  assertRole(user, role);
  return user;
}

/** Setzt das Sitzungs-Cookie nach erfolgreicher Anmeldung. */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    // Kein Zugriff aus JavaScript - schuetzt den Token bei einer XSS-Luecke.
    httpOnly: true,
    // Nur ueber HTTPS. In der Entwicklung laeuft die App ueber http://localhost,
    // dort wuerde das Flag die Anmeldung unmoeglich machen.
    secure: process.env.NODE_ENV === 'production',
    // 'lax' laesst normale Navigation zu, unterbindet aber das Mitsenden bei
    // fremd ausgeloesten POST-Anfragen - der wesentliche CSRF-Schutz.
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
