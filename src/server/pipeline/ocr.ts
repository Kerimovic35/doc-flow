import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { db } from '@/server/db';
import { enqueue } from '@/server/jobs/queue';
import { PermanentJobError } from '@/server/jobs/types';
import { errorMessage, log } from '@/server/log';
import { OcrUnavailableError } from '@/server/ocr/provider';
import { ocrProvider } from '@/server/ocr/tesseract';
import { storage } from '@/server/storage/local';

/**
 * Texterkennung.
 *
 * Zweiter Schritt der Kette. Arbeitet Seite fuer Seite und schreibt jedes
 * Ergebnis sofort weg. Das ist der Kern der Wiederholbarkeit: Bricht der
 * Lauf nach acht von zwoelf Seiten ab, setzt der naechste bei neun an statt
 * von vorn.
 *
 * Eine einzelne unlesbare Seite haelt das Dokument nicht auf. Sie bekommt
 * Konfidenz 0, das Dokument geht in die Prüfung - die anderen elf Seiten
 * sind zu wertvoll, um sie an einer zu verlieren.
 */

export async function runOcr(documentId: string): Promise<void> {
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      userId: true,
      user: { select: { settings: { select: { ocrThreshold: true, autoAnalyze: true, aiEnabled: true } } } },
      pages: {
        orderBy: { pageNumber: 'asc' },
        select: {
          id: true,
          pageNumber: true,
          ocrInputKey: true,
          text: true,
          textSource: true,
        },
      },
    },
  });

  if (!document) throw new PermanentJobError('Dokument existiert nicht mehr.');
  if (document.pages.length === 0) {
    throw new PermanentJobError('Zu diesem Dokument gibt es keine Seiten.');
  }

  const provider = ocrProvider();
  if (!(await provider.available())) {
    throw new OcrUnavailableError(
      'Die Texterkennung steht nicht zur Verfügung. Das Dokument bleibt erhalten und kann später erneut verarbeitet werden.',
    );
  }

  // Bereits erkannte Seiten ueberspringen - das macht den Schritt
  // wiederholbar, ohne Arbeit zu verdoppeln.
  const open = document.pages.filter((page) => page.textSource === 'NONE');

  const run = await db.analysisRun.create({
    data: {
      documentId,
      userId: document.userId,
      kind: 'OCR',
      status: 'RUNNING',
      provider: provider.name,
    },
    select: { id: true },
  });

  await db.document.update({
    where: { id: documentId },
    data: {
      processingStatus: 'OCR',
      progressTotal: document.pages.length,
      progressDone: document.pages.length - open.length,
      processingStep: `Texterkennung Seite 1 von ${document.pages.length}`,
      failedStep: null,
      lastError: null,
    },
  });

  let done = document.pages.length - open.length;
  let failedPages = 0;
  const confidences: number[] = [];

  try {
    for (const page of open) {
      if (!page.ocrInputKey) {
        failedPages += 1;
        continue;
      }

      try {
        const image = await storage().read(page.ocrInputKey);
        const result = await provider.recognize(image);

        await db.documentPage.update({
          where: { id: page.id },
          data: {
            text: result.text,
            textSource: 'OCR',
            ocrConfidence: result.confidence,
            rotation: result.rotation ?? 0,
            ocrRunId: run.id,
          },
        });

        confidences.push(result.confidence);
      } catch (error) {
        // Eine Seite, die nicht lesbar ist, darf die anderen nicht
        // blockieren. Sie wird als erkannt mit Konfidenz 0 vermerkt, damit
        // ein spaeterer Lauf sie nicht endlos erneut versucht - und das
        // Dokument geht in die Prüfung.
        if (error instanceof OcrUnavailableError) throw error;

        failedPages += 1;
        log.warn('ocr.page_failed', {
          documentId,
          pageNumber: page.pageNumber,
          error: errorMessage(error),
        });

        await db.documentPage.update({
          where: { id: page.id },
          data: { text: '', textSource: 'OCR', ocrConfidence: 0, ocrRunId: run.id },
        });
        confidences.push(0);
      }

      done += 1;
      await db.document.update({
        where: { id: documentId },
        data: {
          progressDone: done,
          processingStep: `Texterkennung Seite ${done} von ${document.pages.length}`,
        },
      });

      // Tesseract laeuft als eigener Prozess, aber das Schreiben der
      // Ergebnisse nicht. Kurz Luft holen.
      await yieldToEventLoop();
    }

    const settings = document.user.settings;
    const threshold = settings?.ocrThreshold ?? 70;
    const lowest = confidences.length > 0 ? Math.min(...confidences) : 100;
    const needsReview = failedPages > 0 || lowest < threshold;

    await db.analysisRun.update({
      where: { id: run.id },
      data: { status: 'SUCCEEDED', finishedAt: new Date() },
    });

    const analyze = (settings?.autoAnalyze ?? true) && (settings?.aiEnabled ?? true);

    await db.document.update({
      where: { id: documentId },
      data: {
        ocrAt: new Date(),
        processingStatus: analyze ? 'ANALYZING' : 'DONE',
        processingStep: analyze ? 'Warte auf Analyse' : null,
        // Ohne Analyse steht nichts Erkanntes bereit, das jemand pruefen
        // koennte - dann traegt der Benutzer die Angaben selbst nach.
        reviewState: needsReview || !analyze ? 'NEEDED' : 'NONE',
      },
    });

    if (analyze) {
      await enqueue({ type: 'ANALYZE', documentId, userId: document.userId });
    }

    log.info('ocr.done', {
      documentId,
      pages: open.length,
      failedPages,
      lowestConfidence: lowest,
      needsReview,
    });
  } catch (error) {
    await db.analysisRun
      .update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          error: errorMessage(error),
        },
      })
      .catch(() => undefined);
    throw error;
  }
}
