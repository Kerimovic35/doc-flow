import type { LoginInput } from '@/lib/validation/auth';
import { db } from '@/server/db';
import { log } from '@/server/log';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import {
  createSession,
  destroyAllSessions,
  destroySession,
  pruneExpiredSessions,
  type SessionUser,
} from '@/server/auth/session';
import { checkRateLimit, clearAttempts, recordFailedAttempt } from '@/server/auth/rate-limit';

/**
 * Vergleichshash fuer nicht existierende Benutzer.
 *
 * Ohne ihn waere eine unbekannte E-Mail-Adresse messbar schneller abgelehnt
 * als ein falsches Passwort - daraus liesse sich ableiten, welche Adressen
 * im System existieren. Der Hash wird beim ersten Bedarf einmalig erzeugt.
 */
let dummyHash: string | null = null;
async function getDummyHash(): Promise<string> {
  dummyHash ??= await hashPassword('nicht-vergebenes-passwort');
  return dummyHash;
}

export type LoginResult =
  | { ok: true; user: SessionUser; token: string; expiresAt: Date }
  | { ok: false; error: string };

export async function login(
  input: LoginInput,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<LoginResult> {
  // Nach E-Mail *und* Herkunft begrenzen: Sonst koennte ein einzelner
  // Angreifer durch Raten fremder Adressen echte Benutzer aussperren.
  const rateKey = `${input.email}|${meta.ip ?? 'unbekannt'}`;

  const limit = checkRateLimit(rateKey);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    return {
      ok: false,
      error: `Zu viele Fehlversuche. Bitte in ${minutes} Minute(n) erneut versuchen.`,
    };
  }

  const user = await db.user.findUnique({
    where: { email: input.email },
    select: { id: true, email: true, name: true, role: true, active: true, passwordHash: true },
  });

  const passwordOk = await verifyPassword(
    user?.passwordHash ?? (await getDummyHash()),
    input.password,
  );

  // Eine einzige, unspezifische Fehlermeldung fuer alle Faelle: unbekannte
  // Adresse, falsches Passwort und deaktiviertes Konto duerfen von aussen
  // nicht unterscheidbar sein.
  if (!user || !user.active || !passwordOk) {
    recordFailedAttempt(rateKey);
    log.warn('login.failed', { ip: meta.ip ?? null });
    return { ok: false, error: 'E-Mail-Adresse oder Passwort ist falsch.' };
  }

  clearAttempts(rateKey);

  // Aufraeumen bei Gelegenheit - erspart einen eigenen Hintergrunddienst.
  await pruneExpiredSessions().catch(() => undefined);

  const { token, expiresAt } = await createSession(user.id, meta);
  log.info('login.ok', { userId: user.id });

  return {
    ok: true,
    token,
    expiresAt,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  };
}

export async function logout(token: string): Promise<void> {
  await destroySession(token);
}

export type ChangePasswordResult = { ok: true } | { ok: false; error: string };

/**
 * Aendert das Passwort und beendet dabei alle Sitzungen des Benutzers.
 *
 * Das Abmelden aller Geraete ist der eigentliche Zweck einer Passwortaenderung
 * nach einem Verdachtsfall - bliebe eine fremde Sitzung bestehen, waere die
 * Aenderung wirkungslos.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });

  if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
    return { ok: false, error: 'Das aktuelle Passwort ist falsch.' };
  }

  const passwordHash = await hashPassword(newPassword);

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await destroyAllSessions(userId, tx);
  });

  log.info('password.changed', { userId });
  return { ok: true };
}
