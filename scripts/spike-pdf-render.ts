/**
 * Machbarkeitsprobe: PDF-Seiten in Node lesen und rastern.
 *
 * Steht vor der eigentlichen Umsetzung, weil an dieser Stelle drei Dinge
 * schiefgehen koennen, die sich erst im Betrieb zeigen wuerden: die
 * Schriftdateien von pdfjs, die Zeichenflaeche aus @napi-rs/canvas und der
 * Speicherbedarf grosser Seiten.
 *
 * Aufruf:  npx tsx scripts/spike-pdf-render.ts [datei.pdf]
 * Ohne Argument wird ein Test-PDF erzeugt.
 */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));

/**
 * pdfjs verlangt einen abschliessenden Schraegstrich. In Node liest es die
 * Dateien selbst vom Dateisystem - eine file://-URL kaeme dort als
 * unbekannter Pfad an. Deshalb ein normaler Pfad mit Schraegstrichen.
 */
function assetPath(folder: string): string {
  return `${path.join(pdfjsRoot, folder).split(path.sep).join('/')}/`;
}

async function makeTestPdf(): Promise<Uint8Array> {
  // Ein minimales PDF von Hand, damit die Probe ohne fremde Datei laeuft.
  const content = `BT /F1 24 Tf 72 700 Td (Probeseite mit Umlauten: \\304\\326\\334 \\337) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

async function main() {
  const [, , file] = process.argv;
  const data = file ? new Uint8Array(await readFile(file)) : await makeTestPdf();

  console.log(`Eingabe: ${file ?? 'erzeugtes Test-PDF'} (${data.byteLength} Bytes)`);

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  console.log(`pdfjs ${pdfjs.version}`);

  const document = await pdfjs.getDocument({
    data,
    // Schriften und Kodierungstabellen liegen im Paket. Ohne diese Pfade
    // bleiben Seiten ohne eingebettete Schrift leer.
    standardFontDataUrl: assetPath('standard_fonts'),
    cMapUrl: assetPath('cmaps'),
    cMapPacked: true,
    // In Node gibt es keinen echten Worker; ohne diese Angabe wartet pdfjs
    // vergeblich auf ihn.
    useWorkerFetch: false,
  }).promise;

  console.log(`Seiten: ${document.numPages}`);

  const { createCanvas } = await import('@napi-rs/canvas');
  const outDir = path.resolve('data/spike');
  await mkdir(outDir, { recursive: true });

  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);

    const text = await page.getTextContent();
    const extracted = text.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .trim();
    console.log(`Seite ${number}: ${extracted.length} Zeichen Text`);
    if (extracted) console.log(`  "${extracted.slice(0, 80)}"`);

    // Zielbreite rund 2500 px - das entspricht etwa 300 dpi auf A4 und ist
    // die Groesse, mit der Tesseract am besten arbeitet.
    const base = page.getViewport({ scale: 1 });
    const scale = 2480 / base.width;
    const viewport = page.getViewport({ scale });

    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const started = Date.now();
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;

    const png = canvas.toBuffer('image/png');
    const target = path.join(outDir, `seite-${number}.png`);
    await writeFile(target, png);

    console.log(
      `  gerastert ${canvas.width}x${canvas.height} in ${Date.now() - started} ms, ${Math.round(png.byteLength / 1024)} KB -> ${target}`,
    );

    page.cleanup();
  }

  await document.destroy();
  console.log('Probe erfolgreich.');
}

main().catch((error) => {
  console.error('Probe gescheitert:', error);
  process.exit(1);
});
