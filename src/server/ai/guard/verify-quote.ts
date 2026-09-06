import { findQuote, type FoundQuote } from '@/lib/text/fuzzy-find';
import type { Evidence } from '@/lib/ai/analysis-schema';

/**
 * Die Belegpruefung.
 *
 * Hier entscheidet sich, ob man dieser Anwendung glauben kann. Jede Angabe
 * der KI kommt mit Seitenzahl und woertlichem Zitat; diese Funktion sucht
 * das Zitat im erkannten Text der genannten Seite. Findet sie es nicht, gilt
 * die Angabe als unbestaetigt - unabhaengig davon, wie plausibel sie klingt
 * und wie sicher sich das Modell war.
 *
 * Zwei Zugestaendnisse an die Wirklichkeit, beide begruendet:
 *
 * 1. Die Suche verzeiht Erkennungsfehler. "Versicherun9" statt
 *    "Versicherung" darf eine richtige Angabe nicht scheitern lassen.
 * 2. Nachbarseiten werden mitgesucht. Modelle verzaehlen sich bei der
 *    Seitenzahl; die Angabe deshalb zu verwerfen, waere Strenge am falschen
 *    Ort. Die Seitenzahl wird dann korrigiert.
 */

export type Verification = 'VERIFIED' | 'QUOTE_ONLY' | 'UNVERIFIED';

export interface PageText {
  pageNumber: number;
  text: string | null;
  /** Text aus einem Bildmodell ist selbst Modellausgabe. */
  fromVision?: boolean;
}

export interface QuoteCheck {
  found: boolean;
  /** Die tatsaechliche Seite - kann von der behaupteten abweichen. */
  page: number | null;
  /** Die Fundstelle so, wie sie im Seitentext steht. */
  excerpt: string | null;
  score: number;
  start: number | null;
  end: number | null;
  /** Der Text stammt aus einem Bildmodell. */
  fromVision: boolean;
}

const NOT_FOUND: QuoteCheck = {
  found: false,
  page: null,
  excerpt: null,
  score: 0,
  start: null,
  end: null,
  fromVision: false,
};

/**
 * Sucht ein Zitat - zuerst auf der genannten Seite, dann auf den Nachbarn.
 */
export function checkQuote(evidence: Evidence | null, pages: PageText[]): QuoteCheck {
  if (!evidence) return NOT_FOUND;

  const claimed = pages.find((page) => page.pageNumber === evidence.page);
  const direct = claimed ? search(claimed, evidence.quote) : null;
  if (direct) return direct;

  // Nachbarseiten: Modelle verzaehlen sich, besonders bei mehrseitigen
  // Anhaengen. Nach Abstand sortiert, damit die naechstgelegene Seite
  // gewinnt.
  const neighbours = pages
    .filter((page) => page.pageNumber !== evidence.page)
    .sort(
      (a, b) =>
        Math.abs(a.pageNumber - evidence.page) - Math.abs(b.pageNumber - evidence.page),
    );

  for (const page of neighbours) {
    const found = search(page, evidence.quote);
    if (found) return found;
  }

  return NOT_FOUND;
}

function search(page: PageText, quote: string): QuoteCheck | null {
  if (!page.text) return null;

  const found: FoundQuote | null = findQuote(page.text, quote);
  if (!found) return null;

  return {
    found: true,
    page: page.pageNumber,
    excerpt: found.excerpt,
    score: found.score,
    start: found.start,
    end: found.end,
    fromVision: page.fromVision === true,
  };
}

/**
 * Begrenzt die Sicherheit einer Angabe auf das, was der Beleg hergibt.
 *
 * Ohne Fundstelle hoechstens 30 - so bleibt die Angabe sichtbar, faellt aber
 * in der Oberflaeche sofort als unbestaetigt auf und legt das Dokument zur
 * Prüfung vor.
 *
 * Stammt der Seitentext aus einem Bildmodell, ist die Obergrenze 70: Der
 * "Beleg" ist dann selbst Modellausgabe und keine Erkennung.
 */
export function cappedConfidence(
  claimed: number,
  verification: Verification,
  fromVision: boolean,
): number {
  const bounded = Math.max(0, Math.min(100, Math.round(claimed)));

  if (verification === 'UNVERIFIED') return Math.min(bounded, 30);
  if (fromVision) return Math.min(bounded, 70);

  return bounded;
}
