import { describe, expect, it } from 'vitest';
import { cappedConfidence, checkQuote, type PageText } from './verify-quote';
import { verifyValue } from './verify-fields';

const PAGES: PageText[] = [
  {
    pageNumber: 1,
    text: [
      'AOK Bayern - Die Gesundheitskasse',
      'Bescheid über den Beitrag zur freiwilligen Kranken-',
      'versicherung',
      'Aktenzeichen: KV-2026 / 004711',
      'Datum: 04.09.2026',
    ].join('\n'),
  },
  {
    pageNumber: 2,
    text: [
      'Der Beitrag beträgt ab dem 01.10.2026 monatlich 127,50 EUR.',
      'Bitte überweisen Sie den offenen Betrag bis zum 12.09.2026',
      'auf das Konto DE89 3704 0044 0532 0130 00.',
      'Reichen Sie die Einkommensnachweise bis zum 15.09.2026 ein.',
    ].join('\n'),
  },
  {
    pageNumber: 3,
    text: 'Mit freundlichen Grüßen, AOK Bayern',
  },
];

describe('Zitat gegen den Seitentext prüfen', () => {
  it('bestätigt ein Zitat auf der genannten Seite', () => {
    const result = checkQuote(
      { page: 2, quote: 'Der Beitrag beträgt ab dem 01.10.2026 monatlich 127,50 EUR.' },
      PAGES,
    );

    expect(result.found).toBe(true);
    expect(result.page).toBe(2);
    expect(result.score).toBe(1);
  });

  it('verwirft ein erfundenes Zitat', () => {
    // Der Kern des Halluzinationsschutzes. Der Satz klingt wie aus einem
    // Bescheid - er steht aber nicht darin.
    const result = checkQuote(
      { page: 2, quote: 'Ein Widerspruch ist innerhalb eines Monats schriftlich einzulegen.' },
      PAGES,
    );

    expect(result.found).toBe(false);
    expect(result.page).toBeNull();
  });

  it('findet ein Zitat auch, wenn sich das Modell in der Seite vertut', () => {
    // Modelle verzählen sich; die Angabe deshalb zu verwerfen wäre Strenge
    // am falschen Ort. Die Seitenzahl wird korrigiert.
    const result = checkQuote({ page: 1, quote: 'monatlich 127,50 EUR' }, PAGES);

    expect(result.found).toBe(true);
    expect(result.page).toBe(2);
  });

  it('findet ein Zitat über einen Zeilenumbruch und eine Silbentrennung hinweg', () => {
    const result = checkQuote(
      { page: 1, quote: 'Bescheid über den Beitrag zur freiwilligen Krankenversicherung' },
      PAGES,
    );

    expect(result.found).toBe(true);
    expect(result.page).toBe(1);
  });

  it('verzeiht einen Erkennungsfehler im Zitat', () => {
    const result = checkQuote({ page: 1, quote: 'Aktenzeichen: KV-2026 / OO4711' }, PAGES);

    expect(result.found).toBe(true);
    expect(result.score).toBeGreaterThan(0.85);
    expect(result.score).toBeLessThan(1);
  });

  it('behandelt eine fehlende Fundstelle als unbelegt', () => {
    expect(checkQuote(null, PAGES).found).toBe(false);
  });

  it('kommt mit Seiten ohne erkannten Text zurecht', () => {
    const result = checkQuote({ page: 1, quote: 'irgendein längeres Zitat' }, [
      { pageNumber: 1, text: null },
    ]);

    expect(result.found).toBe(false);
  });

  it('merkt sich, wenn der Text aus einem Bildmodell stammt', () => {
    const result = checkQuote({ page: 1, quote: 'Aktenzeichen: KV-2026 / 004711' }, [
      { ...PAGES[0]!, fromVision: true },
    ]);

    expect(result.found).toBe(true);
    expect(result.fromVision).toBe(true);
  });
});

describe('Wert gegen die Fundstelle prüfen', () => {
  it('bestätigt ein Datum, das im Zitat steht', () => {
    expect(verifyValue('DATE', '2026-09-12', 'Bitte überweisen Sie bis zum 12.09.2026')).toBe(
      'VERIFIED',
    );
  });

  it('bestätigt ein Datum NICHT, das im Zitat nicht steht', () => {
    // Der gefährlichste Fall: eine echte Textstelle, daneben ein Datum, das
    // dort nicht steht. Es sieht aus wie ein Beleg, ist aber keiner.
    expect(verifyValue('DATE', '2026-10-12', 'Bitte überweisen Sie bis zum 12.09.2026')).toBe(
      'QUOTE_ONLY',
    );
  });

  it('prüft Beträge auf den Cent', () => {
    expect(verifyValue('AMOUNT', '127.50', 'monatlich 127,50 EUR')).toBe('VERIFIED');
    expect(verifyValue('AMOUNT', '127.05', 'monatlich 127,50 EUR')).toBe('QUOTE_ONLY');
    expect(verifyValue('AMOUNT', '1234.56', 'Rechnungsbetrag 1.234,56 EUR')).toBe('VERIFIED');
  });

  it('prüft die IBAN gegen ihre Prüfsumme', () => {
    expect(
      verifyValue('IBAN', 'DE89370400440532013000', 'Konto DE89 3704 0044 0532 0130 00'),
    ).toBe('VERIFIED');

    // Eine falsch gelesene Ziffer fällt sonst niemandem auf, bis das Geld
    // woanders ankommt.
    expect(verifyValue('IBAN', 'DE89370400440532013001', 'Konto DE89 3704 0044 0532 0130 00')).toBe(
      'UNVERIFIED',
    );
  });

  it('lässt eine sinnvolle Kürzung beim Absender zu', () => {
    // Im Brief steht der volle Name, im Feld gehört der kurze.
    expect(verifyValue('TEXT', 'AOK Bayern', 'AOK Bayern - Die Gesundheitskasse')).toBe('VERIFIED');
  });

  it('erkennt einen erfundenen Absender', () => {
    expect(verifyValue('TEXT', 'Techniker Krankenkasse', 'AOK Bayern - Die Gesundheitskasse')).toBe(
      'QUOTE_ONLY',
    );
  });

  it('wertet ohne Fundstelle grundsätzlich als unbelegt', () => {
    expect(verifyValue('DATE', '2026-09-12', null)).toBe('UNVERIFIED');
    expect(verifyValue('TEXT', 'AOK', null)).toBe('UNVERIFIED');
  });

  it('lässt einen leeren Wert als nicht prüfbar gelten', () => {
    expect(verifyValue('TEXT', null, 'irgendein Zitat')).toBe('QUOTE_ONLY');
  });
});

describe('Sicherheit begrenzen', () => {
  it('deckelt eine unbelegte Angabe deutlich', () => {
    // Sie bleibt sichtbar, fällt aber sofort als unbestätigt auf.
    expect(cappedConfidence(98, 'UNVERIFIED', false)).toBe(30);
  });

  it('deckelt Angaben aus Bildmodell-Text', () => {
    // Der "Beleg" ist dann selbst Modellausgabe, keine Erkennung.
    expect(cappedConfidence(95, 'VERIFIED', true)).toBe(70);
  });

  it('lässt eine belegte Angabe unangetastet', () => {
    expect(cappedConfidence(93, 'VERIFIED', false)).toBe(93);
    expect(cappedConfidence(93, 'QUOTE_ONLY', false)).toBe(93);
  });

  it('hält den Wert im erlaubten Bereich', () => {
    expect(cappedConfidence(140, 'VERIFIED', false)).toBe(100);
    expect(cappedConfidence(-5, 'VERIFIED', false)).toBe(0);
  });
});

describe('Laengengrenzen des Zitats', () => {
  it('verwirft ein zu kurzes Zitat, auch wenn es im Text steht', () => {
    // "AOK" kommt woertlich vor, belegt aber nichts - drei Zeichen passen
    // in jeden Brief. Frueher hielt das Schema solche Zitate ab.
    expect(checkQuote({ page: 1, quote: 'AOK' }, PAGES).found).toBe(false);
  });

  it('verwirft ein Zitat, das laenger als eine Belegstelle ist', () => {
    const zuLang = 'x'.repeat(241);
    expect(checkQuote({ page: 1, quote: zuLang }, PAGES).found).toBe(false);
  });

  it('nimmt ein Zitat an der unteren Grenze an', () => {
    expect(checkQuote({ page: 1, quote: 'Bescheid' }, PAGES).found).toBe(true);
  });
});
