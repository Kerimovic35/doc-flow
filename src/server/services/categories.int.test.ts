import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actorFor, resetTestDb, seedBasics, testDb } from '@/test/integration-db';

vi.mock('@/server/db', async () => {
  const { testDb: client } = await import('@/test/integration-db');
  return { db: client };
});

const { listCategories, createCategory, renameCategory, deactivateCategory } = await import(
  './categories'
);

let userId: string;

beforeEach(async () => {
  await resetTestDb();
  ({ userId } = await seedBasics());
});

describe('Kategorien', () => {
  it('liefert die zwölf mitgelieferten Kategorien', async () => {
    const categories = await listCategories(actorFor(userId));

    expect(categories).toHaveLength(12);
    expect(categories.map((c) => c.slug)).toContain('krankenkasse');
    expect(categories.every((c) => c.isSystem)).toBe(true);
  });

  it('legt eine eigene Kategorie mit Schlüssel an', async () => {
    const actor = actorFor(userId);
    const result = await createCategory(actor, { name: 'Ärztliche Befunde' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const category = await testDb.category.findUniqueOrThrow({ where: { id: result.id } });
    expect(category.slug).toBe('aerztliche-befunde');
    expect(category.isSystem).toBe(false);
  });

  it('lehnt einen Namen ab, der denselben Schlüssel ergäbe', async () => {
    const actor = actorFor(userId);

    // "Behörden" gibt es schon als mitgelieferte Kategorie.
    const result = await createCategory(actor, { name: 'behoerden' });
    expect(result.ok).toBe(false);
  });

  it('behält den Schlüssel beim Umbenennen', async () => {
    const actor = actorFor(userId);
    const krankenkasse = await testDb.category.findFirstOrThrow({
      where: { userId, slug: 'krankenkasse' },
    });

    await renameCategory(actor, krankenkasse.id, { name: 'Gesundheit' });

    // Der Schluessel ist die Sprache zwischen KI und Anwendung. Wechselte er
    // beim Umbenennen, waeren alle bisherigen Vorschlaege entwertet.
    const nachher = await testDb.category.findUniqueOrThrow({ where: { id: krankenkasse.id } });
    expect(nachher.name).toBe('Gesundheit');
    expect(nachher.slug).toBe('krankenkasse');
  });

  it('blendet aus statt zu löschen', async () => {
    const actor = actorFor(userId);
    const category = await testDb.category.findFirstOrThrow({ where: { userId, slug: 'mobilfunk' } });

    await deactivateCategory(actor, category.id);

    const nachher = await testDb.category.findUniqueOrThrow({ where: { id: category.id } });
    expect(nachher.active).toBe(false);
  });

  it('rührt keine fremde Kategorie an', async () => {
    const fremd = await seedBasics({ email: 'fremd@docflow.local', name: 'Fremd' });
    const fremdeKategorie = await testDb.category.findFirstOrThrow({
      where: { userId: fremd.userId, slug: 'finanzen' },
    });

    const result = await renameCategory(actorFor(userId), fremdeKategorie.id, { name: 'Gekapert' });

    expect(result.ok).toBe(false);
    const unveraendert = await testDb.category.findUniqueOrThrow({
      where: { id: fremdeKategorie.id },
    });
    expect(unveraendert.name).toBe('Finanzen');
  });
});
