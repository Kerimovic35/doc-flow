import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTestDb, testDb } from '@/test/integration-db';

vi.mock('@/server/db', async () => {
  const { testDb: client } = await import('@/test/integration-db');
  return { db: client };
});

// Nach dem Mock laden, sonst zoege der statische Import die echte Verbindung.
const { login, changePassword } = await import('./auth');
const { hashPassword, verifyPassword } = await import('@/server/auth/password');
const { createSession, validateSession } = await import('@/server/auth/session');
const { resetRateLimitState } = await import('@/server/auth/rate-limit');

let userId: string;

const EMAIL = 'chef@test.local';
const ALT = 'altes-passwort-1234';
const NEU = 'neues-passwort-5678';

beforeEach(async () => {
  await resetTestDb();
  resetRateLimitState();
  process.env.SESSION_SECRET = 'test-secret-mit-mindestens-32-zeichen-laenge';

  const user = await testDb.user.create({
    data: {
      email: EMAIL,
      name: 'Chef',
      passwordHash: await hashPassword(ALT),
      role: 'ADMIN',
    },
    select: { id: true },
  });
  userId = user.id;
});

describe('Anmeldung', () => {
  it('meldet mit richtigem Passwort an und liefert eine gültige Sitzung', async () => {
    const result = await login({ email: EMAIL, password: ALT });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.user.id).toBe(userId);
    expect(await validateSession(result.token)).not.toBeNull();
  });

  it('lehnt ein falsches Passwort ab, ohne eine Sitzung anzulegen', async () => {
    const result = await login({ email: EMAIL, password: 'falsch' });

    expect(result.ok).toBe(false);
    expect(await testDb.session.count()).toBe(0);
  });

  it('gibt bei unbekannter Adresse dieselbe Meldung wie bei falschem Passwort', async () => {
    // Sonst liesse sich von aussen herausfinden, welche Adressen es gibt.
    const unbekannt = await login({ email: 'niemand@test.local', password: ALT });
    const falsch = await login({ email: EMAIL, password: 'falsch' });

    expect(unbekannt.ok).toBe(false);
    expect(falsch.ok).toBe(false);
    if (unbekannt.ok || falsch.ok) return;
    expect(unbekannt.error).toBe(falsch.error);
  });

  it('sperrt ein deaktiviertes Konto aus', async () => {
    await testDb.user.update({ where: { id: userId }, data: { active: false } });

    const result = await login({ email: EMAIL, password: ALT });
    expect(result.ok).toBe(false);
  });

  it('bremst nach fünf Fehlversuchen', async () => {
    for (let versuch = 0; versuch < 5; versuch += 1) {
      await login({ email: EMAIL, password: 'falsch' }, { ip: '10.0.0.1' });
    }

    // Auch das richtige Passwort kommt jetzt nicht mehr durch - genau das
    // macht das Durchprobieren unwirtschaftlich.
    const result = await login({ email: EMAIL, password: ALT }, { ip: '10.0.0.1' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Fehlversuche/);
  });

  it('räumt abgelaufene Sitzungen beim Anmelden ab', async () => {
    await testDb.session.create({
      data: {
        userId,
        tokenHash: 'abgelaufen',
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    await login({ email: EMAIL, password: ALT });

    const alte = await testDb.session.findFirst({ where: { tokenHash: 'abgelaufen' } });
    expect(alte).toBeNull();
  });
});

describe('Sitzungen', () => {
  it('erkennt eine abgelaufene Sitzung nicht an', async () => {
    const { token } = await createSession(userId, {});
    await testDb.session.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await validateSession(token)).toBeNull();
  });

  it('speichert niemals den Klartext des Tokens', async () => {
    const { token } = await createSession(userId, {});

    const sitzung = await testDb.session.findFirstOrThrow({ where: { userId } });
    expect(sitzung.tokenHash).not.toBe(token);
    expect(sitzung.tokenHash).not.toContain(token);
  });
});

describe('Passwort ändern', () => {
  it('setzt das neue Passwort', async () => {
    const result = await changePassword(userId, ALT, NEU);
    expect(result.ok).toBe(true);

    const user = await testDb.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await verifyPassword(user.passwordHash, NEU)).toBe(true);
    expect(await verifyPassword(user.passwordHash, ALT)).toBe(false);
  });

  it('lehnt ein falsches aktuelles Passwort ab', async () => {
    const result = await changePassword(userId, 'falsch', NEU);

    expect(result.ok).toBe(false);
    // Nichts geaendert - das alte Passwort gilt weiter.
    const user = await testDb.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await verifyPassword(user.passwordHash, ALT)).toBe(true);
  });

  it('beendet ALLE Sitzungen, auch die auf anderen Geräten', async () => {
    const handy = await createSession(userId, { userAgent: 'iPhone' });
    const laptop = await createSession(userId, { userAgent: 'Laptop' });

    expect(await validateSession(handy.token)).not.toBeNull();
    expect(await validateSession(laptop.token)).not.toBeNull();

    await changePassword(userId, ALT, NEU);

    // Genau darum aendert man ein Passwort im Verdachtsfall: Bliebe eine
    // fremde Sitzung bestehen, waere die Aenderung wirkungslos.
    expect(await validateSession(handy.token)).toBeNull();
    expect(await validateSession(laptop.token)).toBeNull();
    expect(await testDb.session.count()).toBe(0);
  });

  it('lässt Sitzungen bei fehlgeschlagener Änderung bestehen', async () => {
    const sitzung = await createSession(userId, {});

    await changePassword(userId, 'falsch', NEU);

    expect(await validateSession(sitzung.token)).not.toBeNull();
  });

  it('speichert das Passwort niemals im Klartext', async () => {
    await changePassword(userId, ALT, NEU);

    const user = await testDb.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.passwordHash).not.toContain(NEU);
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
  });
});
