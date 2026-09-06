/**
 * IBAN erkennen und pruefen.
 *
 * Die Pruefsumme ist hier mehr als Kosmetik: Eine falsch gelesene Ziffer in
 * einer Kontonummer faellt sonst niemandem auf, bis das Geld woanders
 * ankommt. Besteht die Pruefsumme nicht, wird die Angabe verworfen statt
 * angezeigt.
 */

export interface ParsedIban {
  /** Ohne Leerzeichen, in Grossbuchstaben. */
  value: string;
  /** In Vierergruppen, wie auf einer Rechnung. */
  formatted: string;
  raw: string;
}

/** Laenge je Land - eine zu kurze oder zu lange IBAN ist keine. */
const LENGTHS: Record<string, number> = {
  DE: 22,
  AT: 20,
  CH: 21,
  FR: 27,
  IT: 27,
  NL: 18,
  BE: 16,
  ES: 24,
  PL: 28,
  LU: 20,
  DK: 18,
  SE: 24,
  CZ: 24,
  HU: 28,
  TR: 26,
};

export function findIbans(text: string): ParsedIban[] {
  const pattern = /\b([A-Z]{2})\s?(\d{2})((?:\s?[A-Z0-9]){10,30})\b/gi;
  const results: ParsedIban[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const value = raw.replace(/\s/g, '').toUpperCase();

    if (!isValidIban(value)) continue;
    if (seen.has(value)) continue;

    seen.add(value);
    results.push({ value, formatted: format(value), raw: raw.trim() });
  }

  return results;
}

export function parseIban(text: string): ParsedIban | null {
  return findIbans(text)[0] ?? null;
}

/**
 * Prueft Laenge und Pruefsumme nach ISO 13616.
 *
 * Die ersten vier Zeichen wandern ans Ende, Buchstaben werden zu Zahlen
 * (A=10 … Z=35), und der Rest der Division durch 97 muss 1 sein.
 */
export function isValidIban(value: string): boolean {
  const iban = value.replace(/\s/g, '').toUpperCase();

  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;

  const country = iban.slice(0, 2);
  const expected = LENGTHS[country];
  // Unbekanntes Land: Die Pruefsumme entscheidet allein.
  if (expected !== undefined && iban.length !== expected) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);

  let remainder = 0;
  for (const character of rearranged) {
    const code = character.charCodeAt(0);
    // Ziffer oder Buchstabe?
    const chunk = code >= 65 ? String(code - 55) : character;

    for (const digit of chunk) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }

  return remainder === 1;
}

function format(value: string): string {
  return value.replace(/(.{4})/g, '$1 ').trim();
}
