import { createRequire } from 'node:module';
import path from 'node:path';
import { PermanentJobError } from '@/server/jobs/types';

/**
 * PDF lesen und rastern.
 *
 * pdfjs statt eines externen Programms wie poppler: Es laeuft in Node,
 * braucht keine Systeminstallation und verhaelt sich in der Entwicklung
 * unter Windows genauso wie im Container. Das Rastern uebernimmt
 * @napi-rs/canvas.
 *
 * Wichtig: Das Rastern laeuft im JS-Hauptthread und blockiert ihn fuer
 * einige hundert Millisekunden je Seite. Deshalb gibt der Aufrufer zwischen
 * den Seiten die Kontrolle ab (siehe pipeline/ingest.ts), und der Worker
 * bearbeitet immer nur einen Auftrag.
 */

const require = createRequire(import.meta.url);

/** Mehr Seiten hat kein privater Brief; darueber steckt ein Versehen. */
export const MAX_PDF_PAGES = 300;

/** Zielbreite der Rasterbilder: rund 300 dpi bezogen auf A4. */
const RASTER_WIDTH = 2480;

/**
 * pdfjs erwartet einen Pfad mit abschliessendem Schraegstrich. In Node liest
 * es die Dateien selbst vom Dateisystem - eine file://-URL kaeme dort als
 * unbekannter Pfad an.
 */
function assetPath(folder: string): string {
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  return `${path.join(root, folder).split(path.sep).join('/')}/`;
}

type PdfDocument = Awaited<ReturnType<typeof openPdf>>;

async function openPdf(data: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  try {
    return await pdfjs.getDocument({
      // pdfjs uebernimmt den Puffer und leert ihn dabei. Eine Kopie, damit
      // der Aufrufer seine Daten behaelt.
      data: new Uint8Array(data),
      standardFontDataUrl: assetPath('standard_fonts'),
      cMapUrl: assetPath('cmaps'),
      cMapPacked: true,
      // In Node gibt es keinen Worker-Thread fuer pdfjs.
      useWorkerFetch: false,
    }).promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Ein verschluesseltes PDF wird beim dritten Versuch nicht lesbarer.
    if (/password/i.test(message)) {
      throw new PermanentJobError(
        'Das PDF ist passwortgeschützt und kann nicht gelesen werden. Bitte ohne Schutz erneut hochladen.',
      );
    }
    throw new PermanentJobError(`Das PDF konnte nicht gelesen werden: ${message}`);
  }
}

export interface PdfPage {
  pageNumber: number;
  width: number;
  height: number;
  /** Eingebetteter Text, sofern er brauchbar aussieht. */
  text: string | null;
  png: Uint8Array;
}

export interface PdfReader {
  pageCount: number;
  page(pageNumber: number): Promise<PdfPage>;
  close(): Promise<void>;
}

export async function openPdfReader(data: Uint8Array): Promise<PdfReader> {
  const document: PdfDocument = await openPdf(data);

  if (document.numPages > MAX_PDF_PAGES) {
    await document.destroy();
    throw new PermanentJobError(
      `Das PDF hat ${document.numPages} Seiten. Höchstens ${MAX_PDF_PAGES} sind möglich.`,
    );
  }

  return {
    pageCount: document.numPages,

    async page(pageNumber: number): Promise<PdfPage> {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const raw = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: RASTER_WIDTH / base.width });

        const { createCanvas } = await import('@napi-rs/canvas');
        const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
        const context = canvas.getContext('2d');

        // Weisser Grund: Ein PDF ohne eigenen Hintergrund waere sonst
        // durchsichtig und wuerde als schwarze Flaeche gespeichert.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: context as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise;

        return {
          pageNumber,
          width: canvas.width,
          height: canvas.height,
          text: isUsableText(raw) ? raw : null,
          png: new Uint8Array(canvas.toBuffer('image/png')),
        };
      } finally {
        page.cleanup();
      }
    },

    async close() {
      await document.destroy();
    },
  };
}

/**
 * Entscheidet, ob der eingebettete Text die Texterkennung ersetzen kann.
 *
 * "Hat Text" allein genuegt nicht: Gescannte PDFs mit alter, schlechter
 * Erkennungsschicht und PDFs mit kaputter Zeichenkodierung liefern Zeichen,
 * die wie Text aussehen, aber keiner sind. Verlangt werden deshalb genug
 * Zeichen UND ein hoher Anteil echter Woerter. Im Zweifel wird erkannt -
 * das kostet Zeit, aber keine Genauigkeit.
 */
export function isUsableText(text: string): boolean {
  if (text.length < 200) return false;

  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 30) return false;

  const wordLike = tokens.filter((token) =>
    /^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]{1,}$/.test(token.replace(/[.,;:!?()"„“»«]/g, '')),
  );

  return wordLike.length / tokens.length > 0.6;
}
