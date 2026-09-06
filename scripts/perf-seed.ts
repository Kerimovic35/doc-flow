/**
 * Erzeugt viele Dokumente, um die Suche unter Last zu messen.
 *
 * Der Master-Anspruch lautet: auch bei mehreren tausend Dokumenten noch
 * brauchbar. Das laesst sich nicht behaupten, sondern nur messen - und zwar
 * mit Text, der echtem Briefverkehr aehnelt, nicht mit "lorem ipsum".
 *
 * Aufruf:  npx tsx scripts/perf-seed.ts [anzahl]
 * Aufräumen: npx tsx scripts/perf-seed.ts --clean
 */
import 'dotenv/config';
import { createPrismaClient } from '../src/server/prisma-client';

const db = createPrismaClient(process.env.DATABASE_URL!);

const SENDERS = [
  'AOK Bayern',
  'Techniker Krankenkasse',
  'Finanzamt München',
  'Stadtwerke München',
  'Allianz Versicherung',
  'Telekom Deutschland',
  'Deutsche Rentenversicherung',
  'Sparkasse München',
  'Bundesagentur für Arbeit',
  'Vodafone GmbH',
];

const TYPES = ['Bescheid', 'Rechnung', 'Mahnung', 'Vertrag', 'Mitteilung', 'Kontoauszug'];

const SUBJECTS = [
  'Beitrag zur Krankenversicherung',
  'Einkommensteuererklärung',
  'Jahresabrechnung',
  'Vertragsverlängerung',
  'Zahlungserinnerung',
  'Änderung der Vertragsbedingungen',
  'Nachweis über eingezahlte Beiträge',
];

function pick<T>(list: T[], index: number): T {
  return list[index % list.length]!;
}

function pageText(index: number, page: number): string {
  const sender = pick(SENDERS, index);
  const subject = pick(SUBJECTS, index * 3);
  const amount = ((index % 900) + 12.5).toFixed(2).replace('.', ',');

  if (page === 1) {
    return [
      `${sender} - Kundenservice`,
      `Postfach ${1000 + (index % 8000)}, 80331 München`,
      '',
      'Frau Erika Musterfrau, Musterweg 5, 80333 München',
      '',
      `${pick(TYPES, index)} über ${subject}`,
      `Aktenzeichen: ${pick(['KV', 'ST', 'VR', 'RN'], index)}-2026-${String(index).padStart(6, '0')}`,
      `Datum: ${String((index % 28) + 1).padStart(2, '0')}.${String((index % 12) + 1).padStart(2, '0')}.2026`,
    ].join('\n');
  }

  return [
    'Sehr geehrte Frau Musterfrau,',
    '',
    `hiermit teilen wir Ihnen mit, dass sich Ihr Beitrag zum ${subject} ändert.`,
    `Der offene Betrag beträgt ${amount} EUR und ist bis zum 15.10.2026 zu`,
    'überweisen. Bitte verwenden Sie das unten genannte Konto und geben Sie',
    'das Aktenzeichen als Verwendungszweck an.',
    '',
    'Reichen Sie außerdem die angeforderten Nachweise innerhalb von zwei',
    'Wochen bei uns ein. Andernfalls können wir Ihren Antrag nicht weiter',
    'bearbeiten.',
    '',
    'Mit freundlichen Grüßen',
    sender,
  ].join('\n');
}

async function clean(): Promise<void> {
  const deleted = await db.document.deleteMany({ where: { title: { startsWith: 'Lasttest ' } } });
  console.log(`${deleted.count} Testdokumente entfernt.`);
}

async function seed(count: number): Promise<void> {
  const user = await db.user.findFirstOrThrow({ select: { id: true } });
  const persons = await db.person.findMany({ where: { userId: user.id }, select: { id: true } });
  const categories = await db.category.findMany({
    where: { userId: user.id },
    select: { id: true },
  });

  const started = Date.now();

  for (let index = 0; index < count; index += 1) {
    const sender = pick(SENDERS, index);

    const document = await db.document.create({
      data: {
        userId: user.id,
        title: `Lasttest ${index}: ${pick(TYPES, index)} ${sender}`,
        sender,
        documentType: pick(TYPES, index),
        subject: pick(SUBJECTS, index * 3),
        summary: `Testdokument ${index} zur Messung der Suchgeschwindigkeit.`,
        documentDate: new Date(Date.UTC(2024 + (index % 3), index % 12, (index % 28) + 1)),
        personId: persons.length > 0 ? pick(persons, index).id : null,
        categoryId: categories.length > 0 ? pick(categories, index).id : null,
        processingStatus: 'DONE',
        pageCount: 2,
      },
      select: { id: true },
    });

    const file = await db.documentFile.create({
      data: {
        documentId: document.id,
        userId: user.id,
        storageKey: `${user.id}/${document.id}/original/last.pdf`,
        originalName: 'last.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1000,
        sha256: `last-${index}`,
        sortOrder: 0,
      },
      select: { id: true },
    });

    for (const page of [1, 2]) {
      await db.documentPage.create({
        data: {
          documentId: document.id,
          userId: user.id,
          fileId: file.id,
          pageNumber: page,
          text: pageText(index, page),
          textSource: 'OCR',
          ocrConfidence: 95,
        },
      });
    }

    await db.documentIdentifier.create({
      data: {
        documentId: document.id,
        userId: user.id,
        kind: 'AKTENZEICHEN',
        value: `KV-2026-${String(index).padStart(6, '0')}`,
        normalized: `KV2026${String(index).padStart(6, '0')}`,
        verification: 'VERIFIED',
        confidence: 95,
        source: 'AI',
      },
    });

    if ((index + 1) % 250 === 0) {
      console.log(`  ${index + 1} von ${count} …`);
    }
  }

  console.log(`${count} Dokumente in ${Math.round((Date.now() - started) / 1000)} s angelegt.`);
}

const argument = process.argv[2];

if (argument === '--clean') {
  await clean();
} else {
  await seed(Number(argument ?? '3000') || 3000);
}

await db.$executeRawUnsafe('ANALYZE');
console.log('Statistiken aktualisiert.');
process.exit(0);
