import { z } from 'zod';

export const categorySchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(60, 'Name ist zu lang'),
});

export type CategoryInput = z.infer<typeof categorySchema>;

/**
 * Bildet einen Anzeigenamen auf einen technischen Schluessel ab.
 *
 * Der Schluessel ist stabil und wird von der KI benutzt, um eine Kategorie
 * vorzuschlagen. Deshalb enthaelt er nur Kleinbuchstaben, Ziffern und
 * Bindestriche - Umlaute werden ausgeschrieben, damit "Behörden" und
 * "Behoerden" nicht zwei verschiedene Schluessel ergeben.
 */
export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
