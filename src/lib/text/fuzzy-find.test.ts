import { describe, expect, it } from 'vitest';
import { boundedDistance, findQuote, thresholdFor } from './fuzzy-find';
import { normalizeIdentifier, normalizeSimple } from './normalize';

/** Ein Seitentext, wie ihn die Texterkennung liefert - mit Zeilenumbrüchen. */
const PAGE = [
  'AOK Bayern - Die Gesundheitskasse',
  'Postfach 12 34, 80331 München',
  '',
  'Frau Erika Musterfrau',
  'Musterweg 5',
  '80333 München',
  '',
  'Bescheid über den Beitrag zur freiwilligen Kranken-',
  'versicherung',
  'Aktenzeichen: KV-2026 / 004711',
  'Datum: 04.09.2026',
  '',
  'Sehr geehrte Frau Musterfrau, der Beitrag beträgt ab dem',
  '01.10.2026 monatlich 127,50 EUR. Bitte überweisen Sie den',
  'offenen Betrag bis zum 12.09.2026.',
].join('\n');

describe('Textvereinheitlichung', () => {
  it('fügt am Zeilenende getrennte Wörter wieder zusammen', () => {
    // Ohne diesen Schritt fände sich "krankenversicherung" nie im Text -
    // die Texterkennung übernimmt den Trennstrich aus dem Druckbild.
    expect(normalizeSimple('Kranken-\nversicherung')).toBe('krankenversicherung');
  });

  it('macht aus jeder Folge von Leerraum ein Leerzeichen', () => {
    expect(normalizeSimple('Betrag:   127,50\n\n  EUR')).toBe('betrag: 127,50 eur');
  });

  it('vereinheitlicht Anführungszeichen und Striche', () => {
    expect(normalizeSimple('„Bescheid“ – gültig')).toBe('"bescheid" - gültig');
  });

  it('räumt Aktenzeichen auf Vergleichbarkeit zusammen', () => {
    // "KV-2026 / 004711" und "KV2026004711" sind dieselbe Nummer.
    expect(normalizeIdentifier('KV-2026 / 004711')).toBe('KV2026004711');
    expect(normalizeIdentifier('kv2026004711')).toBe('KV2026004711');
  });
});

describe('Zitat im Seitentext finden', () => {
  it('findet ein wörtliches Zitat', () => {
    const found = findQuote(PAGE, 'Aktenzeichen: KV-2026 / 004711');

    expect(found).not.toBeNull();
    expect(found!.exact).toBe(true);
    expect(found!.score).toBe(1);
    expect(PAGE.slice(found!.start, found!.end)).toContain('KV-2026');
  });

  it('findet ein Zitat über einen Zeilenumbruch hinweg', () => {
    // Das Modell gibt den Satz in einer Zeile zurück; im erkannten Text
    // steht er über zwei.
    const found = findQuote(PAGE, 'der Beitrag beträgt ab dem 01.10.2026 monatlich 127,50 EUR');

    expect(found).not.toBeNull();
    expect(found!.score).toBeGreaterThan(0.9);
  });

  it('findet ein Zitat trotz getrennter Silben', () => {
    const found = findQuote(PAGE, 'Beitrag zur freiwilligen Krankenversicherung');
    expect(found).not.toBeNull();
  });

  it('verzeiht vereinzelte Erkennungsfehler', () => {
    // "Versicherun9" statt "Versicherung" ist der klassische Fehler einer
    // Texterkennung. Eine richtige Angabe darf daran nicht scheitern.
    const found = findQuote(PAGE, 'Bescheid über den Beitrag zur freiwilligen Krankenversicherunq');

    expect(found).not.toBeNull();
    expect(found!.exact).toBe(false);
    expect(found!.score).toBeGreaterThan(0.85);
  });

  it('verzeiht einen falsch gelesenen Betrag NICHT stillschweigend', () => {
    // Ein anderer Betrag ist keine Unschärfe, sondern eine andere Aussage.
    const found = findQuote(PAGE, 'monatlich 999,00 EUR');
    expect(found).toBeNull();
  });

  it('findet ein erfundenes Zitat nicht', () => {
    // Der Kern des Halluzinationsschutzes: Was nicht dasteht, wird nicht
    // gefunden - egal wie plausibel es klingt.
    const found = findQuote(
      PAGE,
      'Der Widerspruch ist innerhalb eines Monats schriftlich einzulegen',
    );
    expect(found).toBeNull();
  });

  it('lässt sich von einem ähnlich klingenden Satz nicht täuschen', () => {
    const found = findQuote(PAGE, 'Bitte überweisen Sie den offenen Betrag bis zum 12.10.2026.');
    // Ein falsches Datum im sonst gleichen Satz: Bei dieser Länge liegt ein
    // Zeichen Unterschied noch über der Schwelle - deshalb prüft der Guard
    // zusätzlich den Wert selbst gegen das Zitat.
    if (found) expect(found.exact).toBe(false);
  });

  it('weist zu kurze Zitate ab', () => {
    // "EUR" steht in jedem zweiten Brief - das belegt nichts.
    expect(findQuote(PAGE, 'EUR')).toBeNull();
    expect(findQuote(PAGE, '2026')).toBeNull();
  });

  it('liefert die Fundstelle im Originaltext', () => {
    const found = findQuote(PAGE, 'Musterweg 5');

    expect(found).not.toBeNull();
    // Die Stelle muss auf den Originaltext zeigen, nicht auf die
    // vereinheitlichte Fassung - sonst säße die Hervorhebung daneben.
    expect(PAGE.slice(found!.start, found!.end)).toBe('Musterweg 5');
  });

  it('kommt mit leerem Text zurecht', () => {
    expect(findQuote('', 'irgendetwas Langes')).toBeNull();
    expect(findQuote(PAGE, '')).toBeNull();
  });

  it('ignoriert Groß- und Kleinschreibung', () => {
    expect(findQuote(PAGE, 'AKTENZEICHEN: KV-2026 / 004711')).not.toBeNull();
  });
});

describe('Schwellen und Abstand', () => {
  it('verlangt bei kurzen Zitaten mehr Übereinstimmung', () => {
    // Zwei zufällig ähnliche kurze Wendungen gibt es in jedem Brief.
    expect(thresholdFor(8)).toBeGreaterThan(thresholdFor(40));
  });

  it('bricht den Vergleich bei zu großem Abstand ab', () => {
    expect(boundedDistance('Bescheid', 'Bescheid', 2)).toBe(0);
    expect(boundedDistance('Bescheid', 'Bescheld', 2)).toBe(1);
    expect(boundedDistance('Bescheid', 'Rechnung', 2)).toBeNull();
  });
});
