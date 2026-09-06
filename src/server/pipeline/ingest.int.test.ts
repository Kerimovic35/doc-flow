import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { actorFor, resetTestDb, seedBasics, testDb } from '@/test/integration-db';
import { LETTER_TEXT, makeImage, makeScanLikePdf, makeTextPdf } from '@/test/fixtures';

vi.mock('@/server/db', async () => {
  const { testDb: client } = await import('@/test/integration-db');
  return { db: client };
});

let filesRoot: string;

beforeAll(async () => {
  filesRoot = await mkdtemp(path.join(tmpdir(), 'docflow-ingest-'));
  process.env.FILES_DIR = filesRoot;
});

afterAll(async () => {
  await rm(filesRoot, { recursive: true, force: true });
});

const { runIngest } = await import('./ingest');
const { createDocument, addFile } = await import('@/server/services/documents');
const { storage } = await import('@/server/storage/local');
const { PermanentJobError } = await import('@/server/jobs/types');

let userId: string;

beforeEach(async () => {
  await resetTestDb();
  ({ userId } = await seedBasics());
});

async function documentWith(
  files: Array<{ content: Uint8Array; name: string; type: string }>,
): Promise<string> {
  const actor = actorFor(userId);
  const document = await createDocument(actor);

  for (const file of files) {
    const result = await addFile(actor, document.id, {
      content: file.content,
      originalName: file.name,
      declaredMimeType: file.type,
    });
    if (!result.ok) throw new Error(`Datei abgelehnt: ${result.error}`);
  }

  return document.id;
}

describe('Seiten aufbereiten', () => {
  it('macht aus drei Fotos ein Dokument mit drei Seiten', async () => {
    const documentId = await documentWith([
      { content: await makeImage(), name: 's1.jpg', type: 'image/jpeg' },
      { content: await makeImage(), name: 's2.jpg', type: 'image/jpeg' },
      { content: await makeImage(), name: 's3.jpg', type: 'image/jpeg' },
    ]);

    await runIngest(documentId);

    const pages = await testDb.documentPage.findMany({
      where: { documentId },
      orderBy: { pageNumber: 'asc' },
    });

    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2, 3]);

    for (const page of pages) {
      // Jede Seite hat alle drei Ableitungen, sonst fehlte spaeter entweder
      // die Anzeige oder die Vorlage fuer die Texterkennung.
      expect(page.imageKey).toBeTruthy();
      expect(page.thumbKey).toBeTruthy();
      expect(page.ocrInputKey).toBeTruthy();
      expect(await storage().exists(page.imageKey!)).toBe(true);
      expect(await storage().exists(page.thumbKey!)).toBe(true);
      expect(await storage().exists(page.ocrInputKey!)).toBe(true);
    }

    const document = await testDb.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.pageCount).toBe(3);
    // Fotos brauchen Texterkennung.
    expect(document.processingStatus).toBe('OCR');

    const job = await testDb.processingJob.findFirst({
      where: { documentId, type: 'OCR' },
    });
    expect(job).not.toBeNull();
  });

  it('zerlegt ein PDF in seine Seiten und übernimmt den eingebetteten Text', async () => {
    const documentId = await documentWith([
      {
        content: makeTextPdf([LETTER_TEXT, `Seite zwei. ${LETTER_TEXT}`]),
        name: 'bescheid.pdf',
        type: 'application/pdf',
      },
    ]);

    await runIngest(documentId);

    const pages = await testDb.documentPage.findMany({
      where: { documentId },
      orderBy: { pageNumber: 'asc' },
    });

    expect(pages).toHaveLength(2);
    expect(pages[0]!.textSource).toBe('PDF_TEXT');
    expect(pages[0]!.text).toContain('AOK');
    expect(pages[1]!.text).toContain('Seite zwei');
    expect(pages[0]!.pageInFile).toBe(1);
    expect(pages[1]!.pageInFile).toBe(2);

    const document = await testDb.document.findUniqueOrThrow({ where: { id: documentId } });
    // Der Text steht schon fest - die Texterkennung wird uebersprungen.
    expect(document.processingStatus).toBe('ANALYZING');
    expect(document.ocrAt).not.toBeNull();

    const jobs = await testDb.processingJob.findMany({ where: { documentId } });
    expect(jobs.map((job) => job.type)).toContain('ANALYZE');
    expect(jobs.map((job) => job.type)).not.toContain('OCR');
  });

  it('schickt ein PDF ohne brauchbaren Text in die Texterkennung', async () => {
    const documentId = await documentWith([
      { content: makeScanLikePdf(), name: 'scan.pdf', type: 'application/pdf' },
    ]);

    await runIngest(documentId);

    const page = await testDb.documentPage.findFirstOrThrow({ where: { documentId } });
    expect(page.textSource).toBe('NONE');
    expect(page.text).toBeNull();

    const document = await testDb.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.processingStatus).toBe('OCR');
  });

  it('zählt Seiten über mehrere Dateien hinweg fortlaufend', async () => {
    const documentId = await documentWith([
      { content: await makeImage(), name: 'deckblatt.jpg', type: 'image/jpeg' },
      { content: makeTextPdf([LETTER_TEXT, LETTER_TEXT]), name: 'anhang.pdf', type: 'application/pdf' },
    ]);

    await runIngest(documentId);

    const pages = await testDb.documentPage.findMany({
      where: { documentId },
      orderBy: { pageNumber: 'asc' },
    });

    // Eine durchgehende Nummerierung ist die Voraussetzung dafuer, dass eine
    // KI-Quelle spaeter eindeutig auf "Seite 2" zeigen kann.
    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2, 3]);
    expect(pages[0]!.textSource).toBe('NONE');
    expect(pages[1]!.textSource).toBe('PDF_TEXT');
  });

  it('kann wiederholt werden, ohne Seiten zu verdoppeln', async () => {
    const documentId = await documentWith([
      { content: await makeImage(), name: 's1.jpg', type: 'image/jpeg' },
      { content: await makeImage(), name: 's2.jpg', type: 'image/jpeg' },
    ]);

    await runIngest(documentId);
    const ersteSeiten = await testDb.documentPage.findMany({ where: { documentId } });

    await runIngest(documentId);
    const zweiteSeiten = await testDb.documentPage.findMany({ where: { documentId } });

    expect(zweiteSeiten).toHaveLength(2);
    // Die alten Ableitungen sind verworfen, die neuen liegen da.
    expect(zweiteSeiten.map((page) => page.id)).not.toEqual(ersteSeiten.map((page) => page.id));
    for (const page of zweiteSeiten) {
      expect(await storage().exists(page.imageKey!)).toBe(true);
    }
  });

  it('rührt die Originale niemals an', async () => {
    const original = await makeImage();
    const documentId = await documentWith([
      { content: original, name: 's1.jpg', type: 'image/jpeg' },
    ]);

    await runIngest(documentId);

    const file = await testDb.documentFile.findFirstOrThrow({ where: { documentId } });
    const stored = await storage().read(file.storageKey);
    expect(Buffer.from(stored)).toEqual(Buffer.from(original));
  });

  it('bricht bei beschädigtem Original ab, statt halbe Seiten zu erzeugen', async () => {
    const documentId = await documentWith([
      { content: await makeImage(), name: 's1.jpg', type: 'image/jpeg' },
    ]);

    // Die Datei in der Ablage austauschen - so sähe ein Volumefehler aus.
    const file = await testDb.documentFile.findFirstOrThrow({ where: { documentId } });
    await storage().write(file.storageKey, new TextEncoder().encode('kaputt'));

    await expect(runIngest(documentId)).rejects.toBeInstanceOf(PermanentJobError);

    // Kein Weitermachen mit falschen Daten.
    expect(await testDb.documentPage.count({ where: { documentId } })).toBe(0);
  });

  it('gibt bei fehlender Datei sofort auf, statt es dreimal zu versuchen', async () => {
    const documentId = await documentWith([
      { content: await makeImage(), name: 's1.jpg', type: 'image/jpeg' },
    ]);

    const file = await testDb.documentFile.findFirstOrThrow({ where: { documentId } });
    await storage().remove(file.storageKey);

    await expect(runIngest(documentId)).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('hält den Lauf in einem nachvollziehbaren Protokoll fest', async () => {
    const documentId = await documentWith([
      { content: await makeImage(), name: 's1.jpg', type: 'image/jpeg' },
    ]);

    await runIngest(documentId);

    const run = await testDb.analysisRun.findFirstOrThrow({
      where: { documentId, kind: 'INGEST' },
    });
    expect(run.status).toBe('SUCCEEDED');
    expect(run.finishedAt).not.toBeNull();
  });
});
