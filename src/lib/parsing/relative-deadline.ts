import { daysInMonth, formatGerman } from './german-date';

/**
 * Relative Fristen.
 *
 * "innerhalb von zwei Wochen" ist ohne Bezugspunkt keine Frist. Erst mit dem
 * Datum des Schreibens wird ein Datum daraus - und weil dieser Bezugspunkt
 * eine Annahme ist (der Brief kam vielleicht drei Tage spaeter an), wird
 * jede so berechnete Frist als unsicher gekennzeichnet und mit ihrer
 * Herleitung angezeigt.
 *
 * Die Anwendung rechnet, aber sie behauptet nicht, recht zu haben.
 */

export type DeadlineUnit = 'DAYS' | 'BUSINESS_DAYS' | 'WEEKS' | 'MONTHS';
export type DeadlineAnchor = 'DOCUMENT_DATE' | 'RECEIVED_DATE';

export interface RelativeDeadline {
  amount: number;
  unit: DeadlineUnit;
  anchor: DeadlineAnchor;
}

export interface ResolvedDeadline {
  /** ISO-Datum, oder null wenn der Bezugspunkt fehlt. */
  iso: string | null;
  uncertain: boolean;
  /** Klartext der Herleitung fuer die Oberflaeche. */
  rule: string;
}

const WORD_NUMBERS: Record<string, number> = {
  einer: 1,
  einem: 1,
  eines: 1,
  eine: 1,
  ein: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  fuenf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  zwölf: 12,
  zwoelf: 12,
  vierzehn: 14,
};

const UNIT_LABEL: Record<DeadlineUnit, [string, string]> = {
  DAYS: ['Tag', 'Tagen'],
  BUSINESS_DAYS: ['Werktag', 'Werktagen'],
  WEEKS: ['Woche', 'Wochen'],
  MONTHS: ['Monat', 'Monaten'],
};

const ANCHOR_LABEL: Record<DeadlineAnchor, string> = {
  DOCUMENT_DATE: 'Datum des Schreibens',
  RECEIVED_DATE: 'Eingang',
};

/**
 * Erkennt eine relative Frist im Text.
 *
 * Bewusst nur die gebraeuchlichen Wendungen. Eine Formulierung, die hier
 * nicht steht, wird nicht falsch geraten, sondern gar nicht erkannt - dann
 * traegt der Benutzer die Frist von Hand nach.
 */
export function findRelativeDeadline(text: string): RelativeDeadline | null {
  const value = text.toLowerCase();

  const pattern =
    /(?:innerhalb\s+von|binnen|innerhalb|in)\s+(\d{1,3}|[a-zäöüß]+)\s+(werktagen|werktage|werktags|tagen|tage|tages|wochen|woche|monaten|monats|monat)/;
  const match = pattern.exec(value);

  if (match) {
    const amount = toNumber(match[1]!);
    const unit = toUnit(match[2]!);
    if (amount && unit) {
      return { amount, unit, anchor: anchorFor(value) };
    }
  }

  // "14 Tage nach Zugang" / "zwei Wochen nach Erhalt"
  const after =
    /(\d{1,3}|[a-zäöüß]+)\s+(werktagen|werktage|tagen|tage|wochen|woche|monaten|monat)\s+nach\s+(zugang|erhalt|eingang|zustellung|bekanntgabe)/.exec(
      value,
    );
  if (after) {
    const amount = toNumber(after[1]!);
    const unit = toUnit(after[2]!);
    if (amount && unit) {
      return { amount, unit, anchor: 'RECEIVED_DATE' };
    }
  }

  return null;
}

/**
 * Rechnet eine relative Frist in ein Datum um.
 *
 * Werktage lassen Samstag und Sonntag aus. Feiertage bleiben unberuecksichtigt -
 * sie haengen vom Bundesland ab, und eine falsche Genauigkeit waere hier
 * schaedlicher als eine ehrliche Unschaerfe. Genau deshalb ist jede so
 * berechnete Frist als unsicher markiert.
 */
export function resolveDeadline(
  deadline: RelativeDeadline,
  anchors: { documentDate?: string | null; receivedDate?: string | null },
): ResolvedDeadline {
  const preferred =
    deadline.anchor === 'RECEIVED_DATE'
      ? (anchors.receivedDate ?? anchors.documentDate)
      : (anchors.documentDate ?? anchors.receivedDate);

  const [singular, plural] = UNIT_LABEL[deadline.unit];
  const unitLabel = deadline.amount === 1 ? singular : plural;
  const anchorLabel = ANCHOR_LABEL[deadline.anchor];

  if (!preferred) {
    return {
      iso: null,
      uncertain: true,
      rule: `${deadline.amount} ${unitLabel} ab ${anchorLabel} — Bezugsdatum fehlt`,
    };
  }

  const iso = addTo(preferred, deadline.amount, deadline.unit);

  return {
    iso,
    // Immer unsicher: Der Bezugspunkt ist eine Annahme, und Feiertage sind
    // nicht beruecksichtigt.
    uncertain: true,
    rule: `${deadline.amount} ${unitLabel} ab ${anchorLabel} ${formatGerman(preferred)} = ${formatGerman(iso)}`,
  };
}

export function addTo(iso: string, amount: number, unit: DeadlineUnit): string {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));

  switch (unit) {
    case 'DAYS':
      date.setUTCDate(date.getUTCDate() + amount);
      break;

    case 'WEEKS':
      date.setUTCDate(date.getUTCDate() + amount * 7);
      break;

    case 'MONTHS': {
      const targetMonth = date.getUTCMonth() + amount;
      const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12);
      const normalizedMonth = ((targetMonth % 12) + 12) % 12;
      // Der 31. Januar plus einen Monat ist der 28./29. Februar, nicht der
      // 3. Maerz.
      const maxDay = daysInMonth(targetYear, normalizedMonth + 1);
      date.setUTCFullYear(targetYear, normalizedMonth, Math.min(date.getUTCDate(), maxDay));
      break;
    }

    case 'BUSINESS_DAYS': {
      let remaining = amount;
      while (remaining > 0) {
        date.setUTCDate(date.getUTCDate() + 1);
        const weekday = date.getUTCDay();
        if (weekday !== 0 && weekday !== 6) remaining -= 1;
      }
      break;
    }
  }

  return date.toISOString().slice(0, 10);
}

function toNumber(value: string): number | null {
  const digits = Number(value);
  if (Number.isInteger(digits) && digits > 0 && digits <= 365) return digits;

  const word = WORD_NUMBERS[value];
  return word ?? null;
}

function toUnit(value: string): DeadlineUnit | null {
  if (value.startsWith('werktag')) return 'BUSINESS_DAYS';
  if (value.startsWith('tag')) return 'DAYS';
  if (value.startsWith('woche')) return 'WEEKS';
  if (value.startsWith('monat')) return 'MONTHS';
  return null;
}

function anchorFor(text: string): DeadlineAnchor {
  return /zugang|erhalt|eingang|zustellung|bekanntgabe/.test(text)
    ? 'RECEIVED_DATE'
    : 'DOCUMENT_DATE';
}
