import { amountToCents, findAmounts } from '@/lib/parsing/amount';
import { findDates } from '@/lib/parsing/german-date';
import { findIbans, isValidIban } from '@/lib/parsing/iban';
import { normalizeSimple } from '@/lib/text/normalize';
import { boundedDistance } from '@/lib/text/fuzzy-find';
import type { Verification } from './verify-quote';

/**
 * Die zweite Stufe der Belegpruefung: Steht der Wert wirklich im Zitat?
 *
 * Ein gefundenes Zitat allein genuegt nicht. Ein Modell kann eine echte
 * Textstelle zitieren und daneben einen Betrag nennen, der dort nicht steht -
 * das ist der gefaehrlichste Fall, weil er wie ein Beleg aussieht.
 *
 * Deshalb wird der behauptete Wert aus der Fundstelle nachgerechnet: Datum
 * gegen die Daten im Zitat, Betrag auf den Cent, IBAN gegen die Pruefsumme.
 *
 * Drei moegliche Ergebnisse:
 *   VERIFIED    Zitat gefunden UND Wert daraus ableitbar
 *   QUOTE_ONLY  Zitat gefunden, der Wert laesst sich daraus nicht pruefen
 *               (Titel, Betreff, Absender - dort gibt es nichts zu rechnen)
 *   UNVERIFIED  Zitat nicht gefunden
 */

export type ValueKind = 'DATE' | 'AMOUNT' | 'IBAN' | 'TEXT';

export function verifyValue(
  kind: ValueKind,
  value: string | null,
  excerpt: string | null,
): Verification {
  if (!excerpt) return 'UNVERIFIED';
  if (value === null || value === '') return 'QUOTE_ONLY';

  switch (kind) {
    case 'DATE':
      return findDates(excerpt).some((date) => date.iso === value) ? 'VERIFIED' : 'QUOTE_ONLY';

    case 'AMOUNT': {
      const claimed = amountToCents(value);
      if (claimed === null) return 'QUOTE_ONLY';
      // Auf den Cent genau: Ein "ungefaehr richtiger" Betrag ist falsch.
      return findAmounts(excerpt).some((amount) => amount.cents === claimed)
        ? 'VERIFIED'
        : 'QUOTE_ONLY';
    }

    case 'IBAN': {
      const normalized = value.replace(/\s/g, '').toUpperCase();
      if (!isValidIban(normalized)) return 'UNVERIFIED';
      return findIbans(excerpt).some((iban) => iban.value === normalized)
        ? 'VERIFIED'
        : 'QUOTE_ONLY';
    }

    case 'TEXT':
      return textAppears(value, excerpt) ? 'VERIFIED' : 'QUOTE_ONLY';
  }
}

/**
 * Steht der Text so oder fast so im Zitat?
 *
 * Grosszuegiger als bei Zahlen, und das mit Absicht: Ein Absender heisst im
 * Brief "AOK Bayern - Die Gesundheitskasse" und im Feld sinnvollerweise
 * "AOK Bayern". Eine Kuerzung ist keine Erfindung.
 */
function textAppears(value: string, excerpt: string): boolean {
  const needle = normalizeSimple(value);
  const haystack = normalizeSimple(excerpt);

  if (needle.length < 3) return false;
  if (haystack.includes(needle)) return true;

  // Fuer kurze Werte reicht ein Vergleich mit dem ganzen Zitat.
  if (needle.length >= haystack.length * 0.6) {
    const distance = boundedDistance(needle, haystack, Math.ceil(needle.length * 0.2));
    if (distance !== null) return true;
  }

  // Sonst: Kommen die tragenden Woerter im Zitat vor?
  const words = needle.split(' ').filter((word) => word.length >= 4);
  if (words.length === 0) return false;

  const hits = words.filter((word) => haystack.includes(word)).length;
  return hits / words.length >= 0.6;
}

/**
 * Bestimmt die Art eines Feldes fuer die Wertpruefung.
 *
 * An einer Stelle festgelegt, damit Analyse und spaetere Anzeige dieselbe
 * Vorstellung davon haben, was ueberhaupt pruefbar ist.
 */
export function valueKindFor(field: string): ValueKind {
  switch (field) {
    case 'documentDate':
    case 'receivedDate':
      return 'DATE';
    default:
      return 'TEXT';
  }
}
