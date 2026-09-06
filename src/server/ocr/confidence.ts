/**
 * Auswertung der Tesseract-Ausgabe im TSV-Format.
 *
 * TSV statt reinem Text, weil nur dort die Konfidenz je Wort steht. Ohne sie
 * waere nicht erkennbar, ob eine Seite gut gelesen wurde oder ob Tesseract
 * geraten hat - und genau das entscheidet, ob ein Dokument zur Prüfung
 * vorgelegt wird.
 *
 * Reine Funktion, damit sie ohne Tesseract testbar bleibt.
 */

interface Word {
  text: string;
  confidence: number;
  level: number;
  block: number;
  paragraph: number;
  line: number;
}

export interface ParsedOcr {
  text: string;
  confidence: number;
  wordCount: number;
}

const LEVEL_WORD = 5;

export function parseTsv(tsv: string): ParsedOcr {
  const lines = tsv.split(/\r?\n/);
  const header = lines[0]?.split('\t') ?? [];

  const index = {
    level: header.indexOf('level'),
    block: header.indexOf('block_num'),
    paragraph: header.indexOf('par_num'),
    line: header.indexOf('line_num'),
    conf: header.indexOf('conf'),
    text: header.indexOf('text'),
  };

  // Ohne Kopfzeile ist die Ausgabe unbrauchbar - lieber leer als geraten.
  if (index.conf < 0 || index.text < 0) {
    return { text: '', confidence: 0, wordCount: 0 };
  }

  const words: Word[] = [];

  for (const raw of lines.slice(1)) {
    if (!raw.trim()) continue;
    const columns = raw.split('\t');

    const level = Number(columns[index.level] ?? '0');
    if (level !== LEVEL_WORD) continue;

    const text = (columns[index.text] ?? '').trim();
    if (!text) continue;

    const confidence = Number(columns[index.conf] ?? '-1');
    // -1 bedeutet "keine Aussage" und darf den Mittelwert nicht verzerren.
    if (!Number.isFinite(confidence) || confidence < 0) continue;

    words.push({
      text,
      confidence,
      level,
      block: Number(columns[index.block] ?? '0'),
      paragraph: Number(columns[index.paragraph] ?? '0'),
      line: Number(columns[index.line] ?? '0'),
    });
  }

  return {
    text: joinLines(words),
    confidence: weightedConfidence(words),
    wordCount: words.length,
  };
}

/**
 * Setzt die Woerter zu Zeilen und Absaetzen zusammen.
 *
 * Das Layout bleibt dabei grob erhalten: Ein Zeilenumbruch, wo Tesseract
 * eine neue Zeile sieht, eine Leerzeile zwischen Absaetzen. Das ist keine
 * Kosmetik - die spaetere Belegpruefung sucht Zitate im Text, und ein Zitat
 * aus einer Adresszeile findet sich nur, wenn die Zeile eine Zeile geblieben
 * ist.
 */
function joinLines(words: Word[]): string {
  const parts: string[] = [];
  let currentLine: string[] = [];
  let lastKey: string | null = null;
  let lastParagraph: string | null = null;

  for (const word of words) {
    const lineKey = `${word.block}-${word.paragraph}-${word.line}`;
    const paragraphKey = `${word.block}-${word.paragraph}`;

    if (lastKey !== null && lineKey !== lastKey) {
      parts.push(currentLine.join(' '));
      currentLine = [];
      if (lastParagraph !== null && paragraphKey !== lastParagraph) parts.push('');
    }

    currentLine.push(word.text);
    lastKey = lineKey;
    lastParagraph = paragraphKey;
  }

  if (currentLine.length > 0) parts.push(currentLine.join(' '));

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Mittelwert, gewichtet nach Wortlaenge.
 *
 * Ein ungewichteter Mittelwert liesse sich von einzelnen Satzzeichen
 * verziehen: Ein sicher erkanntes "-" zaehlte genauso viel wie ein unsicher
 * gelesenes "Krankenversicherungsbeitrag".
 */
function weightedConfidence(words: Word[]): number {
  if (words.length === 0) return 0;

  let weight = 0;
  let sum = 0;

  for (const word of words) {
    const length = Math.max(1, word.text.length);
    weight += length;
    sum += word.confidence * length;
  }

  return Math.round(sum / weight);
}

/**
 * Liest die Drehung aus der Ausrichtungserkennung (--psm 0).
 *
 * Ein quer eingescanntes Blatt liest Tesseract praktisch gar nicht. Die
 * Ausgabe nennt den Winkel, um den das Bild gedreht werden muss.
 */
export function parseOrientation(output: string): number {
  const match = /Rotate:\s*(\d+)/.exec(output);
  if (!match) return 0;

  const degrees = Number(match[1]);
  return [0, 90, 180, 270].includes(degrees) ? degrees : 0;
}
