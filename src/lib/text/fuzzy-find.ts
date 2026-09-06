import { normalize } from './normalize';

/**
 * Zitatsuche im Seitentext.
 *
 * Die entscheidende Funktion der ganzen Anwendung: Sie beantwortet, ob eine
 * Aussage der KI im Dokument wirklich steht. Faellt sie zu streng aus,
 * verwirft die Anwendung richtige Angaben, weil die Texterkennung ein "l"
 * als "1" gelesen hat. Faellt sie zu grosszuegig aus, geht ein erfundenes
 * Zitat durch - und damit die Glaubwuerdigkeit der Anwendung.
 *
 * Der Weg dazwischen: exakte Suche zuerst, dann ein Vergleich mit begrenzter
 * Fehlertoleranz. Toleriert werden vereinzelte falsch gelesene Zeichen,
 * nicht ein anderer Satz.
 */

export interface FoundQuote {
  /** Aehnlichkeit von 0 bis 1. */
  score: number;
  /** Fundstelle im ORIGINALTEXT, nicht im vereinheitlichten. */
  start: number;
  end: number;
  /** Die Textstelle, wie sie im Original steht. */
  excerpt: string;
  exact: boolean;
}

/**
 * Mindestaehnlichkeit.
 *
 * Kurze Zitate brauchen mehr: Bei acht Zeichen entspricht ein Fehler schon
 * zwoelf Prozent, und zwei zufaellig aehnliche kurze Wendungen gibt es in
 * jedem Brief. Bei langen Zitaten ist ein einzelner Erkennungsfehler
 * dagegen unvermeidlich.
 */
export function thresholdFor(length: number): number {
  if (length < 12) return 0.95;
  if (length < 25) return 0.9;
  return 0.85;
}

/** Kuerzer als das ist kein Beleg, sondern ein Zufall. */
export const MIN_QUOTE_LENGTH = 6;

export function findQuote(haystack: string, quote: string): FoundQuote | null {
  const normalizedQuote = normalize(quote);
  const needle = normalizedQuote.value;

  if (needle.length < MIN_QUOTE_LENGTH) return null;

  const normalizedText = normalize(haystack);
  const text = normalizedText.value;
  if (text.length === 0) return null;

  // 1. Der Regelfall: Das Zitat steht so da.
  const exactIndex = text.indexOf(needle);
  if (exactIndex >= 0) {
    return build(normalizedText.offsets, haystack, exactIndex, needle.length, 1, true);
  }

  // 2. Sonst mit Fehlertoleranz suchen.
  return findApproximate(text, needle, normalizedText.offsets, haystack);
}

function findApproximate(
  text: string,
  needle: string,
  offsets: number[],
  original: string,
): FoundQuote | null {
  const threshold = thresholdFor(needle.length);
  // Die Fundstelle darf etwas laenger oder kuerzer sein als das Zitat -
  // Erkennungsfehler fuegen Zeichen ein oder lassen sie weg.
  const window = needle.length;
  const slack = Math.max(2, Math.round(window * 0.15));
  const maxDistance = Math.floor(window * (1 - threshold)) + 1;

  let best: { score: number; start: number; end: number } | null = null;

  // An Wortgrenzen ansetzen statt an jedem Zeichen: Ein Zitat beginnt nicht
  // mitten in einem Wort, und der Aufwand sinkt um eine Groessenordnung.
  for (const start of wordStarts(text)) {
    if (start + window - slack > text.length) break;

    for (const length of candidateLengths(window, slack, text.length - start)) {
      const candidate = text.slice(start, start + length);
      const distance = boundedDistance(candidate, needle, maxDistance);
      if (distance === null) continue;

      const score = 1 - distance / Math.max(candidate.length, needle.length);
      if (score >= threshold && (!best || score > best.score)) {
        best = { score, start, end: start + length };
      }
    }
  }

  if (!best) return null;
  return build(offsets, original, best.start, best.end - best.start, best.score, false);
}

function* candidateLengths(window: number, slack: number, available: number): Generator<number> {
  // Erst die erwartete Laenge, dann kuerzer und laenger - so trifft der
  // haeufigste Fall zuerst.
  const lengths = [window];
  for (let delta = 1; delta <= slack; delta += 1) {
    lengths.push(window - delta, window + delta);
  }

  for (const length of lengths) {
    if (length > 0 && length <= available) yield length;
  }
}

function* wordStarts(text: string): Generator<number> {
  yield 0;
  for (let index = 1; index < text.length; index += 1) {
    if (text[index - 1] === ' ') yield index;
  }
}

/**
 * Levenshtein-Abstand mit Obergrenze.
 *
 * Die Grenze ist nicht nur Sparsamkeit: Sie bricht den Vergleich ab, sobald
 * feststeht, dass die Stelle ohnehin zu unaehnlich ist. Ohne sie liefe die
 * Suche ueber eine zwoelfseitige Akte spuerbar lange.
 */
export function boundedDistance(a: string, b: string, maxDistance: number): number | null {
  if (Math.abs(a.length - b.length) > maxDistance) return null;
  if (a === b) return 0;

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);

  for (let index = 0; index <= b.length; index += 1) previous[index] = index;

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMinimum = current[0]!;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j]! + 1, // Loeschen
        current[j - 1]! + 1, // Einfuegen
        previous[j - 1]! + cost, // Ersetzen
      );
      current[j] = value;
      if (value < rowMinimum) rowMinimum = value;
    }

    // Keine Zelle der Zeile liegt unter der Grenze - besser wird es nicht.
    if (rowMinimum > maxDistance) return null;

    const swap = previous;
    previous = current;
    current = swap;
  }

  const distance = previous[b.length]!;
  return distance <= maxDistance ? distance : null;
}

function build(
  offsets: number[],
  original: string,
  start: number,
  length: number,
  score: number,
  exact: boolean,
): FoundQuote {
  const originalStart = offsets[start] ?? 0;
  const lastIndex = Math.min(start + length - 1, offsets.length - 1);
  const originalEnd = (offsets[lastIndex] ?? originalStart) + 1;

  return {
    score,
    start: originalStart,
    end: originalEnd,
    excerpt: original.slice(originalStart, originalEnd),
    exact,
  };
}
