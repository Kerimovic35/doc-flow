import { describe, expect, it } from 'vitest';
import { parseOrientation, parseTsv } from './confidence';

const HEADER =
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';

/** Baut eine Wortzeile so, wie Tesseract sie ausgibt. */
function word(
  options: { block?: number; paragraph?: number; line?: number; conf: number; text: string },
): string {
  const { block = 1, paragraph = 1, line = 1, conf, text } = options;
  return `5\t1\t${block}\t${paragraph}\t${line}\t1\t10\t20\t30\t40\t${conf}\t${text}`;
}

describe('TSV-Ausgabe auswerten', () => {
  it('setzt Wörter zu Zeilen zusammen', () => {
    const tsv = [
      HEADER,
      word({ line: 1, conf: 95, text: 'AOK' }),
      word({ line: 1, conf: 93, text: 'Bayern' }),
      word({ line: 2, conf: 90, text: 'Bescheid' }),
    ].join('\n');

    const result = parseTsv(tsv);

    // Die Zeilenstruktur muss erhalten bleiben: Die spaetere Belegpruefung
    // sucht Zitate im Text, und ein Zitat aus einer Adresszeile findet sich
    // nur, wenn die Zeile eine Zeile geblieben ist.
    expect(result.text).toBe('AOK Bayern\nBescheid');
    expect(result.wordCount).toBe(3);
  });

  it('trennt Absätze durch eine Leerzeile', () => {
    const tsv = [
      HEADER,
      word({ paragraph: 1, line: 1, conf: 90, text: 'Erster' }),
      word({ paragraph: 2, line: 2, conf: 90, text: 'Zweiter' }),
    ].join('\n');

    expect(parseTsv(tsv).text).toBe('Erster\n\nZweiter');
  });

  it('gewichtet die Sicherheit nach Wortlänge', () => {
    const tsv = [
      HEADER,
      word({ conf: 30, text: '-' }),
      word({ conf: 95, text: 'Krankenversicherungsbeitrag' }),
    ].join('\n');

    const result = parseTsv(tsv);

    // Ungewichtet käme 63 heraus - ein einzelner Bindestrich würde die
    // Seite als unsicher erscheinen lassen, obwohl das lange Wort sicher
    // erkannt wurde.
    expect(result.confidence).toBeGreaterThan(90);
  });

  it('ignoriert Zeilen ohne Aussage zur Sicherheit', () => {
    const tsv = [
      HEADER,
      '1\t1\t0\t0\t0\t0\t0\t0\t800\t300\t-1\t',
      '4\t1\t1\t1\t1\t0\t40\t71\t306\t37\t-1\t',
      word({ conf: 88, text: 'Bescheid' }),
    ].join('\n');

    const result = parseTsv(tsv);
    expect(result.wordCount).toBe(1);
    expect(result.confidence).toBe(88);
  });

  it('liefert für eine leere Seite kein falsches Vertrauen', () => {
    const result = parseTsv(HEADER);
    expect(result.text).toBe('');
    expect(result.confidence).toBe(0);
    expect(result.wordCount).toBe(0);
  });

  it('bleibt bei unbrauchbarer Ausgabe ruhig', () => {
    // Ohne Kopfzeile ist nicht erkennbar, welche Spalte was bedeutet -
    // lieber leer als geraten.
    const result = parseTsv('irgendwas ohne Struktur');
    expect(result.text).toBe('');
    expect(result.confidence).toBe(0);
  });
});

describe('Ausrichtung erkennen', () => {
  it('liest den Drehwinkel aus der Ausgabe', () => {
    const output = [
      'Page number: 0',
      'Orientation in degrees: 270',
      'Rotate: 90',
      'Orientation confidence: 12.34',
    ].join('\n');

    expect(parseOrientation(output)).toBe(90);
  });

  it('nimmt nur die vier sinnvollen Winkel an', () => {
    expect(parseOrientation('Rotate: 45')).toBe(0);
    expect(parseOrientation('Rotate: 180')).toBe(180);
    expect(parseOrientation('keine Angabe')).toBe(0);
  });
});
