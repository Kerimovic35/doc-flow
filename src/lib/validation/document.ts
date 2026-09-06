import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'Der Text ist zu lang')
    .transform((value) => (value === '' ? null : value))
    .nullable();

const optionalDate = z
  .string()
  .trim()
  .refine((value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: 'Datum im Format JJJJ-MM-TT',
  })
  .transform((value) => (value === '' ? null : value))
  .nullable();

const optionalId = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullable();

/**
 * Die vom Benutzer bearbeitbaren Angaben eines Dokuments.
 *
 * Alles ist freiwillig: Ein Dokument darf unvollstaendig sein. Der Zwang zu
 * einem Titel wuerde nur dazu fuehren, dass jemand "xy" eintraegt.
 */
export const documentMetaSchema = z.object({
  title: optionalText(200),
  documentType: optionalText(80),
  sender: optionalText(160),
  recipient: optionalText(160),
  subject: optionalText(300),
  documentDate: optionalDate,
  receivedDate: optionalDate,
  personId: optionalId,
  categoryId: optionalId,
});

export type DocumentMetaInput = z.infer<typeof documentMetaSchema>;

/** Die Felder, die eine Herkunft in `fieldMeta` tragen. */
export const META_FIELDS = [
  'title',
  'documentType',
  'sender',
  'recipient',
  'subject',
  'documentDate',
  'receivedDate',
  'summary',
  'person',
  'category',
] as const;

export type MetaField = (typeof META_FIELDS)[number];

/** Herkunft und Belegstand einer einzelnen Angabe. */
export interface FieldMetaEntry {
  confidence?: number;
  page?: number;
  quote?: string;
  verification?: 'VERIFIED' | 'QUOTE_ONLY' | 'UNVERIFIED' | 'USER';
  source?: 'AI' | 'USER';
}

export type FieldMeta = Partial<Record<string, FieldMetaEntry>>;

/**
 * Liest das JSON-Feld defensiv aus.
 *
 * JSON traegt keine Typprüfung. Ein von Hand veraenderter Eintrag darf die
 * Detailseite nicht zerlegen.
 */
export function readFieldMeta(value: unknown): FieldMeta {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const result: FieldMeta = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;

    result[key] = {
      confidence: typeof record.confidence === 'number' ? record.confidence : undefined,
      page: typeof record.page === 'number' ? record.page : undefined,
      quote: typeof record.quote === 'string' ? record.quote : undefined,
      verification:
        record.verification === 'VERIFIED' ||
        record.verification === 'QUOTE_ONLY' ||
        record.verification === 'UNVERIFIED' ||
        record.verification === 'USER'
          ? record.verification
          : undefined,
      source: record.source === 'USER' ? 'USER' : record.source === 'AI' ? 'AI' : undefined,
    };
  }

  return result;
}
