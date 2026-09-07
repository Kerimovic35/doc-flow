import { z } from 'zod';

/**
 * Was die KI aus einem Dokument herauslesen soll.
 *
 * Der Aufbau ist der eigentliche Halluzinationsschutz. Jede Angabe muss mit
 * einem woertlichen Zitat und einer Seitenzahl kommen; ohne Beleg gibt es
 * kein Feld, sondern nur `null`. Der Server prueft danach, ob das Zitat auf
 * der genannten Seite wirklich steht - was diese Pruefung nicht besteht,
 * wird verworfen oder als unbestaetigt gekennzeichnet.
 *
 * Ein Modell, das nichts findet, soll `null` liefern duerfen. Genau das ist
 * der Unterschied zwischen einem Werkzeug, dem man glauben kann, und einem,
 * das immer irgendetwas sagt.
 */

export const evidenceSchema = z.object({
  /** Seitenzahl im Dokument, 1-basiert. */
  page: z.number().int().min(1).max(1000),
  /**
   * Woertliches Zitat aus dem erkannten Text dieser Seite.
   *
   * Ohne Laengenschranke im Schema - siehe LAENGEN weiter unten. Geprueft
   * wird sie in `checkQuote`: Mindestens sechs Zeichen, denn Kuerzeres
   * belegt nichts und passt fast ueberall; hoechstens 240, damit kein halber
   * Brief als "Beleg" durchgereicht wird.
   */
  quote: z.string(),
});

/**
 * Laengengrenzen - bewusst NICHT im Schema.
 *
 * Bei erzwungener Dekodierung wird aus jedem `maxLength` eine Grammatik mit
 * entsprechend vielen Wiederholungen. Neunzehn solcher Schranken, darunter
 * 1200 Zeichen fuer die Zusammenfassung, liessen die Anfrage mit
 * "The compiled grammar is too large" scheitern. Die Grenzen gehoeren
 * ohnehin auf den Server: Das Modell soll sich kurz fassen, aber wenn es das
 * nicht tut, ist das kein Grund, die ganze Analyse zu verlieren.
 */
export const LAENGEN = {
  zitat: 240,
  zitatMindestens: 6,
  zusammenfassung: 1200,
} as const;

/** Schneidet zu langen Text ab, statt ihn zu verwerfen. */
export function kuerze(text: string, grenze: number): string {
  return text.length <= grenze ? text : `${text.slice(0, grenze - 1).trimEnd()}…`;
}

export type Evidence = z.infer<typeof evidenceSchema>;

/**
 * Eine belegte Einzelangabe - oder gar nichts.
 *
 * Das ganze Feld ist `null`, nicht Wert und Beleg einzeln. Das hat zwei
 * Gruende. Fachlich ist es strenger: Es gibt keinen Wert ohne Zitat mehr,
 * also keine Behauptung ohne Beleg. Technisch ist es noetig - die Anthropic-
 * API laesst hoechstens 16 Felder mit Vereinigungstyp zu, und zwei
 * `nullable` je Feld sprengten diese Grenze bei sieben Feldern sofort.
 */
function field<T extends z.ZodTypeAny>(value: T) {
  return z
    .object({
      value,
      confidence: z.number().min(0).max(100),
      evidence: evidenceSchema,
    })
    .nullable();
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum als JJJJ-MM-TT');

/** Absolute Frist, relative Frist oder gar keine. */
export const dueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('absolute'), date: isoDate }),
  z.object({
    kind: z.literal('relative'),
    amount: z.number().int().min(1).max(365),
    unit: z.enum(['DAYS', 'BUSINESS_DAYS', 'WEEKS', 'MONTHS']),
    anchor: z.enum(['DOCUMENT_DATE', 'RECEIVED_DATE']),
  }),
  z.object({ kind: z.literal('none') }),
]);

export const analysisSchema = z.object({
  /** Kurzer, sprechender Titel - so, wie man das Dokument suchen wuerde. */
  title: field(z.string()),
  /** Bescheid, Rechnung, Vertrag, Mahnung … */
  documentType: field(z.string()),
  sender: field(z.string()),
  recipient: field(z.string()),
  subject: field(z.string()),
  documentDate: field(isoDate),
  receivedDate: field(isoDate),

  /**
   * Um wen geht es?
   *
   * Nur eine der vorgegebenen Personen-IDs oder null. `uncertain` ist
   * ausdruecklich erlaubt und erwuenscht: Eine unsichere Zuordnung ist
   * brauchbar, eine falsche nicht.
   */
  person: z.object({
    personId: z.string().nullable(),
    confidence: z.number().min(0).max(100),
    uncertain: z.boolean(),
    reasoning: z.string(),
  }),

  /** Einer der vorgegebenen Kategorieschluessel oder null. */
  category: z.object({
    slug: z.string().nullable(),
    confidence: z.number().min(0).max(100),
  }),

  /** Aktenzeichen, Kunden- und Vertragsnummern. */
  identifiers: z.array(
    z.object({
      kind: z.enum(['AKTENZEICHEN', 'KUNDENNUMMER', 'VERTRAGSNUMMER', 'REFERENZ', 'SONSTIGE']),
      value: z.string(),
      confidence: z.number().min(0).max(100),
      evidence: evidenceSchema,
    }),
  ),

  payments: z.array(
    z.object({
      /** Betrag als Zahl mit Punkt, z. B. "127.50". */
      amount: z.string(),
      currency: z.string(),
      /** OUTGOING: der Empfaenger muss zahlen. INCOMING: er bekommt Geld. */
      direction: z.enum(['OUTGOING', 'INCOMING']),
      due: dueSchema,
      purpose: z.string().nullable(),
      iban: z.string().nullable(),
      recipient: z.string().nullable(),
      confidence: z.number().min(0).max(100),
      evidence: evidenceSchema,
    }),
  ),

  /** Reine Fristen ohne Handlung. */
  deadlines: z.array(
    z.object({
      title: z.string(),
      due: dueSchema,
      confidence: z.number().min(0).max(100),
      evidence: evidenceSchema,
    }),
  ),

  /** Was der Empfaenger tun muss. */
  tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string().nullable(),
      due: dueSchema,
      confidence: z.number().min(0).max(100),
      evidence: evidenceSchema,
    }),
  ),

  /**
   * Zusammenfassung in wenigen Saetzen.
   *
   * Das einzige Feld ohne Einzelbeleg - es fasst zusammen, statt zu
   * behaupten. In der Oberflaeche steht es deshalb ausdruecklich als
   * "Zusammenfassung der KI" und nicht als Dokumentinhalt.
   */
  summary: z.string(),
});

/** Was ueber die Leitung kommt: Felder duerfen ganz fehlen. */
export type AnalysisWire = z.infer<typeof analysisSchema>;

export type AnalysisField<T> = { value: T | null; confidence: number; evidence: Evidence | null };

/**
 * Was die Pipeline verarbeitet: jedes Feld vorhanden, notfalls leer.
 *
 * Die Auswertung soll sich nicht an jeder Stelle fragen muessen, ob ein Feld
 * ueberhaupt da ist - ein fehlendes Feld und ein Feld ohne Wert bedeuten
 * dasselbe.
 */
export type AnalysisOutput = Omit<AnalysisWire, keyof typeof FELDER> & {
  [K in keyof typeof FELDER]: AnalysisField<string>;
};

const FELDER = {
  title: true,
  documentType: true,
  sender: true,
  recipient: true,
  subject: true,
  documentDate: true,
  receivedDate: true,
} as const;

const LEER: AnalysisField<string> = { value: null, confidence: 0, evidence: null };

/** Fehlende Felder auf die leere Form bringen. */
export function normalizeAnalysis(wire: AnalysisWire): AnalysisOutput {
  const normalized = { ...wire } as Record<string, unknown>;

  for (const feld of Object.keys(FELDER)) {
    normalized[feld] = (wire as Record<string, unknown>)[feld] ?? { ...LEER };
  }

  normalized.summary = kuerze(wire.summary ?? '', LAENGEN.zusammenfassung);

  return normalized as AnalysisOutput;
}
