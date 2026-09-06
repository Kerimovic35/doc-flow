import sharp from 'sharp';

/**
 * Testdaten, die wie echte Eingaben aussehen.
 *
 * Bewusst erzeugt statt als Datei abgelegt: Ein Bild mit bekanntem Inhalt
 * laesst sich pruefen, und ein PDF im Repository waere ein undurchsichtiger
 * Klumpen, den niemand mehr anfasst.
 */

/** Ein Blatt mit dunklem Balken oben - die Drehung ist daran erkennbar. */
export async function makeImage(
  options: { width?: number; height?: number; orientation?: number } = {},
): Promise<Uint8Array> {
  const width = options.width ?? 1200;
  const height = options.height ?? 1600;

  const image = sharp({
    create: { width, height, channels: 3, background: { r: 245, g: 245, b: 245 } },
  }).composite([
    {
      input: {
        create: {
          width,
          height: Math.round(height / 5),
          channels: 3,
          background: { r: 25, g: 25, b: 25 },
        },
      },
      top: 0,
      left: 0,
    },
  ]);

  const withOrientation = options.orientation
    ? image.withMetadata({ orientation: options.orientation })
    : image;

  return new Uint8Array(await withOrientation.jpeg({ quality: 85 }).toBuffer());
}

/**
 * Ein PDF mit echtem Textinhalt.
 *
 * Von Hand zusammengesetzt, damit kein weiteres Paket noetig ist. Der Text
 * ist lang genug, damit die Heuristik ihn als brauchbar erkennt und die
 * Texterkennung uebersprungen wird.
 */
export function makeTextPdf(pages: string[]): Uint8Array {
  const objects: string[] = [];
  const pageIds: number[] = [];

  // 1 Katalog, 2 Seitenbaum, 3 Schrift, danach je Seite zwei Objekte.
  const fontId = 3;
  let nextId = 4;

  const streams: Array<{ id: number; content: string }> = [];

  for (const text of pages) {
    const contentId = nextId++;
    const pageId = nextId++;
    pageIds.push(pageId);

    const lines = wrap(text, 70);
    const body = lines
      .map((line, index) => `BT /F1 11 Tf 60 ${760 - index * 16} Td (${escapePdf(line)}) Tj ET`)
      .join('\n');

    streams.push({ id: contentId, content: body });
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
  }

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objects[fontId] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  for (const stream of streams) {
    objects[stream.id] =
      `<< /Length ${stream.content.length} >>\nstream\n${stream.content}\nendstream`;
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  for (let id = 1; id < objects.length; id += 1) {
    const object = objects[id];
    if (!object) continue;
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${object}\nendobj\n`;
  }

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

/** Ein PDF ohne Text - steht fuer einen Scan, der erkannt werden muss. */
export function makeScanLikePdf(): Uint8Array {
  const content = '0.9 g 60 500 480 260 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>',
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

/** Ein typischer deutscher Behoerdenbrief als Text. */
export const LETTER_TEXT = [
  'AOK Bayern - Die Gesundheitskasse',
  'Postfach 12 34, 80331 Muenchen',
  '',
  'Frau Erika Musterfrau, Musterweg 5, 80333 Muenchen',
  '',
  'Bescheid ueber den Beitrag zur freiwilligen Krankenversicherung',
  'Aktenzeichen: KV-2026-004711',
  'Versichertennummer: A123456789',
  'Datum: 04.09.2026',
  '',
  'Sehr geehrte Frau Musterfrau, hiermit setzen wir Ihren monatlichen',
  'Beitrag zur freiwilligen Krankenversicherung neu fest. Der Beitrag',
  'betraegt ab dem 01.10.2026 monatlich 127,50 EUR. Bitte ueberweisen',
  'Sie den offenen Betrag von 127,50 EUR bis zum 12.09.2026 auf das',
  'unten genannte Konto. Reichen Sie ausserdem die Einkommensnachweise',
  'der letzten drei Monate bis zum 15.09.2026 bei uns ein.',
  '',
  'Mit freundlichen Gruessen',
  'AOK Bayern',
].join('\n');

function wrap(text: string, width: number): string[] {
  return text.split('\n').flatMap((line) => {
    if (line.length <= width) return [line];
    const parts: string[] = [];
    let rest = line;
    while (rest.length > width) {
      const cut = rest.lastIndexOf(' ', width);
      const index = cut > 0 ? cut : width;
      parts.push(rest.slice(0, index));
      rest = rest.slice(index).trim();
    }
    parts.push(rest);
    return parts;
  });
}

function escapePdf(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
