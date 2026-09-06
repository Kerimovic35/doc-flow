import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id.
 *
 * Der Zahlenwert steht hier direkt, weil `@node-rs/argon2` seinen
 * `Algorithm`-Aufzaehlungstyp als ambient const enum deklariert - ein solcher
 * Import ist unter `verbatimModuleSyntax` nicht moeglich. Dass der Wert
 * stimmt, sichert der Test ab, der das Praefix `$argon2id$` im erzeugten
 * Hash prueft.
 */
const ARGON2ID = 2;

/**
 * Argon2id mit den von OWASP empfohlenen Parametern (19 MiB Speicher,
 * zwei Durchgaenge, ein Thread).
 *
 * Argon2id statt bcrypt, weil der hohe Speicherbedarf das Durchprobieren
 * auf Grafikkarten unwirtschaftlich macht. Die Parameter sind Teil des
 * erzeugten Hashes - eine spaetere Erhoehung macht vorhandene Passwoerter
 * daher nicht ungueltig.
 */
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

/**
 * Prueft ein Passwort gegen einen gespeicherten Hash.
 *
 * Ein beschaedigter oder fremdformatiger Hash fuehrt zu `false` statt zu einer
 * Ausnahme: Beim Anmelden darf kein Unterschied nach aussen dringen zwischen
 * "falsches Passwort" und "Hash unlesbar".
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}
