import { z } from 'zod';

export const personKinds = ['SELF', 'FAMILY', 'OTHER'] as const;

export const personSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name fehlt')
    .max(80, 'Name ist zu lang'),
  kind: z.enum(personKinds).default('FAMILY'),
  /**
   * Geburtsdatum ist freiwillig. Es hilft der Zuordnung, wenn zwei Personen
   * denselben Vornamen tragen - erzwungen wird es nicht, weil die meisten
   * Briefe es ohnehin nicht enthalten.
   */
  birthDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT')
    .optional()
    .or(z.literal('')),
  notes: z.string().trim().max(2000, 'Notiz ist zu lang').optional().or(z.literal('')),
});

export type PersonInput = z.infer<typeof personSchema>;
