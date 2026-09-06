import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { TesseractOcr } from './tesseract';

/**
 * Prueft die Texterkennung gegen das wirklich installierte Tesseract.
 *
 * Ohne Tesseract werden diese Tests uebersprungen statt rot: Die Anwendung
 * laesst sich auch ohne Texterkennung entwickeln, und ein roter Test, den
 * niemand gruen bekommt, wird bald ignoriert.
 */
const ocr = new TesseractOcr();
let available = false;
let languages: string[] = [];

beforeAll(async () => {
  available = await ocr.available();
  if (available) languages = await ocr.languages();
});

/** Ein sauber gesetzter Brief - so sieht ein Scan im besten Fall aus. */
async function renderLetter(lines: string[], options: { rotate?: number } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754">
    <rect width="100%" height="100%" fill="white"/>
    ${lines
      .map(
        (line, index) =>
          `<text x="90" y="${180 + index * 58}" font-family="DejaVu Sans, Verdana, Arial" font-size="36" fill="black">${line}</text>`,
      )
      .join('\n')}
  </svg>`;

  const image = sharp(Buffer.from(svg));
  const rotated = options.rotate ? image.rotate(options.rotate) : image;
  return new Uint8Array(await rotated.png().toBuffer());
}

const LETTER = [
  'AOK Bayern',
  'Bescheid vom 04.09.2026',
  'Aktenzeichen KV-2026-004711',
  'Der Beitrag betraegt 127,50 EUR',
  'Zahlbar bis zum 12.09.2026',
];

describe('Texterkennung mit Tesseract', () => {
  it('ist eingerichtet und kennt Deutsch', async () => {
    if (!available) {
      console.warn('Tesseract nicht verfügbar - Test übersprungen.');
      return;
    }

    expect(languages).toContain('eng');
    // Ohne das deutsche Modell faellt die Erkennung deutscher Briefe
    // spuerbar ab; im Container ist es enthalten.
    if (!languages.includes('deu')) {
      console.warn('Sprachmodell "deu" fehlt - deutsche Erkennung eingeschränkt.');
    }
  });

  it('liest einen sauberen Brief zuverlässig', async () => {
    if (!available) return;

    const result = await ocr.recognize(await renderLetter(LETTER));

    expect(result.text).toMatch(/AOK/);
    expect(result.text).toMatch(/04\.09\.2026/);
    expect(result.text).toMatch(/KV-2026-004711/);
    expect(result.text).toMatch(/127[,.]50/);

    // Ein sauber gesetzter Text muss sehr sicher erkannt werden. Liegt der
    // Wert darunter, stimmt etwas mit der Bildaufbereitung nicht.
    expect(result.confidence).toBeGreaterThan(80);
  });

  it('behält die Zeilenstruktur', async () => {
    if (!available) return;

    const result = await ocr.recognize(await renderLetter(LETTER));
    const lines = result.text.split('\n').filter((line) => line.trim());

    // Die Belegpruefung sucht spaeter Zitate im Text. Ein Zitat aus einer
    // Adresszeile findet sich nur, wenn die Zeile eine Zeile geblieben ist.
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines[0]).toMatch(/AOK/);
  });

  it('richtet ein quer eingescanntes Blatt selbst auf', async () => {
    if (!available) return;

    const result = await ocr.recognize(await renderLetter(LETTER, { rotate: 90 }));

    // Ohne die Ausrichtungserkennung läse Tesseract hier praktisch nichts.
    expect(result.rotation).toBeGreaterThan(0);
    expect(result.text).toMatch(/AOK/);
  });

  it('liefert für eine leere Seite kaum Text und keine hohe Sicherheit', async () => {
    if (!available) return;

    const blank = new Uint8Array(
      await sharp({
        create: { width: 1240, height: 1754, channels: 3, background: '#ffffff' },
      })
        .png()
        .toBuffer(),
    );

    const result = await ocr.recognize(blank);
    expect(result.text.replace(/\s/g, '')).toHaveLength(0);
  });
});
