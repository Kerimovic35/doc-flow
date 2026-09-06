import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actorFor, resetTestDb, seedBasics, testDb } from '@/test/integration-db';

vi.mock('@/server/db', async () => {
  const { testDb: client } = await import('@/test/integration-db');
  return { db: client };
});

const { searchDocuments, availableYears } = await import('./search');

let userId: string;
let personId: string;

interface DocumentSeed {
  title?: string;
  sender?: string;
  subject?: string;
  summary?: string;
  documentDate?: string;
  personId?: string | null;
  categorySlug?: string;
  pages?: string[];
  identifier?: { kind: string; value: string; normalized: string };
  task?: boolean;
  lifecycle?: 'ACTIVE' | 'ARCHIVED' | 'DONE';
  deleted?: boolean;
  ownerId?: string;
}

async function seedDocument(seed: DocumentSeed): Promise<string> {
  const owner = seed.ownerId ?? userId;

  const category = seed.categorySlug
    ? await testDb.category.findFirst({
        where: { userId: owner, slug: seed.categorySlug },
        select: { id: true },
      })
    : null;

  const document = await testDb.document.create({
    data: {
      userId: owner,
      title: seed.title ?? null,
      sender: seed.sender ?? null,
      subject: seed.subject ?? null,
      summary: seed.summary ?? null,
      documentDate: seed.documentDate ? new Date(`${seed.documentDate}T00:00:00.000Z`) : null,
      personId: seed.personId === undefined ? null : seed.personId,
      categoryId: category?.id ?? null,
      processingStatus: 'DONE',
      lifecycle: seed.lifecycle ?? 'ACTIVE',
      deletedAt: seed.deleted ? new Date() : null,
      pageCount: seed.pages?.length ?? 0,
    },
    select: { id: true },
  });

  if (seed.pages?.length) {
    const file = await testDb.documentFile.create({
      data: {
        documentId: document.id,
        userId: owner,
        storageKey: `${owner}/${document.id}/original/f.pdf`,
        originalName: 'f.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        sha256: `h-${document.id}`,
        sortOrder: 0,
      },
      select: { id: true },
    });

    for (const [index, text] of seed.pages.entries()) {
      await testDb.documentPage.create({
        data: {
          documentId: document.id,
          userId: owner,
          fileId: file.id,
          pageNumber: index + 1,
          text,
          textSource: 'OCR',
          ocrConfidence: 95,
          thumbKey: `${owner}/${document.id}/derived/p${index}-thumb.webp`,
        },
      });
    }
  }

  if (seed.identifier) {
    await testDb.documentIdentifier.create({
      data: {
        documentId: document.id,
        userId: owner,
        kind: seed.identifier.kind,
        value: seed.identifier.value,
        normalized: seed.identifier.normalized,
        verification: 'VERIFIED',
        confidence: 95,
        source: 'AI',
      },
    });
  }

  if (seed.task) {
    await testDb.task.create({
      data: {
        userId: owner,
        documentId: document.id,
        title: 'Unterlagen einreichen',
        status: 'OPEN',
        source: 'AI',
        dueDate: new Date('2026-09-15T00:00:00.000Z'),
      },
    });
  }

  return document.id;
}

beforeEach(async () => {
  await resetTestDb();
  ({ userId, personId } = await seedBasics());
});

describe('Volltextsuche', () => {
  it('findet ein Dokument über den erkannten Seitentext', async () => {
    const id = await seedDocument({
      title: 'Bescheid',
      pages: ['Die AOK Bayern setzt Ihren Beitrag zur Krankenversicherung neu fest.'],
    });
    await seedDocument({ title: 'Mobilfunkrechnung', pages: ['Ihre Rechnung für September.'] });

    const result = await searchDocuments(actorFor(userId), 'Krankenversicherung');

    expect(result.hits.map((hit) => hit.id)).toEqual([id]);
    expect(result.total).toBe(1);
  });

  it('findet gebeugte Formen über den deutschen Wortstamm', async () => {
    // Wer "Bescheide" sucht, meint auch den einen Bescheid.
    const id = await seedDocument({ pages: ['Anbei erhalten Sie den Bescheid vom 04.09.2026.'] });

    const result = await searchDocuments(actorFor(userId), 'Bescheide');
    expect(result.hits.map((hit) => hit.id)).toEqual([id]);
  });

  it('gewichtet einen Treffer im Absender höher als einen im Fließtext', async () => {
    const beiläufig = await seedDocument({
      title: 'Kontoauszug',
      sender: 'Sparkasse München',
      pages: ['Lastschrift AOK Bayern Beitrag 127,50 EUR'],
    });
    const eigentlich = await seedDocument({
      title: 'AOK Bescheid',
      sender: 'AOK Bayern',
      pages: ['Wir setzen Ihren Beitrag neu fest.'],
    });

    const result = await searchDocuments(actorFor(userId), 'AOK');

    // Wer "AOK" sucht, will die AOK-Post oben sehen.
    expect(result.hits[0]!.id).toBe(eigentlich);
    expect(result.hits.map((hit) => hit.id)).toContain(beiläufig);
  });

  it('liefert einen Textausschnitt mit hervorgehobener Fundstelle', async () => {
    await seedDocument({
      pages: ['Bitte überweisen Sie den offenen Betrag von 127,50 EUR bis zum 12.09.2026.'],
    });

    const result = await searchDocuments(actorFor(userId), 'überweisen');

    expect(result.hits[0]!.snippet).toContain('<mark>');
    expect(result.hits[0]!.matchPage).toBe(1);
  });

  it('nennt die Seite, auf der der Treffer steht', async () => {
    await seedDocument({
      pages: ['Deckblatt ohne Inhalt.', 'Der Widerspruch ist schriftlich einzulegen.'],
    });

    const result = await searchDocuments(actorFor(userId), 'Widerspruch');
    expect(result.hits[0]!.matchPage).toBe(2);
  });

  it('findet ein Aktenzeichen exakt, auch mit anderer Schreibweise', async () => {
    const id = await seedDocument({
      title: 'Bescheid',
      identifier: { kind: 'AKTENZEICHEN', value: 'KV-2026 / 004711', normalized: 'KV2026004711' },
      pages: ['Ein Text ohne die Nummer im Fließtext.'],
    });

    // Wer eine Nummer sucht, will genau dieses Dokument.
    const result = await searchDocuments(actorFor(userId), 'kv2026004711');
    expect(result.hits.map((hit) => hit.id)).toEqual([id]);
    expect(result.identifierMatch).toBe(true);
  });

  it('verzeiht einen Tippfehler im Absender', async () => {
    const id = await seedDocument({ title: 'Police', sender: 'Allianz Versicherung' });

    // Trigramme fangen ab, woran die Wortsuche scheitert.
    const result = await searchDocuments(actorFor(userId), 'Allianz Versicherun');
    expect(result.hits.map((hit) => hit.id)).toContain(id);
  });

  it('zeigt ausgeblendete Dokumente nicht', async () => {
    await seedDocument({ title: 'Gelöschter Bescheid', deleted: true, pages: ['AOK Bayern'] });

    const result = await searchDocuments(actorFor(userId), 'AOK');
    expect(result.hits).toHaveLength(0);
  });

  it('zeigt niemals Dokumente eines fremden Kontos', async () => {
    const fremd = await seedBasics({ email: 'fremd@docflow.local', name: 'Fremd' });
    await seedDocument({
      ownerId: fremd.userId,
      title: 'Fremder Bescheid',
      pages: ['AOK Bayern Beitrag'],
    });

    const result = await searchDocuments(actorFor(userId), 'AOK');
    expect(result.hits).toHaveLength(0);
  });
});

describe('Filter', () => {
  it('grenzt auf eine Person ein', async () => {
    const meins = await seedDocument({ personId, pages: ['AOK Bayern Beitrag'] });
    await seedDocument({ personId: null, pages: ['AOK Bayern Beitrag'] });

    const result = await searchDocuments(actorFor(userId), 'AOK', { personId });
    expect(result.hits.map((hit) => hit.id)).toEqual([meins]);
  });

  it('grenzt auf eine Kategorie ein', async () => {
    const id = await seedDocument({ categorySlug: 'krankenkasse', pages: ['Beitrag'] });
    await seedDocument({ categorySlug: 'mobilfunk', pages: ['Beitrag'] });

    const category = await testDb.category.findFirstOrThrow({
      where: { userId, slug: 'krankenkasse' },
    });
    const result = await searchDocuments(actorFor(userId), 'Beitrag', {
      categoryId: category.id,
    });

    expect(result.hits.map((hit) => hit.id)).toEqual([id]);
  });

  it('grenzt auf ein Jahr ein', async () => {
    const alt = await seedDocument({ documentDate: '2025-03-01', pages: ['Beitrag'] });
    const neu = await seedDocument({ documentDate: '2026-09-04', pages: ['Beitrag'] });

    expect((await searchDocuments(actorFor(userId), 'Beitrag', { year: 2025 })).hits[0]!.id).toBe(
      alt,
    );
    expect((await searchDocuments(actorFor(userId), 'Beitrag', { year: 2026 })).hits[0]!.id).toBe(
      neu,
    );
  });

  it('findet ein Dokument ohne erkanntes Datum im Jahr seiner Erfassung', async () => {
    // Sonst verschwände es im Jahresfilter, obwohl es da ist.
    const id = await seedDocument({ pages: ['Beitrag'] });
    const jahr = new Date().getFullYear();

    const result = await searchDocuments(actorFor(userId), 'Beitrag', { year: jahr });
    expect(result.hits.map((hit) => hit.id)).toContain(id);
  });

  it('zeigt nur Dokumente mit offener Aufgabe', async () => {
    const mit = await seedDocument({ pages: ['Beitrag'], task: true });
    await seedDocument({ pages: ['Beitrag'] });

    const result = await searchDocuments(actorFor(userId), 'Beitrag', { withDeadline: true });
    expect(result.hits.map((hit) => hit.id)).toEqual([mit]);
  });

  it('listet ohne Suchbegriff alles nach Datum', async () => {
    await seedDocument({ documentDate: '2025-01-01', title: 'Alt' });
    await seedDocument({ documentDate: '2026-09-04', title: 'Neu' });

    const result = await searchDocuments(actorFor(userId), '');
    expect(result.hits.map((hit) => hit.title)).toEqual(['Neu', 'Alt']);
  });

  it('blättert stabil', async () => {
    for (let index = 0; index < 5; index += 1) {
      await seedDocument({
        title: `Bescheid ${index}`,
        documentDate: `2026-0${index + 1}-01`,
        pages: ['Beitrag zur Krankenversicherung'],
      });
    }

    const first = await searchDocuments(actorFor(userId), 'Krankenversicherung', {
      page: 1,
      pageSize: 2,
    });
    const second = await searchDocuments(actorFor(userId), 'Krankenversicherung', {
      page: 2,
      pageSize: 2,
    });

    expect(first.total).toBe(5);
    expect(first.hits).toHaveLength(2);
    expect(second.hits).toHaveLength(2);
    // Keine Überschneidung zwischen den Seiten.
    const ids = new Set([...first.hits, ...second.hits].map((hit) => hit.id));
    expect(ids.size).toBe(4);
  });

  it('nennt die Jahre, in denen wirklich Dokumente liegen', async () => {
    await seedDocument({ documentDate: '2024-05-01' });
    await seedDocument({ documentDate: '2026-09-04' });

    expect(await availableYears(actorFor(userId))).toEqual([2026, 2024]);
  });
});
