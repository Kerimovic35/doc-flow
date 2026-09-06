import { z } from 'zod';

/**
 * Modelle, die zur Auswahl stehen.
 *
 * Bewusst eine kurze, gepflegte Liste statt eines freien Textfeldes: Ein
 * Tippfehler im Modellnamen wuerde erst beim naechsten Brief auffallen - und
 * zwar als gescheiterte Analyse.
 */
export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 (beste Erkennung)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (günstiger)' },
] as const;

export const AI_EFFORTS = [
  { id: 'low', label: 'niedrig' },
  { id: 'medium', label: 'mittel' },
  { id: 'high', label: 'hoch (empfohlen)' },
] as const;

export const aiSettingsSchema = z.object({
  aiEnabled: z.boolean(),
  aiProvider: z.enum(['ANTHROPIC', 'OLLAMA']),
  aiModel: z.string().trim().min(1, 'Modell fehlt').max(80),
  aiEffort: z.enum(['low', 'medium', 'high']),
  analysisUseImages: z.boolean(),
  visionOcrEnabled: z.boolean(),
  autoAnalyze: z.boolean(),
  ocrThreshold: z.coerce
    .number()
    .int('Ganze Zahl erwartet')
    .min(0, 'Mindestens 0')
    .max(100, 'Höchstens 100'),
});

export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;

/**
 * Vorlauftage fuer Erinnerungen, z. B. "7, 3, 1, 0".
 *
 * Als Text statt als Kaestchenliste: Wer nur einen Tag Vorlauf will, soll
 * nicht durch vier Schalter navigieren muessen.
 */
export const reminderSettingsSchema = z.object({
  reminderDays: z
    .string()
    .trim()
    .transform((value) =>
      value
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((part) => Number(part)),
    )
    .refine((days) => days.every((day) => Number.isInteger(day) && day >= 0 && day <= 90), {
      message: 'Nur ganze Zahlen zwischen 0 und 90, durch Komma getrennt',
    })
    .refine((days) => days.length <= 6, { message: 'Höchstens sechs Zeitpunkte' })
    // Absteigend und ohne Doppelte: "7, 3, 3, 1" ist dasselbe wie "7, 3, 1".
    .transform((days) => [...new Set(days)].sort((a, b) => b - a)),
});

export type ReminderSettingsInput = z.infer<typeof reminderSettingsSchema>;
