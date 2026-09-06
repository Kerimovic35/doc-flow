import { toSlug, type CategoryInput } from '@/lib/validation/category';
import type { SessionUser } from '@/server/auth/session';
import { db } from '@/server/db';

/**
 * Kategorien.
 *
 * Zwoelf sind mitgeliefert und tragen `isSystem`. Umbenennen ist erlaubt -
 * wer "Krankenkasse" lieber "Gesundheit" nennt, soll das duerfen. Der
 * technische Schluessel bleibt dabei unveraendert, weil die KI ihn zum
 * Vorschlagen benutzt und ein Wechsel alle bisherigen Zuordnungen entwerten
 * wuerde.
 */

export interface CategoryListItem {
  id: string;
  name: string;
  slug: string;
  isSystem: boolean;
  active: boolean;
  documentCount: number;
}

export async function listCategories(actor: SessionUser): Promise<CategoryListItem[]> {
  const categories = await db.category.findMany({
    where: { userId: actor.id },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      isSystem: true,
      active: true,
      _count: { select: { documents: true } },
    },
  });

  return categories.map(({ _count, ...category }) => ({
    ...category,
    documentCount: _count.documents,
  }));
}

export type CategoryResult = { ok: true; id: string } | { ok: false; error: string };

export async function createCategory(
  actor: SessionUser,
  input: CategoryInput,
): Promise<CategoryResult> {
  const slug = toSlug(input.name);
  if (!slug) {
    return { ok: false, error: 'Der Name ergibt keinen gültigen Schlüssel.' };
  }

  const existing = await db.category.findFirst({
    where: { userId: actor.id, slug },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, error: 'Eine Kategorie mit diesem Namen gibt es bereits.' };
  }

  const last = await db.category.findFirst({
    where: { userId: actor.id },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  const category = await db.category.create({
    data: {
      userId: actor.id,
      name: input.name,
      slug,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
    select: { id: true },
  });

  return { ok: true, id: category.id };
}

/** Benennt um, ohne den Schluessel anzutasten. */
export async function renameCategory(
  actor: SessionUser,
  categoryId: string,
  input: CategoryInput,
): Promise<CategoryResult> {
  const updated = await db.category.updateMany({
    where: { id: categoryId, userId: actor.id },
    data: { name: input.name },
  });
  if (updated.count === 0) {
    return { ok: false, error: 'Kategorie nicht gefunden.' };
  }
  return { ok: true, id: categoryId };
}

/**
 * Blendet eine Kategorie aus. Mitgelieferte Kategorien bleiben erhalten,
 * eigene ebenfalls - an beiden koennen Dokumente haengen.
 */
export async function deactivateCategory(
  actor: SessionUser,
  categoryId: string,
): Promise<CategoryResult> {
  const updated = await db.category.updateMany({
    where: { id: categoryId, userId: actor.id },
    data: { active: false },
  });
  if (updated.count === 0) {
    return { ok: false, error: 'Kategorie nicht gefunden.' };
  }
  return { ok: true, id: categoryId };
}

export async function activateCategory(
  actor: SessionUser,
  categoryId: string,
): Promise<CategoryResult> {
  const updated = await db.category.updateMany({
    where: { id: categoryId, userId: actor.id },
    data: { active: true },
  });
  if (updated.count === 0) {
    return { ok: false, error: 'Kategorie nicht gefunden.' };
  }
  return { ok: true, id: categoryId };
}
