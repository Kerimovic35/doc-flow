import sharp from 'sharp';

/**
 * Aufbereitung der Seitenbilder.
 *
 * Aus jeder Seite entstehen drei Ableitungen mit unterschiedlichem Zweck:
 *
 *   Anzeige   WebP, lange Kante hoechstens 1600 px - reicht zum Lesen am
 *             Telefon und laedt auch im Mobilfunknetz schnell.
 *   Vorschau  WebP, 320 px - fuer Listen und den Seitenstreifen.
 *   Erkennung PNG in Graustufen, rund 300 dpi bezogen auf A4. Tesseract
 *             arbeitet mit dieser Aufloesung am zuverlaessigsten; darunter
 *             faellt die Erkennung sichtbar ab, darueber wird sie nur
 *             langsamer.
 *
 * Das Original wird dabei nie angefasst.
 */

const DISPLAY_MAX_EDGE = 1600;
const THUMB_MAX_EDGE = 320;
const OCR_TARGET_WIDTH = 2480;
/** Ueber dieser Breite bringt mehr Aufloesung der Erkennung nichts mehr. */
const OCR_MAX_WIDTH = 3500;

export interface PageImages {
  display: Uint8Array;
  thumb: Uint8Array;
  ocr: Uint8Array;
  width: number;
  height: number;
}

export interface ImageInfo {
  width: number;
  height: number;
  format: string;
}

export async function readImageInfo(content: Uint8Array): Promise<ImageInfo> {
  const meta = await sharp(content, { failOn: 'error' }).metadata();
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format ?? 'unbekannt',
  };
}

/**
 * Erzeugt die drei Ableitungen einer Seite.
 *
 * `rotate()` ohne Argument dreht anhand der EXIF-Angabe. Ohne diesen Schritt
 * stuende jedes Hochformat-Foto vom iPhone quer - und Tesseract laese eine
 * um 90 Grad gedrehte Seite praktisch gar nicht.
 */
export async function buildPageImages(content: Uint8Array): Promise<PageImages> {
  const upright = await sharp(content, { failOn: 'error' })
    .rotate()
    .toBuffer({ resolveWithObject: true });

  const width = upright.info.width;
  const height = upright.info.height;
  const base = () => sharp(upright.data, { failOn: 'error' });

  const display = await base()
    .resize({ width: DISPLAY_MAX_EDGE, height: DISPLAY_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  const thumb = await base()
    .resize({ width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 70 })
    .toBuffer();

  const ocr = await buildOcrImage(upright.data, width);

  return {
    display: new Uint8Array(display),
    thumb: new Uint8Array(thumb),
    ocr: new Uint8Array(ocr),
    width,
    height,
  };
}

/**
 * Vorlage fuer die Texterkennung.
 *
 * Graustufen und `normalize()`: Ein Foto eines Briefes hat selten den vollen
 * Kontrastumfang - Schatten und Handykamera drueckten Schwarz und Weiss
 * zusammen. Das Strecken des Histogramms macht genau den Unterschied, an dem
 * Tesseract sonst scheitert. Bewusst KEIN Schwellwertverfahren: Es wirft bei
 * ungleichmaessiger Beleuchtung ganze Absaetze weg.
 */
async function buildOcrImage(upright: Buffer, width: number): Promise<Buffer> {
  const targetWidth = Math.min(Math.max(width, OCR_TARGET_WIDTH), OCR_MAX_WIDTH);

  return sharp(upright, { failOn: 'error' })
    .resize({ width: targetWidth, withoutEnlargement: false })
    .grayscale()
    .normalize()
    // grayscale() faerbt nur ein, behaelt aber drei Kanaele. Erst der
    // Farbraumwechsel macht daraus ein echtes Graubild - ein Drittel der
    // Datenmenge fuer dieselbe Erkennung.
    .toColourspace('b-w')
    .png({ compressionLevel: 6 })
    .toBuffer();
}

/** Ableitungen aus einem bereits gerasterten PDF-Seitenbild (PNG). */
export async function buildPageImagesFromRaster(
  png: Uint8Array,
  width: number,
  height: number,
): Promise<PageImages> {
  const base = () => sharp(png, { failOn: 'error' });

  const display = await base()
    .resize({ width: DISPLAY_MAX_EDGE, height: DISPLAY_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  const thumb = await base()
    .resize({ width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 70 })
    .toBuffer();

  // Das Rasterbild hat bereits die richtige Aufloesung; es fehlen nur
  // Graustufen und der gestreckte Kontrast.
  const ocr = await base()
    .grayscale()
    .normalize()
    .toColourspace('b-w')
    .png({ compressionLevel: 6 })
    .toBuffer();

  return {
    display: new Uint8Array(display),
    thumb: new Uint8Array(thumb),
    ocr: new Uint8Array(ocr),
    width,
    height,
  };
}
