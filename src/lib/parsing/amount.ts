/**
 * Geldbetraege aus deutschem Text.
 *
 * Gebraucht, um einen von der KI genannten Betrag gegen sein Zitat zu
 * pruefen. Ein erfundener oder falsch gelesener Betrag ist der teuerste
 * Fehler, den diese Anwendung machen kann - deshalb wird jeder Betrag
 * zeichengenau aus der Fundstelle nachgerechnet.
 *
 * Gerechnet wird in Cent als ganze Zahl. Fliesskomma haette bei 0,1 + 0,2
 * bereits ein Problem.
 */

export interface ParsedAmount {
  /** Betrag in Cent, immer positiv. */
  cents: number;
  currency: string;
  raw: string;
}

const CURRENCY_WORDS: Record<string, string> = {
  '€': 'EUR',
  eur: 'EUR',
  euro: 'EUR',
  chf: 'CHF',
  $: 'USD',
  usd: 'USD',
};

/**
 * Findet alle Betraege im Text.
 *
 * Erkannt werden die Schreibweisen, die in deutschen Briefen vorkommen:
 * 1.234,56 EUR | EUR 1234,56 | 127,50 € | 12,- € | € 89
 *
 * Bewusst NICHT erkannt werden Zahlen ohne Waehrungsangabe: In einem Brief
 * stehen Kundennummern, Aktenzeichen und Hausnummern, und keine davon ist
 * ein Betrag.
 */
export function findAmounts(text: string): ParsedAmount[] {
  const results: ParsedAmount[] = [];

  const symbols = '€|EUR|Euro|CHF|USD|\\$';
  const number = '\\d{1,3}(?:[.\\s]\\d{3})*(?:,\\d{1,2})?|\\d+(?:,\\d{1,2})?';

  // Waehrung hinter dem Betrag: "127,50 EUR", "12,- €"
  //
  // Bewusst kein \b am Ende: Das Eurozeichen ist kein Wortzeichen, eine
  // Wortgrenze dahinter gibt es also nicht - "127,50 €" waere durchgefallen.
  // Stattdessen darf kein Buchstabe folgen, damit "12 EURopa" nicht zaehlt.
  const after = new RegExp(`(${number}|\\d+,-)\\s*(${symbols})(?![A-Za-zÄÖÜäöüß])`, 'gi');
  for (const match of text.matchAll(after)) {
    const parsed = toAmount(match[1]!, match[2]!, match[0]);
    if (parsed) results.push(parsed);
  }

  // Waehrung davor: "EUR 1.234,56"
  const before = new RegExp(`(${symbols})\\s*(${number}|\\d+,-)`, 'gi');
  for (const match of text.matchAll(before)) {
    const parsed = toAmount(match[2]!, match[1]!, match[0]);
    if (parsed) results.push(parsed);
  }

  return dedupe(results);
}

export function parseAmount(text: string): ParsedAmount | null {
  return findAmounts(text)[0] ?? null;
}

/**
 * Liest eine Betragsangabe wie "1.234,56" in Cent.
 *
 * Der Punkt ist im Deutschen der Tausendertrenner, das Komma trennt die
 * Nachkommastellen. Eine Verwechslung machte aus 1.234,56 EUR den Betrag
 * 1,23 EUR - genau deshalb wird hier nicht auf `Number()` vertraut.
 */
export function parseDecimal(value: string): number | null {
  const cleaned = value.replace(/\s/g, '');

  // "12,-" bedeutet zwoelf Euro null Cent.
  const dashless = cleaned.replace(/,-$/, ',00');

  const match = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/.exec(dashless);
  if (!match) return null;

  const whole = match[1]!.replace(/\./g, '');
  const fraction = (match[2] ?? '').padEnd(2, '0');

  const cents = Number(whole) * 100 + Number(fraction);
  return Number.isSafeInteger(cents) ? cents : null;
}

function toAmount(numberPart: string, currencyPart: string, raw: string): ParsedAmount | null {
  const cents = parseDecimal(numberPart);
  if (cents === null) return null;

  const currency = CURRENCY_WORDS[currencyPart.toLowerCase()] ?? 'EUR';
  return { cents, currency, raw: raw.trim() };
}

function dedupe(amounts: ParsedAmount[]): ParsedAmount[] {
  const seen = new Set<string>();
  const result: ParsedAmount[] = [];

  for (const amount of amounts) {
    const key = `${amount.cents}-${amount.currency}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(amount);
  }

  return result;
}

/** Cent als deutscher Betrag, fuer die Anzeige. */
export function formatAmount(cents: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(cents / 100);
}

/** Wandelt einen Betrag aus der Modellantwort in Cent. */
export function amountToCents(value: string | number): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 100) : null;
  }

  const text = value.trim();
  // Die KI liefert das Schema-Feld ueblicherweise als "127.50" oder "127,50".
  if (/^\d+(\.\d{1,2})?$/.test(text)) {
    return Math.round(Number(text) * 100);
  }

  return parseDecimal(text) ?? parseAmount(text)?.cents ?? null;
}
