import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTestDb, seedBasics, testDb } from '@/test/integration-db';
import { emptyAnalysis, FakeAiProvider } from '@/test/fake-ai';
import type { AnalysisOutput } from '@/lib/ai/analysis-schema';

vi.mock('@/server/db', async () => {
  const { testDb: client } = await import('@/test/integration-db');
  return { db: client };
});

let filesRoot: string;

beforeAll(async () => {
  filesRoot = await mkdtemp(path.join(tmpdir(), 'docflow-analyze-'));
  process.env.FILES_DIR = filesRoot;
});

afterAll(async () => {
  await rm(filesRoot, { recursive: true, force: true });
});

const { runAnalyze } = await import('./analyze');
const { setAiProvider } = await import('@/server/ai/registry');
const { AiRefusalError } = await import('@/server/ai/provider');
const { PermanentJobError } = await import('@/server/jobs/types');

/** Der Seitentext, gegen den jeder Beleg geprüft wird. */
const PAGE_1 = [
  'AOK Bayern - Die Gesundheitskasse',
  'Bescheid über den Beitrag zur freiwilligen Krankenversicherung',
  'Aktenzeichen: KV-2026 / 004711',
  'Datum: 04.09.2026',
].join('\n');

const PAGE_2 = [
  'Der Beitrag beträgt ab dem 01.10.2026 monatlich 127,50 EUR.',
  'Bitte überweisen Sie den offenen Betrag bis zum 12.09.2026.',
  'Reichen Sie die Einkommensnachweise bis zum 15.09.2026 ein.',
].join('\n');

let userId: string;
let personId: string;
let documentId: string;

beforeEach(async () => {
  await resetTestDb();
  ({ userId, personId } = await seedBasics());
  process.env.ANTHROPIC_API_KEY = 'test-schluessel';

  const document = await testDb.document.create({
    data: { userId, processingStatus: 'ANALYZING', pageCount: 2 },
    select: { id: true },
  });
  documentId = document.id;

  const file = await testDb.documentFile.create({
    data: {
      documentId,
      userId,
      storageKey: `${userId}/${documentId}/original/f1.pdf`,
      originalName: 'bescheid.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      sha256: 'x',
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
        ocrConfidence: 95,
      },
    });
  }
});

afterEach(() => setAiProvider(null));

/** Eine vollständige, ehrliche Antwort - alles davon steht im Text. */
function honestAnalysis(overrides: Partial<AnalysisOutput> = {}): AnalysisOutput {
  return {
    ...emptyAnalysis(),
    title: {
      value: 'AOK Bescheid Krankenversicherung',
      confidence: 92,
      evidence: { page: 1, quote: 'Bescheid über den Beitrag zur freiwilligen Krankenversicherung' },
    },
    sender: {
      value: 'AOK Bayern',
      confidence: 96,
      evidence: { page: 1, quote: 'AOK Bayern - Die Gesundheitskasse' },
    },
    documentDate: {
      value: '2026-09-04',
      confidence: 97,
      evidence: { page: 1, quote: 'Datum: 04.09.2026' },
    },
    person: { personId, confidence: 88, uncertain: false, reasoning: 'Empfänger genannt' },
    category: { slug: 'krankenkasse', confidence: 90 },
    identifiers: [
      {
        kind: 'AKTENZEICHEN',
        value: 'KV-2026 / 004711',
        confidence: 95,
        evidence: { page: 1, quote: 'Aktenzeichen: KV-2026 / 004711' },
      },
    ],
    payments: [
      {
        amount: '127.50',
        currency: 'EUR',
        direction: 'OUTGOING',
        due: { kind: 'absolute', date: '2026-09-12' },
        purpose: 'Beitrag Krankenversicherung',
        iban: null,
        recipient: 'AOK Bayern',
        confidence: 94,
        evidence: { page: 2, quote: 'Der Beitrag beträgt ab dem 01.10.2026 monatlich 127,50 EUR.' },
      },
    ],
    tasks: [
      {
        title: 'Einkommensnachweise einreichen',
        description: null,
        due: { kind: 'absolute', date: '2026-09-15' },
        confidence: 91,
        evidence: { page: 2, quote: 'Reichen Sie die Einkommensnachweise bis zum 15.09.2026 ein.' },
      },
    ],
    summary: 'Die AOK setzt den Beitrag neu fest und verlangt Einkommensnachweise.',
    ...overrides,
  };
}

describe('Analyse eines Dokuments', () => {
  it('übernimmt belegte Angaben mit Fundstelle', async () => {
    setAiProvider(new FakeAiProvider(() => honestAnalysis()));

    await runAnalyze(documentId);

    const document = await testDb.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.title).toBe('AOK Bescheid Krankenversicherung');
    expect(document.sender).toBe('AOK Bayern');
    expect(document.documentDate?.toISOString().slice(0, 10)).toBe('2026-09-04');
    expect(document.personId).toBe(personId);
    expect(document.processingStatus).toBe('DONE');
    expect(document.analyzedAt).not.toBeNull();

    const meta = document.fieldMeta as Record<string, { verification: string; page: number }>;
    expect(meta.sender?.verification).toBe('VERIFIED');
    expect(meta.sender?.page).toBe(1);
  });

  it('verwirft eine erfundene Angabe nicht stillschweigend, sondern markiert sie', async () => {
    // Der Kern des Halluzinationsschutzes: Der Satz klingt wie aus einem
    // Bescheid, steht aber nicht im Text.
    setAiProvider(
      new FakeAiProvider(() =>
        honestAnalysis({
          sender: {
            value: 'Techniker Krankenkasse',
            confidence: 99,
            evidence: {
              page: 1,
              quote: 'Techniker Krankenkasse - Ihre Kasse für Gesundheit',
            },
          },
        }),
      ),
    );

    await runAnalyze(documentId);

    const document = await testDb.document.findUniqueOrThrow({ where: { id: documentId } });
    const meta = document.fieldMeta as Record<string, { verification: string; confidence: number }>;

    expect(meta.sender?.verification).toBe('UNVERIFIED');
    // Trotz behaupteter 99 Prozent.
    expect(meta.sender?.confidence).toBeLessThanOrEqual(30);
    expect(document.reviewState).toBe('NEEDED');
  });

  it('nimmt keine Zahlung an, deren Betrag nicht im Zitat steht', async () => {
    // Eine echte Textstelle mit einem Betrag, der dort nicht steht - der
    // gefährlichste Fall, weil er wie ein Beleg aussieht.
    setAiProvider(
      new FakeAiProvider(() =>
        honestAnalysis({
          payments: [
            {
              amount: '1275.00',
              currency: 'EUR',
              direction: 'OUTGOING',
              due: { kind: 'absolute', date: '2026-09-12' },
              purpose: null,
              iban: null,
              recipient: null,
              confidence: 96,
              evidence: {
                page: 2,
                quote: 'Der Beitrag beträgt ab dem 01.10.2026 monatlich 127,50 EUR.',
              },
            },
          ],
        }),
      ),
    );

    await runAnalyze(documentId);

    // Lieber keine Zahlungsübersicht als eine erfundene.
    expect(await testDb.payment.count({ where: { documentId } })).toBe(0);
  });

  it('legt Zahlungen und Aufgaben nur als Vorschlag an', async () => {
    setAiProvider(new FakeAiProvider(() => honestAnalysis()));

    await runAnalyze(documentId);

    const payment = await testDb.payment.findFirstOrThrow({ where: { documentId } });
    expect(payment.status).toBe('PROPOSED');
    expect(payment.amount.toString()).toBe('127.5');
    expect(payment.dueDate?.toISOString().slice(0, 10)).toBe('2026-09-12');

    const task = await testDb.task.findFirstOrThrow({ where: { documentId } });
    expect(task.status).toBe('PROPOSED');
    expect(task.title).toBe('Einkommensnachweise einreichen');
    expect(task.quote).toContain('Einkommensnachweise');

    // Vorschläge zählen nicht mit - deshalb will das Dokument geprüft werden.
    const document = await testDb.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.reviewState).toBe('NEEDED');
  });

  it('rechnet eine relative Frist selbst aus und kennzeichnet sie als unsicher', async () => {
    setAiProvider(
      new FakeAiProvider(() =>
        honestAnalysis({
          tasks: [
            {
              title: 'Widerspruch einlegen',
              description: null,
              due: {
                kind: 'relative',
                amount: 2,
                unit: 'WEEKS',
                anchor: 'DOCUMENT_DATE',
              },
              confidence: 85,
              evidence: {
                page: 2,
                quote: 'Reichen Sie die Einkommensnachweise bis zum 15.09.2026 ein.',
              },
            },
          ],
        }),
      ),
    );

    // Das Dokumentdatum ist der Bezugspunkt.
    await testDb.document.update({
      where: { id: documentId },
      data: { documentDate: new Date('2026-09-04T00:00:00.000Z') },
    });

    await runAnalyze(documentId);

    const task = await testDb.task.findFirstOrThrow({ where: { documentId } });
    expect(task.dueDate?.toISOString().slice(0, 10)).toBe('2026-09-18');
    // Der Bezugspunkt ist eine Annahme - das muss der Benutzer sehen.
    expect(task.dueUncertain).toBe(true);
    expect(task.dueRule).toContain('04.09.2026');
  });

  it('lässt vom Benutzer gesetzte Felder unangetastet', async () => {
    await testDb.document.update({
      where: { id: documentId },
      data: {
        sender: 'Von Hand eingetragen',
        fieldMeta: { sender: { source: 'USER', verification: 'USER', confidence: 100 } },
      },
    });

    setAiProvider(new FakeAiProvider(() => honestAnalysis()));
    await runAnalyze(documentId, { reason: 'reanalyze' });

    const document = await testDb.document.findUniqueOrThrow({ where: { id: documentId } });
    // Eine Korrektur, die die nächste Analyse überschreibt, ist keine.
    expect(document.sender).toBe('Von Hand eingetragen');
    // Andere Felder werden sehr wohl gefüllt.
    expect(document.title).toBe('AOK Bescheid Krankenversicherung');
  });

  it('erzeugt bei einer zweiten Analyse keine doppelten Vorschläge', async () => {
    setAiProvider(new FakeAiProvider(() => honestAnalysis()));

    await runAnalyze(documentId);
    await runAnalyze(documentId, { reason: 'reanalyze' });

    expect(await testDb.payment.count({ where: { documentId } })).toBe(1);
    expect(await testDb.task.count({ where: { documentId } })).toBe(1);
    expect(await testDb.documentIdentifier.count({ where: { documentId } })).toBe(1);
  });

  it('rührt eine bestätigte Aufgabe bei erneuter Analyse nicht an', async () => {
    setAiProvider(new FakeAiProvider(() => honestAnalysis()));
    await runAnalyze(documentId);

    const task = await testDb.task.findFirstOrThrow({ where: { documentId } });
    await testDb.task.update({
      where: { id: task.id },
      data: { status: 'DONE', title: 'Vom Benutzer umbenannt' },
    });

    await runAnalyze(documentId, { reason: 'reanalyze' });

    const after = await testDb.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.status).toBe('DONE');
    expect(after.title).toBe('Vom Benutzer umbenannt');
  });

  it('überspringt eine erneute Analyse bei unverändertem Text', async () => {
    const provider = new FakeAiProvider(() => honestAnalysis());
    setAiProvider(provider);

    await runAnalyze(documentId);
    await runAnalyze(documentId);

    // Gleicher Text, gleiches Ergebnis - ein zweiter Lauf kostet nur Geld.
    expect(provider.calls).toBe(1);
  });

  it('legt ein Dokument zur Prüfung vor, wenn die Person unsicher ist', async () => {
    setAiProvider(
      new FakeAiProvider(() =>
        honestAnalysis({
          person: { personId, confidence: 40, uncertain: true, reasoning: 'zwei Namen genannt' },
        }),
      ),
    );

    await runAnalyze(documentId);

    const document = await testDb.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.personUncertain).toBe(true);
    expect(document.reviewState).toBe('NEEDED');
  });

  it('übernimmt keine fremde Personen-ID', async () => {
    const fremd = await seedBasics({ email: 'fremd@docflow.local', name: 'Fremd' });
    const fremdePerson = await testDb.person.findFirstOrThrow({ where: { userId: fremd.userId } });

    setAiProvider(
      new FakeAiProvider(() =>
        honestAnalysis({
          person: {
            personId: fremdePerson.id,
            confidence: 95,
            uncertain: false,
            reasoning: '',
          },
        }),
      ),
    );

    await runAnalyze(documentId);

    const document = await testDb.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.personId).toBeNull();
  });

  it('verliert bei einer Ablehnung der KI nichts', async () => {
    setAiProvider(
      new FakeAiProvider(() => new AiRefusalError('Bearbeitung abgelehnt', 'test')),
    );

    await expect(runAnalyze(documentId)).rejects.toBeInstanceOf(PermanentJobError);

    // Der erkannte Text und die Seiten sind unberührt.
    const pages = await testDb.documentPage.findMany({ where: { documentId } });
    expect(pages).toHaveLength(2);
    expect(pages[0]!.text).toContain('AOK');

    const run = await testDb.analysisRun.findFirstOrThrow({
      where: { documentId, kind: 'ANALYSIS' },
    });
    expect(run.status).toBe('FAILED');
  });

  it('bricht ab, wenn kein erkannter Text vorliegt', async () => {
    await testDb.documentPage.updateMany({
      where: { documentId },
      data: { text: null, textSource: 'NONE' },
    });

    setAiProvider(new FakeAiProvider(() => honestAnalysis()));

    await expect(runAnalyze(documentId)).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('hält Verbrauch und Kosten im Protokoll fest', async () => {
    setAiProvider(new FakeAiProvider(() => honestAnalysis()));

    await runAnalyze(documentId);

    const run = await testDb.analysisRun.findFirstOrThrow({
      where: { documentId, kind: 'ANALYSIS' },
    });
    expect(run.status).toBe('SUCCEEDED');
    expect(run.inputTokens).toBe(1200);
    expect(run.costCents).toBe(2);
    expect(run.model).toBe('claude-opus-5');
  });

  it('macht nichts, wenn die KI abgeschaltet ist', async () => {
    await testDb.userSettings.update({ where: { userId }, data: { aiEnabled: false } });

    const provider = new FakeAiProvider(() => honestAnalysis());
    setAiProvider(provider);

    await runAnalyze(documentId);

    expect(provider.calls).toBe(0);
    const document = await testDb.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.processingStatus).toBe('DONE');
    // Ohne Analyse muss der Benutzer die Angaben selbst nachtragen.
    expect(document.reviewState).toBe('NEEDED');
  });

  it('nimmt eine Nummer ohne Fundstelle nicht auf', async () => {
    setAiProvider(
      new FakeAiProvider(() =>
        honestAnalysis({
          identifiers: [
            {
              kind: 'KUNDENNUMMER',
              value: 'A987654321',
              confidence: 90,
              evidence: { page: 1, quote: 'Kundennummer: A987654321 im Kundenportal' },
            },
          ],
        }),
      ),
    );

    await runAnalyze(documentId);

    // Nach Nummern wird später gesucht - eine erfundene wäre schlimmer als
    // eine fehlende.
    expect(await testDb.documentIdentifier.count({ where: { documentId } })).toBe(0);
  });
});
