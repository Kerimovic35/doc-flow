import { z } from 'zod';

/**
 * Die Antwort des Assistenten.
 *
 * Der Aufbau erzwingt, was der Text allein nicht erzwingen kann: Trennung
 * von Beleg und Deutung.
 *
 *   facts          Was in den Dokumenten steht - jede Aussage mit Dokument,
 *                  Seite und woertlichem Zitat.
 *   interpretation Was das bedeuten koennte. Ausdruecklich als Deutung
 *                  gekennzeichnet und in der Oberflaeche abgesetzt.
 *   notFound       Wonach gefragt wurde und was sich nicht finden liess.
 *                  Eine ehrliche Fehlanzeige ist eine richtige Antwort.
 *   answer         Der Fliesstext fuer den Menschen, mit Verweisen [F1],
 *                  [F2] auf die Fakten.
 *
 * Der Server prueft danach jeden Fakt gegen die Seiten, die das Modell
 * tatsaechlich gelesen hat. Was die Pruefung nicht besteht, wird aus der
 * Antwort entfernt.
 */

export const factSchema = z.object({
  /** Die Aussage in einem Satz. */
  statement: z.string().min(3).max(400),
  /** ID eines Dokuments, das in diesem Gespraech gelesen wurde. */
  documentId: z.string().min(1).max(40),
  page: z.number().int().min(1).max(1000),
  /** Woertliches Zitat aus dem Text dieser Seite. */
  quote: z.string().min(6).max(240),
});

export const chatAnswerSchema = z.object({
  facts: z.array(factSchema).max(20),
  interpretation: z.string().max(1200).nullable(),
  notFound: z.array(z.string().max(200)).max(10),
  answer: z.string().min(1).max(4000),
});

export type ChatAnswer = z.infer<typeof chatAnswerSchema>;
export type ChatFact = z.infer<typeof factSchema>;

/** Steht in der Antwort, wenn kein einziger Beleg uebrig bleibt. */
export const NOTHING_FOUND_TEXT =
  'In deinen Dokumenten habe ich dazu nichts gefunden.';
