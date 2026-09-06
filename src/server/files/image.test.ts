import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildPageImages, readImageInfo } from './image';

/** Ein Bild mit unterscheidbaren Haelften, um die Drehung zu erkennen. */
async function makeImage(options: {
  width: number;
  height: number;
  orientation?: number;
}): Promise<Uint8Array> {
  const { width, height, orientation } = options;

  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 240, g: 240, b: 240 },
    },
  }).composite([
    {
      // Ein dunkler Balken oben - nach einer Drehung um 90 Grad läge er links.
      input: {
        create: {
          width,
          height: Math.round(height / 4),
          channels: 3,
          background: { r: 20, g: 20, b: 20 },
        },
      },
      top: 0,
      left: 0,
    },
  ]);

  const withOrientation = orientation ? image.withMetadata({ orientation }) : image;
  return new Uint8Array(await withOrientation.jpeg().toBuffer());
}

describe('Seitenbilder erzeugen', () => {
  it('liefert Anzeige, Vorschau und Erkennungsvorlage', async () => {
    const source = await makeImage({ width: 1200, height: 1600 });
    const images = await buildPageImages(source);

    const display = await readImageInfo(images.display);
    const thumb = await readImageInfo(images.thumb);
    const ocr = await readImageInfo(images.ocr);

    expect(display.format).toBe('webp');
    expect(Math.max(display.width, display.height)).toBeLessThanOrEqual(1600);

    expect(thumb.format).toBe('webp');
    expect(Math.max(thumb.width, thumb.height)).toBeLessThanOrEqual(320);

    // Die Erkennungsvorlage wird hochskaliert: Tesseract braucht rund
    // 300 dpi, sonst faellt die Erkennung sichtbar ab.
    expect(ocr.format).toBe('png');
    expect(ocr.width).toBeGreaterThanOrEqual(2480);
  });

  it('richtet ein Foto anhand der EXIF-Angabe auf', async () => {
    // Orientierung 6 bedeutet "um 90 Grad im Uhrzeigersinn drehen" - genau
    // das liefert ein iPhone im Hochformat. Ohne diesen Schritt stuende
    // jeder abfotografierte Brief quer, und die Texterkennung liefe ins
    // Leere.
    const source = await makeImage({ width: 1600, height: 1200, orientation: 6 });
    const images = await buildPageImages(source);

    expect(images.width).toBe(1200);
    expect(images.height).toBe(1600);

    const display = await readImageInfo(images.display);
    expect(display.height).toBeGreaterThan(display.width);
  });

  it('vergrößert ein bereits großes Bild nicht über das Nötige hinaus', async () => {
    const source = await makeImage({ width: 4000, height: 5000 });
    const images = await buildPageImages(source);

    const ocr = await readImageInfo(images.ocr);
    expect(ocr.width).toBeLessThanOrEqual(3500);
  });

  it('wandelt die Erkennungsvorlage in Graustufen', async () => {
    const source = await makeImage({ width: 1000, height: 1400 });
    const images = await buildPageImages(source);

    const meta = await sharp(images.ocr).metadata();
    expect(meta.channels).toBe(1);
  });

  it('bricht bei kaputten Daten ab, statt Unsinn zu liefern', async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(buildPageImages(garbage)).rejects.toThrow();
  });
});
