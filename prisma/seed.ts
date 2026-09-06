/**
 * Startdaten fuer die lokale Entwicklung.
 *
 * Idempotent: mehrfaches Ausfuehren aendert nichts. Legt einen Zugang und die
 * mitgelieferten Kategorien an - Dokumente entstehen ausschliesslich ueber
 * den regulaeren Weg, damit auch die Entwicklungsdaten die Verarbeitungskette
 * durchlaufen haben.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { hashPassword } from '../src/server/auth/password';
import { ensureUserDefaults } from '../src/server/services/defaults';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL ist nicht gesetzt.');
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const EMAIL = process.env.SEED_EMAIL ?? 'masterk1057@gmail.com';
const NAME = process.env.SEED_NAME ?? 'Kerim';
const PASSWORD = process.env.SEED_PASSWORD ?? 'docflow-start-2026';

async function main() {
  const passwordHash = await hashPassword(PASSWORD);

  const user = await db.user.upsert({
    where: { email: EMAIL },
    create: { email: EMAIL, name: NAME, passwordHash, role: 'ADMIN' },
    // Vorhandenes Passwort nicht ueberschreiben: Wer das Skript erneut
    // laufen laesst, will Startdaten nachziehen, nicht ausgesperrt werden.
    update: { name: NAME },
    select: { id: true, name: true },
  });

  const created = await ensureUserDefaults(db, user.id, user.name);

  console.log(`Benutzer: ${EMAIL}`);
  console.log(`Kategorien neu: ${created.categories}, Personen neu: ${created.persons}`);
  console.log(`Passwort (nur Entwicklung): ${PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
