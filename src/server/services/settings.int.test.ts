import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actorFor, resetTestDb, seedBasics, testDb } from '@/test/integration-db';

vi.mock('@/server/db', async () => {
  const { testDb: client } = await import('@/test/integration-db');
  return { db: client };
});

const { getSettings, updateAiSettings, updateReminderSettings, parseReminderDays } = await import(
  './settings'
);

let userId: string;

beforeEach(async () => {
  await resetTestDb();
  ({ userId } = await seedBasics());
});

describe('Einstellungen', () => {
  it('liefert brauchbare Voreinstellungen', async () => {
    const settings = await getSettings(actorFor(userId));

    expect(settings.aiEnabled).toBe(true);
    expect(settings.aiProvider).toBe('ANTHROPIC');
    expect(settings.aiModel).toBe('claude-opus-5');
    expect(settings.reminderDays).toEqual([7, 3, 1, 0]);
    // Das Nachlesen schlecht erkannter Seiten durch ein Bildmodell ist
    // standardmaessig aus: Es ist Modellausgabe, nicht Erkennung.
    expect(settings.visionOcrEnabled).toBe(false);
  });

  it('speichert die KI-Einstellungen', async () => {
    const actor = actorFor(userId);

    await updateAiSettings(actor, {
      aiEnabled: false,
      aiProvider: 'OLLAMA',
      aiModel: 'qwen2.5:7b',
      aiEffort: 'low',
      analysisUseImages: false,
      visionOcrEnabled: true,
      autoAnalyze: false,
      ocrThreshold: 55,
    });

    const settings = await getSettings(actor);
    expect(settings.aiEnabled).toBe(false);
    expect(settings.aiProvider).toBe('OLLAMA');
    expect(settings.ocrThreshold).toBe(55);
  });

  it('gibt den API-Schlüssel niemals heraus', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-geheim';

    const settings = await getSettings(actorFor(userId));

    expect(settings.anthropicKeyPresent).toBe(true);
    expect(JSON.stringify(settings)).not.toContain('sk-ant-geheim');

    delete process.env.ANTHROPIC_API_KEY;
  });

  it('speichert Erinnerungstage absteigend und ohne Doppelte', async () => {
    const actor = actorFor(userId);
    await updateReminderSettings(actor, { reminderDays: [1, 7, 1, 3] });

    const settings = await getSettings(actor);
    expect(settings.reminderDays).toEqual([7, 3, 1]);
  });

  it('fällt bei beschädigtem Eintrag auf die Voreinstellung zurück', async () => {
    // Ein von Hand veraenderter JSON-Eintrag darf das Dashboard nicht
    // zerlegen.
    await testDb.userSettings.update({
      where: { userId },
      data: { reminderDays: 'kaputt' },
    });

    const settings = await getSettings(actorFor(userId));
    expect(settings.reminderDays).toEqual([7, 3, 1, 0]);
  });

  it('säubert Zahlen außerhalb des erlaubten Bereichs', () => {
    expect(parseReminderDays([7, -1, 400, 3])).toEqual([7, 3]);
    expect(parseReminderDays([])).toEqual([7, 3, 1, 0]);
  });
});
