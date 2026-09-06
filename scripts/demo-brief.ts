/**
 * Legt einen Beispielbrief mit erkanntem Text und Analyseergebnis an.
 *
 * Nur fuer die Entwicklung: Ohne KI-Schluessel liesse sich die Oberflaeche
 * sonst nicht mit einem fertig analysierten Dokument ansehen. Die Daten
 * gehen denselben Weg wie echte - durch die Belegpruefung.
 *
 * Aufruf: npx tsx scripts/demo-brief.ts
 */
import 'dotenv/config';
import sharp from 'sharp';
import { createPrismaClient } from '../src/server/prisma-client';

const db = createPrismaClient(process.env.DATABASE_URL!);

const PAGES = [
  [
    'AOK Bayern - Die Gesundheitskasse',
    'Postfach 12 34, 80331 München',
    '',
    'Frau Erika Musterfrau',
    'Musterweg 5',
    '80333 München',
    '',
    'Bescheid über den Beitrag zur freiwilligen Krankenversicherung',
    'Aktenzeichen: KV-2026 / 004711',
    'Datum: 04.09.2026',
  ].join('\n'),
  [
    'Sehr geehrte Frau Musterfrau,',
    '',
    'hiermit setzen wir Ihren monatlichen Beitrag neu fest.',
    'Der Beitrag beträgt ab dem 01.10.2026 monatlich 127,50 EUR.',
    'Bitte überweisen Sie den offenen Betrag von 127,50 EUR bis zum',
    '12.09.2026 auf das Konto DE89 3704 0044 0532 0130 00.',
    '',
    'Reichen Sie außerdem die Einkommensnachweise der letzten drei',
    'Monate bis zum 15.09.2026 bei uns ein.',
    '',
    'Mit freundlichen Grüßen',
    'AOK Bayern',
  ].join('\n'),
];

async function renderPage(lines: string[]): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754">
    <rect width="100%" height="100%" fill="white"/>
    ${lines
      .map(
        (line, index) =>
          `<text x="90" y="${160 + index * 46}" font-family="Arial, Verdana" font-size="28" fill="#111">${escapeXml(line)}</text>`,
      )
      .join('\n')}
  </svg>`;

  return sharp(Buffer.from(svg)).webp({ quality: 85 }).toBuffer();
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main() {
  const user = await db.user.findFirstOrThrow({ select: { id: true } });
  const person = await db.person.findFirstOrThrow({
    where: { userId: user.id },
    select: { id: true },
  });
  const category = await db.category.findFirstOrThrow({
    where: { userId: user.id, slug: 'krankenkasse' },
    select: { id: true },
  });

  const document = await db.document.create({
    data: {
      userId: user.id,
      personId: person.id,
      categoryId: category.id,
      processingStatus: 'DONE',
      reviewState: 'NEEDED',
      pageCount: PAGES.length,
      title: 'AOK Bescheid zur freiwilligen Krankenversicherung',
      documentType: 'Bescheid',
      sender: 'AOK Bayern',
      recipient: 'Erika Musterfrau',
      subject: 'Neufestsetzung des Beitrags',
      summary:
        'Die AOK Bayern setzt den monatlichen Beitrag zur freiwilligen Krankenversicherung ab Oktober 2026 auf 127,50 EUR fest. Ein offener Betrag von 127,50 EUR ist bis zum 12.09.2026 zu überweisen. Außerdem sind Einkommensnachweise der letzten drei Monate bis zum 15.09.2026 einzureichen.',
      documentDate: new Date('2026-09-04T00:00:00.000Z'),
      analyzedAt: new Date(),
      ocrAt: new Date(),
      fieldMeta: {
        title: {
          confidence: 92,
          page: 1,
          quote: 'Bescheid über den Beitrag zur freiwilligen Krankenversicherung',
          verification: 'VERIFIED',
          source: 'AI',
        },
        sender: {
          confidence: 96,
          page: 1,
          quote: 'AOK Bayern - Die Gesundheitskasse',
          verification: 'VERIFIED',
          source: 'AI',
        },
        documentDate: {
          confidence: 97,
          page: 1,
          quote: 'Datum: 04.09.2026',
          verification: 'VERIFIED',
          source: 'AI',
        },
        documentType: { confidence: 88, page: 1, quote: 'Bescheid über den Beitrag', verification: 'QUOTE_ONLY', source: 'AI' },
        person: { confidence: 91, verification: 'QUOTE_ONLY', source: 'AI' },
        category: { confidence: 94, verification: 'QUOTE_ONLY', source: 'AI' },
        summary: { confidence: 0, verification: 'QUOTE_ONLY', source: 'AI' },
      },
    },
    select: { id: true },
  });

  const filesDir = process.env.FILES_DIR ?? './data/files';
  const { LocalStorage } = await import('../src/server/storage/local');
  const storage = new LocalStorage(filesDir);

  const file = await db.documentFile.create({
    data: {
      documentId: document.id,
      userId: user.id,
      storageKey: `${user.id}/${document.id}/original/demo.webp`,
      originalName: 'aok-bescheid.webp',
      mimeType: 'image/webp',
      sizeBytes: 0,
      sha256: 'demo',
      sortOrder: 0,
    },
    select: { id: true },
  });

  for (const [index, lines] of PAGES.entries()) {
    const image = await renderPage(lines.split('\n'));
    const page = await db.documentPage.create({
      data: {
        documentId: document.id,
        userId: user.id,
        fileId: file.id,
        pageNumber: index + 1,
        text: lines,
        textSource: 'OCR',
        ocrConfidence: 96,
        width: 1240,
        height: 1754,
      },
      select: { id: true },
    });

    const imageKey = `${user.id}/${document.id}/derived/${page.id}.webp`;
    const thumbKey = `${user.id}/${document.id}/derived/${page.id}-thumb.webp`;

    await storage.write(imageKey, new Uint8Array(image));
    await storage.write(
      thumbKey,
      new Uint8Array(await sharp(image).resize({ width: 320 }).webp({ quality: 70 }).toBuffer()),
    );
    await db.documentPage.update({ where: { id: page.id }, data: { imageKey, thumbKey } });
  }

  await db.documentIdentifier.create({
    data: {
      documentId: document.id,
      userId: user.id,
      kind: 'AKTENZEICHEN',
      value: 'KV-2026 / 004711',
      normalized: 'KV2026004711',
      page: 1,
      quote: 'Aktenzeichen: KV-2026 / 004711',
      verification: 'VERIFIED',
      confidence: 95,
      source: 'AI',
    },
  });

  await db.payment.create({
    data: {
      userId: user.id,
      documentId: document.id,
      status: 'PROPOSED',
      direction: 'OUTGOING',
      amount: '127.50',
      currency: 'EUR',
      dueDate: new Date('2026-09-12T00:00:00.000Z'),
      purpose: 'Beitrag zur freiwilligen Krankenversicherung',
      iban: 'DE89370400440532013000',
      recipient: 'AOK Bayern',
      page: 2,
      quote: 'Bitte überweisen Sie den offenen Betrag von 127,50 EUR bis zum',
      verification: 'VERIFIED',
      confidence: 94,
      source: 'AI',
      dedupeKey: '12750-2026-09-12-OUTGOING',
    },
  });

  await db.task.create({
    data: {
      userId: user.id,
      documentId: document.id,
      kind: 'TASK',
      status: 'PROPOSED',
      title: 'Einkommensnachweise der letzten drei Monate einreichen',
      dueDate: new Date('2026-09-15T00:00:00.000Z'),
      page: 2,
      quote: 'Reichen Sie außerdem die Einkommensnachweise der letzten drei',
      verification: 'QUOTE_ONLY',
      confidence: 91,
      source: 'AI',
      dedupeKey: 'TASK-EINKOMMENSNACHWEISE',
    },
  });

  console.log(`Beispielbrief angelegt: /dokumente/${document.id}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
