import type { AiProviderKind } from '@/generated/prisma/enums';
import type { AiSettingsInput, ReminderSettingsInput } from '@/lib/validation/settings';
import type { SessionUser } from '@/server/auth/session';
import { db } from '@/server/db';

/**
 * Persoenliche Einstellungen.
 *
 * Der API-Schluessel steht bewusst NICHT hier, sondern in der Umgebung: Die
 * Datenbank landet in jedem Backup, und ein Backup wandert erfahrungsgemaess
 * irgendwann auf einen zweiten Rechner.
 */

export interface UserSettingsView {
  aiEnabled: boolean;
  aiProvider: AiProviderKind;
  aiModel: string;
  aiEffort: string;
  analysisUseImages: boolean;
  visionOcrEnabled: boolean;
  ocrThreshold: number;
  autoAnalyze: boolean;
  reminderDays: number[];
  defaultCategoryId: string | null;
  /** Ist ein Schluessel hinterlegt? Nur ja/nein, nie der Wert selbst. */
  anthropicKeyPresent: boolean;
  ollamaConfigured: boolean;
}

const DEFAULT_REMINDER_DAYS = [7, 3, 1, 0];

export async function getSettings(actor: SessionUser): Promise<UserSettingsView> {
  const settings = await db.userSettings.upsert({
    where: { userId: actor.id },
    create: { userId: actor.id },
    update: {},
  });

  return {
    aiEnabled: settings.aiEnabled,
    aiProvider: settings.aiProvider,
    aiModel: settings.aiModel,
    aiEffort: settings.aiEffort,
    analysisUseImages: settings.analysisUseImages,
    visionOcrEnabled: settings.visionOcrEnabled,
    ocrThreshold: settings.ocrThreshold,
    autoAnalyze: settings.autoAnalyze,
    reminderDays: parseReminderDays(settings.reminderDays),
    defaultCategoryId: settings.defaultCategoryId,
    anthropicKeyPresent: Boolean(process.env.ANTHROPIC_API_KEY),
    ollamaConfigured: Boolean(process.env.OLLAMA_BASE_URL),
  };
}

export async function updateAiSettings(
  actor: SessionUser,
  input: AiSettingsInput,
): Promise<{ ok: true }> {
  await db.userSettings.upsert({
    where: { userId: actor.id },
    create: { userId: actor.id, ...input },
    update: { ...input },
  });
  return { ok: true };
}

export async function updateReminderSettings(
  actor: SessionUser,
  input: ReminderSettingsInput,
): Promise<{ ok: true }> {
  await db.userSettings.upsert({
    where: { userId: actor.id },
    create: { userId: actor.id, reminderDays: input.reminderDays },
    update: { reminderDays: input.reminderDays },
  });
  return { ok: true };
}

/**
 * Liest die Vorlauftage aus dem JSON-Feld.
 *
 * Defensiv, weil JSON keine Typprueft: Ein von Hand veraenderter Eintrag
 * darf das Dashboard nicht zum Absturz bringen, sondern faellt auf die
 * Voreinstellung zurueck.
 */
export function parseReminderDays(value: unknown): number[] {
  if (!Array.isArray(value)) return DEFAULT_REMINDER_DAYS;

  const days = value
    .map((entry) => Number(entry))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 90);

  return days.length > 0 ? [...new Set(days)].sort((a, b) => b - a) : DEFAULT_REMINDER_DAYS;
}
