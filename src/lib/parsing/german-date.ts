/**
 * Deutsche Datumsangaben.
 *
 * Gebraucht an zwei Stellen: um ein von der KI genanntes Datum gegen das
 * Zitat zu pruefen, und um relative Fristen auszurechnen. Beides entscheidet
 * darueber, ob eine Frist stimmt - und eine falsche Frist ist schlimmer als
 * gar keine.
 */

const MONTHS: Record<string, number> = {
  januar: 1,
  jänner: 1,
  februar: 2,
  märz: 3,
  maerz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
  jan: 1,
  feb: 2,
  mrz: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  okt: 10,
  nov: 11,
  dez: 12,
};

export interface ParsedDate {
  /** ISO-Datum ohne Zeitanteil. */
  iso: string;
  /** Wie es im Text stand. */
  raw: string;
  /** Nur Monat und Jahr genannt, der Tag ist geraten. */
  monthOnly: boolean;
}

/**
 * Findet alle Datumsangaben in einem Text.
 *
 * Bewusst mehrere: In einem Zitat wie "Bescheid vom 04.09.2026, zahlbar bis
 * 12.09.2026" stehen zwei, und welches gemeint ist, entscheidet nicht diese
 * Funktion, sondern die Pruefung gegen den behaupteten Wert.
 */
export function findDates(text: string, options: { referenceYear?: number } = {}): ParsedDate[] {
  const found: ParsedDate[] = [];

  // 04.09.2026 | 4.9.26 | 04-09-2026 | 2026-09-04
  const numeric = /\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/g;
  for (const match of text.matchAll(numeric)) {
    if (match[4]) {
      const date = build(Number(match[6]), Number(match[5]), Number(match[4]), match[0], false);
      if (date) found.push(date);
      continue;
    }

    const date = build(
      Number(match[1]),
      Number(match[2]),
      expandYear(Number(match[3]), match[3]!.length, options.referenceYear),
      match[0],
      false,
    );
    if (date) found.push(date);
  }

  // 4. September 2026 | 4. Sept. 2026
  const withMonthName = /\b(\d{1,2})\.\s*([A-Za-zÄÖÜäöüß]+)\.?\s*(\d{4})\b/g;
  for (const match of text.matchAll(withMonthName)) {
    const month = MONTHS[match[2]!.toLowerCase()];
    if (!month) continue;

    const date = build(Number(match[1]), month, Number(match[3]), match[0], false);
    if (date) found.push(date);
  }

  // September 2026 - ohne Tag. Wird als Monatsende gelesen, weil "bis
  // September" umgangssprachlich das Monatsende meint.
  const monthYear = /\b([A-Za-zÄÖÜäöüß]+)\s+(\d{4})\b/g;
  for (const match of text.matchAll(monthYear)) {
    const month = MONTHS[match[1]!.toLowerCase()];
    if (!month) continue;

    const year = Number(match[2]);
    const date = build(daysInMonth(year, month), month, year, match[0], true);
    if (date) found.push(date);
  }

  return dedupe(found);
}

/** Das erste Datum im Text, oder null. */
export function parseGermanDate(text: string, referenceYear?: number): ParsedDate | null {
  return findDates(text, { referenceYear })[0] ?? null;
}

/**
 * Ergaenzt eine zweistellige Jahreszahl.
 *
 * Bei Briefen liegt das gemeinte Jahr immer nahe am Dokumentdatum. Ohne
 * Bezugsjahr wird das laufende Jahrhundert angenommen.
 */
function expandYear(value: number, digits: number, referenceYear?: number): number {
  if (digits === 4) return value;

  const century = Math.floor((referenceYear ?? new Date().getFullYear()) / 100) * 100;
  return century + value;
}

function build(
  day: number,
  month: number,
  year: number,
  raw: string,
  monthOnly: boolean,
): ParsedDate | null {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (month < 1 || month > 12) return null;
  if (year < 1900 || year > 2200) return null;
  // Der 31. Februar ist kein Datum, sondern ein Erkennungsfehler.
  if (day < 1 || day > daysInMonth(year, month)) return null;

  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { iso, raw, monthOnly };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dedupe(dates: ParsedDate[]): ParsedDate[] {
  const seen = new Set<string>();
  const result: ParsedDate[] = [];

  for (const date of dates) {
    if (seen.has(date.iso)) continue;
    seen.add(date.iso);
    result.push(date);
  }

  return result;
}

/** Formatiert ein ISO-Datum deutsch, fuer Meldungen und Herleitungen. */
export function formatGerman(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${match[3]}.${match[2]}.${match[1]}`;
}
