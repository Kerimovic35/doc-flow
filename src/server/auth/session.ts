import { createHash, randomBytes } from 'node:crypto';
import type { UserRole } from '@/generated/prisma/enums';
import { db, type Tx } from '@/server/db';

export const SESSION_COOKIE = 'docflow_session';

/** Angemeldeter Benutzer, wie ihn die Geschaeftslogik benoetigt. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

function sessionTtlMs(): number {
  const days = Number(process.env.SESSION_TTL_DAYS ?? '30');
  const safeDays = Number.isFinite(days) && days > 0 ? days : 30;
  return safeDays * 24 * 60 * 60 * 1000;
}

/**
 * Bildet den Sitzungstoken auf seinen Speicherwert ab.
 *
 * Bewusst SHA-256 und nicht Argon2: Der Token besteht aus 256 zufaelligen
 * Bits, ist also nicht erratbar - ein absichtlich langsames Verfahren wuerde
 * hier nur jeden einzelnen Seitenaufruf verlangsamen, ohne etwas zu schuetzen.
 *
 * Der zusaetzliche Serverschluessel ("Pepper") sorgt dafuer, dass allein aus
 * der Datenbank keine gueltigen Tokens abgeleitet werden koennen.
 */
function hashToken(token: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET fehlt oder ist zu kurz (mindestens 32 Zeichen). Siehe .env.example.',
    );
  }
  return createHash('sha256').update(`${token}.${secret}`).digest('hex');
}

/**
 * Erzeugt eine neue Sitzung und liefert den Klartext-Token zurueck.
 *
 * Der Klartext existiert ausschliesslich hier und im Cookie des Benutzers -
 * gespeichert wird nur sein Hash. Ein Datenbankleck gibt damit keine
 * uebernehmbaren Sitzungen preis.
 */
export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
  tx: Tx = db,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionTtlMs());

  await tx.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    },
  });

  return { token, expiresAt };
}

/**
 * Prueft einen Token und liefert den zugehoerigen Benutzer.
 *
 * Liefert `null`, sobald irgendetwas nicht stimmt: unbekannter Token,
 * abgelaufene Sitzung oder deaktivierter Benutzer. Die Pruefung auf `active`
 * ist entscheidend - ein gesperrter Benutzer muss sofort ausgesperrt sein,
 * nicht erst nach Ablauf seiner Sitzung.
 */
export async function validateSession(token: string): Promise<SessionUser | null> {
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      lastSeenAt: true,
      user: { select: { id: true, email: true, name: true, role: true, active: true } },
    },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    // Abgelaufene Sitzung gleich entfernen, statt sie liegen zu lassen.
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  if (!session.user.active) return null;

  // "Zuletzt gesehen" hoechstens alle 15 Minuten fortschreiben - sonst
  // entstuende bei jedem Seitenaufruf ein Schreibvorgang.
  const FIFTEEN_MINUTES = 15 * 60 * 1000;
  if (Date.now() - session.lastSeenAt.getTime() > FIFTEEN_MINUTES) {
    await db.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  const { id, email, name, role } = session.user;
  return { id, email, name, role };
}

/** Beendet genau eine Sitzung (Abmeldung). */
export async function destroySession(token: string): Promise<void> {
  if (!token) return;
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/** Beendet alle Sitzungen eines Benutzers - etwa nach einer Passwortaenderung. */
export async function destroyAllSessions(userId: string, tx: Tx = db): Promise<void> {
  await tx.session.deleteMany({ where: { userId } });
}

/**
 * Raeumt abgelaufene Sitzungen ab. Wird beim Anmelden mitgenommen, damit
 * kein eigener Hintergrunddienst noetig ist.
 */
export async function pruneExpiredSessions(tx: Tx = db): Promise<void> {
  await tx.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
}
