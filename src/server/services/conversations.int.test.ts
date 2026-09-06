import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actorFor, resetTestDb, seedBasics, testDb } from '@/test/integration-db';
import { FakeAiProvider } from '@/test/fake-ai';
import { NOTHING_FOUND_TEXT, type ChatAnswer } from '@/lib/ai/chat-schema';

vi.mock('@/server/db', async () => {
  const { testDb: client } = await import('@/test/integration-db');
  return { db: client };
});

const { ask, getConversation, listConversations, deleteConversation } = await import(
  './conversations'
);
const { setAiProvider } = await import('@/server/ai/registry');

const PAGE_1 = 'AOK Bayern - Die Gesundheitskasse\nBescheid vom 04.09.2026';
const PAGE_2 =
  'Bitte überweisen Sie den offenen Betrag von 127,50 EUR bis zum 12.09.2026 auf unser Konto.';

let userId: string;
let documentId: string;

beforeEach(async () => {
  await resetTestDb();
  ({ userId } = await seedBasics());
  process.env.ANTHROPIC_API_KEY = 'test-schluessel';

  const document = await testDb.document.create({
    data: {
      userId,
      title: 'AOK Bescheid',
      sender: 'AOK Bayern',
      processingStatus: 'DONE',
      pageCount: 2,
    },
    select: { id: true },
  });
  documentId = document.id;

  const file = await testDb.documentFile.create({
    data: {
      documentId,
      userId,
      storageKey: `${userId}/${documentId}/original/f.pdf`,
      originalName: 'f.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      sha256: 'h',
      sortOrder: 0,
    },
    select: { id: true },
  });

  for (const [index, text] of [PAGE_1, PAGE_2].entries()) {
    await testDb.documentPage.create({
      data: {
        documentId,
        userId,
        fileId: file.id,
        pageNumber: index + 1,
        text,
        textSource: 'OCR',
        ocrConfidence: 96,
      },
    });
  }
});

afterEach(() => setAiProvider(null));

/** Ein Anbieter, der erst liest und dann antwortet. */
function providerThatReads(answer: ChatAnswer, pages: number[] = [2]): FakeAiProvider {
  const provider = new FakeAiProvider();
  provider.toolPlan = [
    { name: 'search_documents', input: { query: 'AOK' } },
    { name: 'get_document_pages', input: { documentId, pages } },
  ];
  provider.chatAnswer = answer;
  return provider;
}

describe('Assistent', () => {
  it('beantwortet eine Frage mit geprüftem Beleg', async () => {
    setAiProvider(
      providerThatReads({
        facts: [
          {
            statement: 'Der offene Betrag beträgt 127,50 EUR.',
            documentId,
            page: 2,
            quote: 'den offenen Betrag von 127,50 EUR',
          },
        ],
        interpretation: null,
        notFound: [],
        answer: 'Du musst 127,50 EUR bis zum 12.09.2026 überweisen [F1].',
      }),
    );

    const result = await ask(actorFor(userId), { question: 'Was muss ich der AOK zahlen?' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.message.content).toContain('127,50');
    expect(result.message.sources).toHaveLength(1);
    expect(result.message.sources[0]!.page).toBe(2);
    // Gespeichert wird das Zitat, wie es im Text steht - nicht, wie das
    // Modell es geschrieben hat.
    expect(result.message.sources[0]!.quote).toContain('127,50 EUR');
    expect(result.message.sources[0]!.documentTitle).toBe('AOK Bescheid');
  });

  it('entfernt eine Behauptung über eine nie gelesene Seite', async () => {
    // Das Modell liest Seite 2, beruft sich aber auf Seite 1.
    setAiProvider(
      providerThatReads(
        {
          facts: [
            {
              statement: 'Der Bescheid stammt vom 04.09.2026.',
              documentId,
              page: 1,
              quote: 'Bescheid vom 04.09.2026',
            },
          ],
          interpretation: null,
          notFound: [],
          answer: 'Der Bescheid ist vom 04.09.2026 [F1].',
        },
        [2],
      ),
    );

    const result = await ask(actorFor(userId), { question: 'Von wann ist der Bescheid?' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Was nicht gelesen wurde, kann nicht belegt werden.
    expect(result.message.sources).toHaveLength(0);
    expect(result.message.content).toBe(NOTHING_FOUND_TEXT);
  });

  it('entfernt ein erfundenes Zitat von einer gelesenen Seite', async () => {
    setAiProvider(
      providerThatReads({
        facts: [
          {
            statement: 'Es fällt eine Mahngebühr an.',
            documentId,
            page: 2,
            quote: 'Bei Zahlungsverzug berechnen wir eine Mahngebühr von 5,00 EUR',
          },
        ],
        interpretation: null,
        notFound: [],
        answer: 'Bei verspäteter Zahlung wird eine Mahngebühr von 5 EUR fällig [F1].',
      }),
    );

    const result = await ask(actorFor(userId), { question: 'Was passiert bei Verzug?' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.sources).toHaveLength(0);
    expect(result.message.content).toBe(NOTHING_FOUND_TEXT);
  });

  it('behält die Deutung getrennt von den Fakten', async () => {
    setAiProvider(
      providerThatReads({
        facts: [
          {
            statement: 'Der offene Betrag beträgt 127,50 EUR.',
            documentId,
            page: 2,
            quote: 'den offenen Betrag von 127,50 EUR',
          },
        ],
        interpretation:
          'Vermutlich handelt es sich um die übliche jährliche Beitragsanpassung. Das steht so nicht im Schreiben.',
        notFound: [],
        answer: 'Du musst 127,50 EUR zahlen [F1].',
      }),
    );

    const result = await ask(actorFor(userId), { question: 'Warum dieser Betrag?' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.interpretation).toContain('Vermutlich');
    // Die Deutung steht nicht im Antworttext, sondern getrennt.
    expect(result.message.content).not.toContain('Vermutlich');
  });

  it('hält eine ehrliche Fehlanzeige fest', async () => {
    const provider = new FakeAiProvider();
    provider.toolPlan = [{ name: 'search_documents', input: { query: 'Mobilfunk' } }];
    provider.chatAnswer = {
      facts: [],
      interpretation: null,
      notFound: ['Mobilfunkvertrag'],
      answer: 'Zu einem Mobilfunkvertrag habe ich nichts gefunden.',
    };
    setAiProvider(provider);

    const result = await ask(actorFor(userId), { question: 'Wann läuft mein Handyvertrag aus?' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.content).toContain('nichts gefunden');
    expect(result.message.notFound).toEqual(['Mobilfunkvertrag']);
  });

  it('speichert die Frage auch dann, wenn die Antwort scheitert', async () => {
    const provider = new FakeAiProvider();
    provider.chatAnswer = new Error('Netz weg');
    setAiProvider(provider);

    const result = await ask(actorFor(userId), { question: 'Was ist offen?' });

    expect(result.ok).toBe(false);
    // Der Verlauf soll zeigen, was gefragt wurde.
    const messages = await testDb.aiMessage.findMany({ where: { userId } });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('USER');
  });

  it('führt das Gespräch fort und behält den Verlauf', async () => {
    setAiProvider(
      providerThatReads({
        facts: [],
        interpretation: null,
        notFound: [],
        answer: 'Kurz und knapp.',
      }),
    );

    const first = await ask(actorFor(userId), { question: 'Erste Frage?' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await ask(actorFor(userId), {
      question: 'Und nachgefragt?',
      conversationId: first.conversationId,
    });
    expect(second.ok).toBe(true);

    const conversation = await getConversation(actorFor(userId), first.conversationId);
    expect(conversation?.messages).toHaveLength(4);
    // Der Titel stammt aus der ersten Frage.
    expect(conversation?.title).toBe('Erste Frage?');
  });

  it('gibt dem Dokument-Chat alle Seiten dieses Dokuments', async () => {
    const provider = new FakeAiProvider();
    // Ohne Werkzeugaufruf: Beim Dokument-Chat liegen die Seiten von
    // vornherein vor.
    provider.chatAnswer = {
      facts: [
        {
          statement: 'Der Bescheid stammt vom 04.09.2026.',
          documentId,
          page: 1,
          quote: 'Bescheid vom 04.09.2026',
        },
      ],
      interpretation: null,
      notFound: [],
      answer: 'Der Bescheid ist vom 04.09.2026 [F1].',
    };
    setAiProvider(provider);

    const result = await ask(actorFor(userId), {
      question: 'Von wann ist das Schreiben?',
      documentId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.sources).toHaveLength(1);
    expect(result.message.sources[0]!.page).toBe(1);
  });

  it('lässt kein fremdes Dokument in den Dokument-Chat', async () => {
    const fremd = await seedBasics({ email: 'fremd@docflow.local', name: 'Fremd' });
    const fremdesDokument = await testDb.document.create({
      data: { userId: fremd.userId, title: 'Fremd' },
      select: { id: true },
    });

    setAiProvider(new FakeAiProvider());

    const result = await ask(actorFor(userId), {
      question: 'Worum geht es?',
      documentId: fremdesDokument.id,
    });

    expect(result.ok).toBe(false);
  });

  it('antwortet nicht, wenn die KI abgeschaltet ist', async () => {
    await testDb.userSettings.update({ where: { userId }, data: { aiEnabled: false } });

    const provider = new FakeAiProvider();
    setAiProvider(provider);

    const result = await ask(actorFor(userId), { question: 'Was ist offen?' });

    expect(result.ok).toBe(false);
    expect(provider.chatCalls).toBe(0);
  });

  it('zeigt und löscht Gespräche nur im eigenen Konto', async () => {
    setAiProvider(
      providerThatReads({ facts: [], interpretation: null, notFound: [], answer: 'Antwort.' }),
    );
    const result = await ask(actorFor(userId), { question: 'Frage?' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const fremd = await seedBasics({ email: 'fremd@docflow.local', name: 'Fremd' });

    expect(await listConversations(actorFor(fremd.userId))).toHaveLength(0);
    expect(await getConversation(actorFor(fremd.userId), result.conversationId)).toBeNull();
    expect((await deleteConversation(actorFor(fremd.userId), result.conversationId)).ok).toBe(false);

    expect(await listConversations(actorFor(userId))).toHaveLength(1);
    expect((await deleteConversation(actorFor(userId), result.conversationId)).ok).toBe(true);
  });

  it('lässt die Werkzeuge niemals in fremde Dokumente sehen', async () => {
    const fremd = await seedBasics({ email: 'fremd@docflow.local', name: 'Fremd' });
    const fremdesDokument = await testDb.document.create({
      data: { userId: fremd.userId, title: 'Fremder Bescheid', processingStatus: 'DONE' },
      select: { id: true },
    });
    const fremdeDatei = await testDb.documentFile.create({
      data: {
        documentId: fremdesDokument.id,
        userId: fremd.userId,
        storageKey: 'x',
        originalName: 'x',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        sha256: 'x',
        sortOrder: 0,
      },
      select: { id: true },
    });
    await testDb.documentPage.create({
      data: {
        documentId: fremdesDokument.id,
        userId: fremd.userId,
        fileId: fremdeDatei.id,
        pageNumber: 1,
        text: 'Streng vertraulicher fremder Inhalt mit Betrag 999,00 EUR',
        textSource: 'OCR',
      },
    });

    const provider = new FakeAiProvider();
    // Das Modell versucht, die Seite eines fremden Dokuments zu lesen.
    provider.toolPlan = [
      { name: 'get_document_pages', input: { documentId: fremdesDokument.id, pages: [1] } },
    ];
    provider.chatAnswer = {
      facts: [
        {
          statement: 'Es geht um 999,00 EUR.',
          documentId: fremdesDokument.id,
          page: 1,
          quote: 'Streng vertraulicher fremder Inhalt mit Betrag 999,00 EUR',
        },
      ],
      interpretation: null,
      notFound: [],
      answer: 'Der Betrag lautet 999,00 EUR [F1].',
    };
    setAiProvider(provider);

    const result = await ask(actorFor(userId), { question: 'Welcher Betrag?' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Das Werkzeug hat nichts geliefert, also gibt es nichts zu belegen.
    expect(result.message.sources).toHaveLength(0);
    expect(result.message.content).toBe(NOTHING_FOUND_TEXT);
  });
});
