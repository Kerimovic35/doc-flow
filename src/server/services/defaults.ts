import { SEED_CATEGORIES, SELF_PERSON_NAME } from '@/lib/seed-data';
import type { Tx } from '@/server/db';

/**
 * Legt Kategorien, die eigene Person und die Voreinstellungen eines Benutzers
 * an, soweit sie fehlen. Idempotent - mehrfaches Aufrufen aendert nichts.
 *
 * Bewusst in einer eigenen Datei mit ausschliesslich Typ-Import auf
 * `@/server/db`: Serverstart, Seed-Skript UND die Testhilfe brauchen diese
 * Funktion. Wuerde sie den Datenbank-Client als Wert importieren, entstuende
 * in den Integrationstests ein Kreis - dort wird `@/server/db` ersetzt, und
 * die Ersetzung laedt ihrerseits die Testhilfe.
 */
export async function ensureUserDefaults(
  tx: Tx,
  userId: string,
  userName: string,
): Promise<{ categories: number; persons: number }> {
  let categories = 0;
  let persons = 0;

  const existingSlugs = new Set(
    (await tx.category.findMany({ where: { userId }, select: { slug: true } })).map((c) => c.slug),
  );

  for (const [index, category] of SEED_CATEGORIES.entries()) {
    if (existingSlugs.has(category.slug)) continue;
    await tx.category.create({
      data: {
        userId,
        slug: category.slug,
        name: category.name,
        sortOrder: index,
        isSystem: true,
      },
    });
    categories += 1;
  }

  const personCount = await tx.person.count({ where: { userId } });
  if (personCount === 0) {
    await tx.person.create({
      data: {
        userId,
        // Der eigene Name ist als Bezeichnung hilfreicher als "Ich", sobald
        // die KI Dokumente zuordnen soll: Im Brief steht der Name, nicht das
        // Pronomen.
        name: userName || SELF_PERSON_NAME,
        kind: 'SELF',
        sortOrder: 0,
      },
    });
    persons += 1;
  }

  await tx.userSettings.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });

  return { categories, persons };
}
