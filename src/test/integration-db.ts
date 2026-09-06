import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { ensureUserDefaults } from '@/server/services/defaults';

/**
 * Datenbankverbindung fuer Integrationstests.
 *
 * Bewusst eine eigene Datenbank (`docflow_test`) statt der
 * Entwicklungsdatenbank: Die Tests leeren zwischen den Durchlaeufen alle
 * Tabellen. Liefe das versehentlich gegen eine Datenbank mit echten Daten,
 * waeren diese weg.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://docflow:docflow_dev@localhost:5432/docflow_test?schema=public';

if (!/docflow_test/.test(TEST_DATABASE_URL)) {
  // Notbremse: Der Datenbankname muss "docflow_test" enthalten. Ohne diese
  // Pruefung koennte eine falsch gesetzte Umgebungsvariable die
  // Entwicklungs- oder gar Produktivdatenbank leeren.
  throw new Error(`Testdatenbank muss "docflow_test" heissen, ist aber: ${TEST_DATABASE_URL}`);
}

export const testDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
});

/**
 * Leert alle fachlichen Tabellen.
 *
 * `TRUNCATE ... CASCADE` in einer Anweisung, damit die Fremdschluessel nicht
 * in eine Reihenfolge gezwungen werden muessen.
 */
export async function resetTestDb(): Promise<void> {
  await testDb.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ai_sources", "ai_messages", "ai_conversations",
      "reminders", "payments", "tasks",
      "processing_jobs", "analysis_runs",
      "document_identifiers", "document_tags", "document_pages",
      "document_files", "documents",
      "tags", "categories", "persons",
      "user_settings", "sessions", "users", "system_state"
    RESTART IDENTITY CASCADE
  `);
}

/**
 * Legt einen Testbenutzer samt Startdaten an - denselben Weg wie der
 * Serverstart, damit Tests nicht auf einer Sonderwelt laufen.
 */
export async function seedBasics(
  overrides: { email?: string; name?: string } = {},
): Promise<{ userId: string; personId: string; categoryId: string }> {
  const user = await testDb.user.create({
    data: {
      email: overrides.email ?? 'test@docflow.local',
      name: overrides.name ?? 'Testbenutzer',
      passwordHash: 'nicht-verwendet',
      role: 'ADMIN',
    },
    select: { id: true, name: true },
  });

  await ensureUserDefaults(testDb, user.id, user.name);

  const person = await testDb.person.findFirstOrThrow({
    where: { userId: user.id },
    select: { id: true },
  });
  const category = await testDb.category.findFirstOrThrow({
    where: { userId: user.id, slug: 'behoerden' },
    select: { id: true },
  });

  return { userId: user.id, personId: person.id, categoryId: category.id };
}

/** Handlicher Akteur fuer Service-Aufrufe in Tests. */
export function actorFor(userId: string, role: 'USER' | 'ADMIN' = 'ADMIN') {
  return { id: userId, email: 'test@docflow.local', name: 'Testbenutzer', role } as const;
}
