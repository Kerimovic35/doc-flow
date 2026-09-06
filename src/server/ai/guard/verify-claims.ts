import { NOTHING_FOUND_TEXT, type ChatAnswer, type ChatFact } from '@/lib/ai/chat-schema';
import { findQuote } from '@/lib/text/fuzzy-find';

/**
 * Die Quellenpruefung fuer Antworten des Assistenten.
 *
 * Strenger als bei der Dokumentanalyse, und zwar an einer Stelle: Ein Beleg
 * zaehlt nur, wenn er auf eine Seite zeigt, die das Modell in diesem
 * Gespraech tatsaechlich angefordert hat.
 *
 * Der Grund ist der Unterschied zwischen den beiden Faellen. Bei der Analyse
 * liegt genau ein Dokument vor, und das Modell hat es ganz gesehen. Beim
 * Assistenten steht der gesamte Bestand offen; ohne diese Regel koennte das
 * Modell aus einem Suchergebnis heraus ein Zitat "erinnern", das es nie
 * gelesen hat. Was nicht gelesen wurde, kann nicht belegt werden.
 */

export interface ReadPage {
  documentId: string;
  page: number;
  text: string;
}

export interface VerifiedFact extends ChatFact {
  /** Das Zitat, wie es wirklich im Text steht. */
  excerpt: string;
  score: number;
}

export interface VerifiedAnswer {
  facts: VerifiedFact[];
  interpretation: string | null;
  notFound: string[];
  answer: string;
  /** Wie viele Behauptungen die Pruefung nicht bestanden haben. */
  removed: number;
}

/**
 * Prueft die Antwort und entfernt, was nicht belegt ist.
 *
 * Die Verweise `[F1]`, `[F2]` im Fliesstext werden dabei neu nummeriert -
 * sonst zeigte eine Fussnote nach dem Entfernen auf den falschen Beleg.
 */
export function verifyAnswer(answer: ChatAnswer, read: ReadPage[]): VerifiedAnswer {
  const index = new Map<string, string>();
  for (const page of read) {
    index.set(`${page.documentId}#${page.page}`, page.text);
  }

  const kept: VerifiedFact[] = [];
  const mapping = new Map<number, number>();
  let removed = 0;

  for (const [position, fact] of answer.facts.entries()) {
    const text = index.get(`${fact.documentId}#${fact.page}`);

    // Nicht gelesen, nicht belegt.
    if (!text) {
      removed += 1;
      continue;
    }

    const found = findQuote(text, fact.quote);
    if (!found) {
      removed += 1;
      continue;
    }

    kept.push({ ...fact, excerpt: found.excerpt, score: found.score });
    // Alte Nummer (1-basiert) auf neue abbilden.
    mapping.set(position + 1, kept.length);
  }

  const rewritten = rewriteReferences(answer.answer, mapping);

  return {
    facts: kept,
    interpretation: answer.interpretation?.trim() || null,
    notFound: answer.notFound,
    // Ohne einen einzigen Beleg darf keine Behauptung stehen bleiben.
    answer: kept.length === 0 && looksLikeClaim(rewritten) ? NOTHING_FOUND_TEXT : rewritten,
    removed,
  };
}

/**
 * Nummeriert die Verweise neu und entfernt die zu gestrichenen Fakten.
 *
 * Ein Verweis auf einen entfernten Beleg wird sichtbar gemacht, nicht
 * stillschweigend geloescht: Der Benutzer soll merken, dass die KI hier
 * etwas behauptet hat, das sich nicht belegen liess.
 */
function rewriteReferences(text: string, mapping: Map<number, number>): string {
  return text.replace(/\[F(\d+)\]/g, (match, digits: string) => {
    const target = mapping.get(Number(digits));
    return target ? `[F${target}]` : '(nicht belegt)';
  });
}

/**
 * Sieht der Text nach einer Tatsachenbehauptung aus?
 *
 * Grob, aber ausreichend: Wenn nichts belegt ist und die Antwort trotzdem
 * mehr als eine kurze Wendung enthaelt, wird sie ersetzt. Eine Antwort wie
 * "Dazu finde ich nichts." bleibt stehen.
 */
function looksLikeClaim(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 40) return false;

  // Sagt die Antwort selbst schon, dass nichts gefunden wurde?
  return !/nicht gefunden|nichts gefunden|keine (angaben|dokumente|hinweise)|liegt (mir |)nicht vor/i.test(
    trimmed,
  );
}
