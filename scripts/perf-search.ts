/**
 * Misst die Suche unter Last.
 *
 * Aufruf: npx tsx scripts/perf-search.ts
 */
import 'dotenv/config';
import { createPrismaClient } from '../src/server/prisma-client';
import { searchDocuments } from '../src/server/services/search';
import { getDashboard } from '../src/server/services/dashboard';

const db = createPrismaClient(process.env.DATABASE_URL!);

const user = await db.user.findFirstOrThrow({ select: { id: true, email: true, name: true } });
const actor = { id: user.id, email: user.email, name: user.name, role: 'ADMIN' as const };

const total = await db.document.count({ where: { userId: user.id, deletedAt: null } });
const pages = await db.documentPage.count({ where: { userId: user.id } });
console.log(`Bestand: ${total} Dokumente, ${pages} Seiten\n`);

async function measure(label: string, run: () => Promise<number>): Promise<void> {
  // Einmal warmlaufen, damit nicht der erste Verbindungsaufbau gemessen wird.
  await run();

  const runs: number[] = [];
  let hits = 0;

  for (let index = 0; index < 5; index += 1) {
    const started = performance.now();
    hits = await run();
    runs.push(performance.now() - started);
  }

  runs.sort((a, b) => a - b);
  const median = runs[Math.floor(runs.length / 2)]!;
  console.log(
    `${label.padEnd(42)} ${median.toFixed(0).padStart(5)} ms   (${hits} Treffer, langsamster ${runs.at(-1)!.toFixed(0)} ms)`,
  );
}

await measure('Wortsuche "Krankenversicherung"', async () => {
  const result = await searchDocuments(actor, 'Krankenversicherung');
  return result.total;
});

await measure('Wortsuche "Beitrag überweisen"', async () => {
  const result = await searchDocuments(actor, 'Beitrag überweisen');
  return result.total;
});

await measure('Häufiges Wort "Betrag"', async () => {
  const result = await searchDocuments(actor, 'Betrag');
  return result.total;
});

await measure('Aktenzeichen exakt', async () => {
  const result = await searchDocuments(actor, 'KV2026001500');
  return result.total;
});

await measure('Tippfehler im Absender', async () => {
  const result = await searchDocuments(actor, 'Allianz Versicherun');
  return result.total;
});

await measure('Mit Filtern (Jahr + Frist)', async () => {
  const result = await searchDocuments(actor, 'Beitrag', { year: 2025, withDeadline: true });
  return result.total;
});

await measure('Letzte Seite der Trefferliste', async () => {
  const result = await searchDocuments(actor, 'Betrag', { page: 40 });
  return result.hits.length;
});

await measure('Liste ohne Suchbegriff', async () => {
  const result = await searchDocuments(actor, '');
  return result.total;
});

await measure('Startbildschirm', async () => {
  const data = await getDashboard(actor);
  return data.documentCount;
});

console.log('\nAusführungsplan der Wortsuche:');
const plan = await db.$queryRawUnsafe<Array<Record<string, string>>>(
  `EXPLAIN (ANALYZE, BUFFERS)
   SELECT d."id"
   FROM "documents" d
   WHERE d."user_id" = $1 AND d."deleted_at" IS NULL
     AND (d."search_vector" @@ websearch_to_tsquery('german', $2)
       OR EXISTS (SELECT 1 FROM "document_pages" p
                  WHERE p."document_id" = d."id"
                    AND p."search_vector" @@ websearch_to_tsquery('german', $2)))
   ORDER BY d."created_at" DESC LIMIT 20`,
  user.id,
  'Krankenversicherung',
);

for (const row of plan) console.log('  ' + Object.values(row)[0]);

process.exit(0);
