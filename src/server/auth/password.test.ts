import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('Passwort-Hashing', () => {
  it('erkennt das richtige Passwort wieder', async () => {
    const stored = await hashPassword('korrektes-passwort-123');
    expect(await verifyPassword(stored, 'korrektes-passwort-123')).toBe(true);
  });

  it('weist ein falsches Passwort ab', async () => {
    const stored = await hashPassword('korrektes-passwort-123');
    expect(await verifyPassword(stored, 'falsches-passwort')).toBe(false);
  });

  it('erzeugt fuer gleiche Passwoerter unterschiedliche Hashes', async () => {
    // Unterschiedliches Salt je Hash: aus der Datenbank laesst sich damit
    // nicht ablesen, welche Benutzer dasselbe Passwort verwenden.
    const a = await hashPassword('gleiches-passwort');
    const b = await hashPassword('gleiches-passwort');
    expect(a).not.toBe(b);
  });

  it('verwendet Argon2id', async () => {
    expect(await hashPassword('beliebig')).toMatch(/^\$argon2id\$/);
  });

  it('liefert false statt einer Ausnahme bei beschaedigtem Hash', async () => {
    expect(await verifyPassword('kein-gueltiger-hash', 'irgendwas')).toBe(false);
    expect(await verifyPassword('', 'irgendwas')).toBe(false);
  });
});
