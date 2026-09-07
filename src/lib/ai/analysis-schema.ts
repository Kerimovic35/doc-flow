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
   * Mindestens sechs Zeichen: Kuerzeres belegt nichts. Hoechstens 240, damit
   * kein halber Brief als "Beleg" durchgereicht wird.
   */
  quote: z.string().min(6).max(240),
});

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
  title: field(z.string().max(200)),
  /** Bescheid, Rechnung, Vertrag, Mahnung … */
  documentType: field(z.string().max(80)),
  sender: field(z.string().max(160)),
  recipient: field(z.string().max(160)),
  subject: field(z.string().max(300)),
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
    reasoning: z.string().max(300),
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
      value: z.string().min(2).max(80),
      confidence: z.number().min(0).max(100),
      evidence: evidenceSchema,
    }),
  ),

  payments: z.array(
    z.object({
      /** Betrag als Zahl mit Punkt, z. B. "127.50". */
      amount: z.string().max(24),
      currency: z.string().max(3),
      /** OUTGOING: der Empfaenger muss zahlen. INCOMING: er bekommt Geld. */
      direction: z.enum(['OUTGOING', 'INCOMING']),
      due: dueSchema,
      purpose: z.string().max(200).nullable(),
      iban: z.string().max(40).nullable(),
      recipient: z.string().max(160).nullable(),
      confidence: z.number().min(0).max(100),
      evidence: evidenceSchema,
    }),
  ),

  /** Reine Fristen ohne Handlung. */
  deadlines: z.array(
    z.object({
      title: z.string().min(3).max(200),
      due: dueSchema,
      confidence: z.number().min(0).max(100),
      evidence: evidenceSchema,
    }),
  ),

  /** Was der Empfaenger tun muss. */
  tasks: z.array(
    z.object({
      title: z.string().min(3).max(200),
      description: z.string().max(500).nullable(),
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
  summary: z.string().max(1200),
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

  return normalized as AnalysisOutput;
}
