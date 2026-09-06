import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { actorFor, resetTestDb, seedBasics, testDb } from '@/test/integration-db';
import { makeImage } from '@/test/fixtures';
import type { OcrPageResult, OcrProvider } from '@/server/ocr/provider';

vi.mock('@/server/db', async () => {
  const { testDb: client } = await import('@/test/integration-db');
  return { db: client };
});

let filesRoot: string;

beforeAll(async () => {
  filesRoot = await mkdtemp(path.join(tmpdir(), 'docflow-ocrpipe-'));
  process.env.FILES_DIR = filesRoot;
});

afterAll(async () => {
  await rm(filesRoot, { recursive: true, force: true });
});

const { runOcr } = await import('./ocr');
const { runIngest } = await import('./ingest');
const { createDocument, addFile } = await import('@/server/services/documents');
const { setOcrProvider } = await import('@/server/ocr/tesseract');
const { OcrUnavailableError } = await import('@/server/ocr/provider');

/**
 * Erkennung ohne Tesseract.
 *
 * Die Pipeline soll geprueft werden, nicht der Erkennungsmotor - der hat
 * seine eigenen Tests. Mit einem steuerbaren Anbieter lassen sich Faelle
 * herstellen, die mit echten Bildern kaum reproduzierbar waeren: eine
 * einzelne unlesbare Seite, ein Absturz mittendrin, ein Ausfall des ganzen
 * Verfahrens.
 */
class FakeOcr implements OcrProvider {
  readonly name = 'fake';
  calls: number[] = [];

  constructor(
    private readonly behaviour: (call: number) => OcrPageResult | Error = () => ({
      text: 'Erkannter Text',
      confidence: 92,
    }),
    private readonly isAvailable = true,
  ) {}

  async available(): Promise<boolean> {
    return this.isAvailable;
  }

  async recognize(): Promise<OcrPageResult> {
    const call = this.calls.length + 1;
    this.calls.push(call);

    const result = this.behaviour(call);
    if (result instanceof Error) throw result;
    return result;
  }
}

let userId: string;

beforeEach(async () => {
  await resetTestDb();
  ({ userId } = await seedBasics());
});

afterAll(() => setOcrProvider(null));

async function preparedDocument(pageCount: number): Promise<string> {
  const actor = actorFor(userId);
  const document = await createDocument(actor);

  for (let index = 0; index < pageCount; index += 1) {
    await addFile(actor, document.id, {
      content: await makeImage({ width: 600, height: 800 }),
      originalName: `s${index + 1}.jpg`,
      declaredMimeType: 'image/jpeg',
    });
  }

  await runIngest(document.id);
  return document.id;
}

describe('Texterkennung im Ablauf', () => {
  it('erkennt jede Seite und vermerkt die Sicherheit', async () => {
    setOcrProvider(new FakeOcr());
    const documentId = await preparedDocument(3);

    await runOcr(documentId);

    const pages = await testDb.documentPage.findMany({
      where: { documentId },
      orderBy: { pageNumber: 'asc' },
    });

    expect(pages).toHaveLength(3);
    for (const page of pages) {
      expect(page.text).toBe('Erkannter Text');
      expect(page.textSource).toBe('OCR');
      expect(page.ocrConfidence).toBe(92);
    }

    const document = await testDb.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.ocrAt).not.toBeNull();
    expect(document.processingStatus).toBe('ANALYZING');
    // Alles sicher erkannt - es gibt nichts zu prüfen.
    expect(document.reviewState).toBe('NONE');
  });

  it('nimmt einen unterbrochenen Lauf dort wieder auf, wo er stehen blieb', async () => {
    // Erst zwei Seiten erkennen, dann abstürzen.
    const stolpernd = new FakeOcr((call) =>
      call <= 2 ? { text: 'Teil eins', confidence: 90 } : new Error('Abbruch'),
    );
    setOcrProvider(stolpernd);
    const documentId = await preparedDocument(4);

    await runOcr(documentId);

    const zweiterAnbieter = new FakeOcr(() => ({ text: 'Teil zwei', confidence: 88 }));
    setOcrProvider(zweiterAnbieter);
    await runOcr(documentId);

    // Der zweite Lauf darf die bereits erkannten Seiten nicht erneut
    // bearbeiten - bei zwölf Seiten wäre das die halbe Wartezeit umsonst.
    expect(zweiterAnbieter.calls).toHaveLength(0);

    const pages = await testDb.documentPage.findMany({ where: { documentId } });
    expect(pages.filter((page) => page.text === 'Teil eins')).toHaveLength(2);
  });

  it('lässt eine unlesbare Seite die anderen nicht blockieren', async () => {
    setOcrProvider(
      new FakeOcr((call) =>
        call === 2 ? new Error('Seite unlesbar') : { text: 'Gelesen', confidence: 91 },
      ),
    );
    const documentId = await preparedDocument(3);

    await runOcr(documentId);

    const pages = await testDb.documentPage.findMany({
      where: { documentId },
      orderBy: { pageNumber: 'asc' },
    });

    // Zwei Seiten sind gelesen, die dritte ist als unlesbar vermerkt - elf
    // gute Seiten dürfen nicht an einer schlechten scheitern.
    expect(pages.filter((page) => page.text === 'Gelesen')).toHaveLength(2);
    expect(pages.find((page) => page.ocrConfidence === 0)).toBeTruthy();

    const document = await testDb.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.processingStatus).toBe('ANALYZING');
    // Aber der Benutzer erfährt davon.
    expect(document.reviewState).toBe('NEEDED');
  });

  it('legt ein Dokument mit schlecht erkannten Seiten zur Prüfung vor', async () => {
    setOcrProvider(new FakeOcr(() => ({ text: 'Kaum lesbar', confidence: 41 })));
    const documentId = await preparedDocument(2);

    await runOcr(documentId);

    const document = await testDb.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.reviewState).toBe('NEEDED');
  });

  it('bricht ab, wenn die Texterkennung gar nicht verfügbar ist', async () => {
    setOcrProvider(new FakeOcr(() => ({ text: '', confidence: 0 }), false));
    const documentId = await preparedDocument(1);

    await expect(runOcr(documentId)).rejects.toBeInstanceOf(OcrUnavailableError);

    // Nichts halb Erkanntes zurückgelassen.
    const page = await testDb.documentPage.findFirstOrThrow({ where: { documentId } });
    expect(page.textSource).toBe('NONE');
  });

  it('überspringt Seiten, deren Text schon aus dem PDF stammt', async () => {
    const anbieter = new FakeOcr();
    setOcrProvider(anbieter);
    const documentId = await preparedDocument(2);

    await testDb.documentPage.updateMany({
      where: { documentId, pageNumber: 1 },
      data: { text: 'Bereits vorhanden', textSource: 'PDF_TEXT' },
    });

    await runOcr(documentId);

    expect(anbieter.calls).toHaveLength(1);
    const first = await testDb.documentPage.findFirstOrThrow({
      where: { documentId, pageNumber: 1 },
    });
    expect(first.text).toBe('Bereits vorhanden');
  });

  it('stellt die Analyse nur ein, wenn sie gewünscht ist', async () => {
    setOcrProvider(new FakeOcr());
    await testDb.userSettings.update({
      where: { userId },
      data: { autoAnalyze: false },
    });

    const documentId = await preparedDocument(1);
    await runOcr(documentId);

    const document = await testDb.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.processingStatus).toBe('DONE');
    // Ohne Analyse steht nichts bereit, das jemand prüfen könnte - der
    // Benutzer trägt die Angaben selbst nach.
    expect(document.reviewState).toBe('NEEDED');

    const jobs = await testDb.processingJob.findMany({ where: { documentId } });
    expect(jobs.map((job) => job.type)).not.toContain('ANALYZE');
  });

  it('hält jeden Lauf im Protokoll fest', async () => {
    setOcrProvider(new FakeOcr());
    const documentId = await preparedDocument(1);

    await runOcr(documentId);

    const run = await testDb.analysisRun.findFirstOrThrow({
      where: { documentId, kind: 'OCR' },
    });
    expect(run.status).toBe('SUCCEEDED');
    expect(run.provider).toBe('fake');
  });
});
