import { createHash } from 'node:crypto';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { db } from '@/server/db';
import { buildPageImages, buildPageImagesFromRaster, type PageImages } from '@/server/files/image';
import { openPdfReader } from '@/server/files/pdf';
import { enqueue } from '@/server/jobs/queue';
import { PermanentJobError } from '@/server/jobs/types';
import { log } from '@/server/log';
import { derivedPrefix, pageImageKey, pageOcrKey, pageThumbKey } from '@/server/storage/keys';
import { storage } from '@/server/storage/local';

/**
 * Seiten aufbereiten.
 *
 * Erster Schritt der Verarbeitungskette. Aus den hochgeladenen Dateien
 * entstehen Seiten: aus jedem Foto eine, aus jedem PDF so viele, wie es hat.
 * Je Seite werden drei Ableitungen erzeugt - Anzeigebild, Vorschau und
 * Vorlage fuer die Texterkennung.
 *
 * Der Schritt ist wiederholbar: Er verwirft alle bisherigen Ableitungen und
 * Seiten und baut sie neu. Die Originale bleiben unberuehrt - sie sind der
 * einzige Bestand, der nicht wiederherstellbar waere.
 */

export async function runIngest(documentId: string): Promise<void> {
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      userId: true,
      files: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          sha256: true,
          sortOrder: true,
          originalName: true,
        },
      },
    },
  });

  if (!document) {
    throw new PermanentJobError('Dokument existiert nicht mehr.');
  }
  if (document.files.length === 0) {
    throw new PermanentJobError('Zu diesem Dokument gehört keine Datei.');
  }

  const run = await db.analysisRun.create({
    data: { documentId, userId: document.userId, kind: 'INGEST', status: 'RUNNING' },
    select: { id: true },
  });

  await db.document.update({
    where: { id: documentId },
    data: {
      processingStatus: 'PREPARING',
      processingStep: 'Seiten werden vorbereitet',
      progressDone: 0,
      progressTotal: 0,
      failedStep: null,
      lastError: null,
    },
  });

  try {
    // Alles Abgeleitete verwerfen und neu aufbauen. Ein zweiter Lauf soll
    // dasselbe Ergebnis liefern wie der erste, nicht das doppelte.
    await storage().removePrefix(derivedPrefix(document.userId, documentId));
    await db.documentPage.deleteMany({ where: { documentId } });

    const total = await estimateTotalPages(document.files);
    await db.document.update({
      where: { id: documentId },
      data: { progressTotal: total },
    });

    let pageNumber = 0;
    let pagesWithText = 0;

    for (const file of document.files) {
      const content = await readAndVerify(file);

      if (file.mimeType === 'application/pdf') {
        const reader = await openPdfReader(content);
        try {
          for (let index = 1; index <= reader.pageCount; index += 1) {
            const pdfPage = await reader.page(index);
            pageNumber += 1;

            const images = await buildPageImagesFromRaster(
              pdfPage.png,
              pdfPage.width,
              pdfPage.height,
            );

            await savePage({
              documentId,
              userId: document.userId,
              fileId: file.id,
              pageNumber,
              pageInFile: index,
              images,
              text: pdfPage.text,
              runId: run.id,
            });

            if (pdfPage.text) pagesWithText += 1;

            await db.document.update({
              where: { id: documentId },
              data: {
                progressDone: pageNumber,
                processingStep: `Seite ${pageNumber} von ${Math.max(total, pageNumber)}`,
              },
            });

            // Das Rastern belegt den Hauptthread. Ohne diese Atempause
            // stockte die Oberflaeche bei einem langen PDF spuerbar.
            await yieldToEventLoop();
          }
        } finally {
          await reader.close();
        }
        continue;
      }

      // Ein Bild ist genau eine Seite.
      pageNumber += 1;
      const images = await buildPageImages(content);

      await savePage({
        documentId,
        userId: document.userId,
        fileId: file.id,
        pageNumber,
        pageInFile: 1,
        images,
        text: null,
        runId: run.id,
      });

      await db.document.update({
        where: { id: documentId },
        data: {
          progressDone: pageNumber,
          processingStep: `Seite ${pageNumber} von ${Math.max(total, pageNumber)}`,
        },
      });

      await yieldToEventLoop();
    }

    const needsOcr = pagesWithText < pageNumber;

    await db.analysisRun.update({
      where: { id: run.id },
      data: { status: 'SUCCEEDED', finishedAt: new Date() },
    });

    await db.document.update({
      where: { id: documentId },
      data: {
        pageCount: pageNumber,
        progressTotal: pageNumber,
        progressDone: pageNumber,
        processingStatus: needsOcr ? 'OCR' : 'ANALYZING',
        processingStep: needsOcr ? 'Warte auf Texterkennung' : 'Warte auf Analyse',
        ...(needsOcr ? {} : { ocrAt: new Date() }),
      },
    });

    await enqueue({
      type: needsOcr ? 'OCR' : 'ANALYZE',
      documentId,
      userId: document.userId,
    });

    log.info('ingest.done', { documentId, pages: pageNumber, withEmbeddedText: pagesWithText });
  } catch (error) {
    await db.analysisRun
      .update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          error: error instanceof Error ? error.message.slice(0, 500) : String(error),
        },
      })
      .catch(() => undefined);
    throw error;
  }
}

/**
 * Liest ein Original und prueft seine Pruefsumme.
 *
 * Weicht sie ab, ist die Datei beschaedigt - etwa nach einem Volumefehler.
 * Dann darf nicht einfach weitergemacht werden: Aus einer halben Datei
 * entstuenden halbe Seiten, die wie vollstaendige aussehen.
 */
async function readAndVerify(file: {
  id: string;
  storageKey: string;
  sha256: string;
  originalName: string;
}): Promise<Uint8Array> {
  let content: Uint8Array;
  try {
    content = await storage().read(file.storageKey);
  } catch {
    throw new PermanentJobError(
      `Die Originaldatei „${file.originalName}" ist in der Ablage nicht auffindbar.`,
    );
  }

  const actual = createHash('sha256').update(content).digest('hex');
  if (actual !== file.sha256) {
    throw new PermanentJobError(
      `Die Originaldatei „${file.originalName}" ist beschädigt (Prüfsumme stimmt nicht).`,
    );
  }

  return content;
}

/**
 * Schaetzt die Gesamtzahl der Seiten fuer die Fortschrittsanzeige.
 *
 * Fuer Bilder ist es genau eine je Datei. Fuer PDFs muesste man sie oeffnen -
 * das geschieht ohnehin gleich, deshalb wird hier mit eins gerechnet und der
 * Wert waehrend des Laufs nach oben korrigiert. Eine Anzeige, die von 3 auf 12
 * springt, ist besser als eine, die zwanzig Sekunden lang nichts sagt.
 */
async function estimateTotalPages(files: Array<{ mimeType: string }>): Promise<number> {
  return files.length;
}

async function savePage(input: {
  documentId: string;
  userId: string;
  fileId: string;
  pageNumber: number;
  pageInFile: number;
  images: PageImages;
  text: string | null;
  runId: string;
}): Promise<void> {
  const page = await db.documentPage.create({
    data: {
      documentId: input.documentId,
      userId: input.userId,
      fileId: input.fileId,
      pageNumber: input.pageNumber,
      pageInFile: input.pageInFile,
      width: input.images.width,
      height: input.images.height,
      text: input.text,
      textSource: input.text ? 'PDF_TEXT' : 'NONE',
      ocrRunId: input.text ? input.runId : null,
    },
    select: { id: true },
  });

  const imageKey = pageImageKey(input.userId, input.documentId, page.id);
  const thumbKey = pageThumbKey(input.userId, input.documentId, page.id);
  const ocrKey = pageOcrKey(input.userId, input.documentId, page.id);

  await storage().write(imageKey, input.images.display);
  await storage().write(thumbKey, input.images.thumb);
  await storage().write(ocrKey, input.images.ocr);

  await db.documentPage.update({
    where: { id: page.id },
    data: { imageKey, thumbKey, ocrInputKey: ocrKey },
  });
}
