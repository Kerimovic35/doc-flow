import { describe, expect, it } from 'vitest';
import { NOTHING_FOUND_TEXT, type ChatAnswer } from '@/lib/ai/chat-schema';
import { verifyAnswer, type ReadPage } from './verify-claims';

const READ: ReadPage[] = [
  {
    documentId: 'doc-1',
    page: 2,
    text: 'Bitte überweisen Sie den offenen Betrag von 127,50 EUR bis zum 12.09.2026.',
  },
  {
    documentId: 'doc-1',
    page: 3,
    text: 'Reichen Sie die Einkommensnachweise bis zum 15.09.2026 ein.',
  },
];

function answer(overrides: Partial<ChatAnswer> = {}): ChatAnswer {
  return {
    facts: [],
    interpretation: null,
    notFound: [],
    answer: 'Antwort.',
    ...overrides,
  };
}

describe('Quellenprüfung der Assistentenantwort', () => {
  it('lässt einen belegten Fakt stehen', () => {
    const result = verifyAnswer(
      answer({
        facts: [
          {
            statement: 'Der offene Betrag beträgt 127,50 EUR.',
            documentId: 'doc-1',
            page: 2,
            quote: 'den offenen Betrag von 127,50 EUR',
          },
        ],
        answer: 'Du musst 127,50 EUR zahlen [F1].',
      }),
      READ,
    );

    expect(result.facts).toHaveLength(1);
    expect(result.removed).toBe(0);
    expect(result.answer).toBe('Du musst 127,50 EUR zahlen [F1].');
    expect(result.facts[0]!.excerpt).toContain('127,50');
  });

  it('entfernt einen Beleg auf eine nie gelesene Seite', () => {
    // Der Kern der Regel: Was das Modell nicht angefordert hat, kann es
    // nicht belegen - auch wenn der Satz plausibel klingt.
    const result = verifyAnswer(
      answer({
        facts: [
          {
            statement: 'Die Widerspruchsfrist beträgt einen Monat.',
            documentId: 'doc-1',
            page: 7,
            quote: 'Der Widerspruch ist innerhalb eines Monats einzulegen',
          },
        ],
        answer: 'Du hast einen Monat Zeit für den Widerspruch [F1].',
      }),
      READ,
    );

    expect(result.facts).toHaveLength(0);
    expect(result.removed).toBe(1);
    // Bleibt kein einziger Beleg uebrig, wird die ganze Behauptung
    // ersetzt - ein Satz mit "(nicht belegt)" darin waere immer noch ein
    // Satz, der etwas behauptet.
    expect(result.answer).toBe(NOTHING_FOUND_TEXT);
  });

  it('entfernt einen Beleg auf ein fremdes Dokument', () => {
    const result = verifyAnswer(
      answer({
        facts: [
          {
            statement: 'Behauptung aus einem anderen Dokument.',
            documentId: 'doc-999',
            page: 2,
            quote: 'den offenen Betrag von 127,50 EUR',
          },
        ],
      }),
      READ,
    );

    expect(result.facts).toHaveLength(0);
    expect(result.removed).toBe(1);
  });

  it('entfernt ein erfundenes Zitat von einer gelesenen Seite', () => {
    const result = verifyAnswer(
      answer({
        facts: [
          {
            statement: 'Es droht eine Mahngebühr von 5 EUR.',
            documentId: 'doc-1',
            page: 2,
            quote: 'Bei Zahlungsverzug wird eine Mahngebühr von 5,00 EUR fällig',
          },
        ],
      }),
      READ,
    );

    expect(result.facts).toHaveLength(0);
    expect(result.removed).toBe(1);
  });

  it('verzeiht Erkennungsfehler im Zitat', () => {
    const result = verifyAnswer(
      answer({
        facts: [
          {
            statement: 'Die Nachweise sind bis 15.09.2026 einzureichen.',
            documentId: 'doc-1',
            page: 3,
            quote: 'Reichen Sie die Einkommensnachwelse bis zum 15.09.2026 ein.',
          },
        ],
      }),
      READ,
    );

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]!.score).toBeLessThan(1);
  });

  it('nummeriert die Fußnoten nach dem Entfernen neu', () => {
    const result = verifyAnswer(
      answer({
        facts: [
          {
            statement: 'Erfunden.',
            documentId: 'doc-1',
            page: 9,
            quote: 'Eine Stelle, die es nicht gibt und die lang genug ist',
          },
          {
            statement: 'Der Betrag beträgt 127,50 EUR.',
            documentId: 'doc-1',
            page: 2,
            quote: 'den offenen Betrag von 127,50 EUR',
          },
        ],
        answer: 'Erstens [F1]. Zweitens [F2].',
      }),
      READ,
    );

    expect(result.facts).toHaveLength(1);
    // Der übrig gebliebene Fakt ist jetzt F1 - sonst zeigte die Fußnote
    // auf den falschen Beleg.
    expect(result.answer).toBe('Erstens (nicht belegt). Zweitens [F1].');
  });

  it('ersetzt eine Antwort ohne jeden Beleg', () => {
    const result = verifyAnswer(
      answer({
        facts: [
          {
            statement: 'Erfunden.',
            documentId: 'doc-1',
            page: 9,
            quote: 'Eine Stelle, die es nicht gibt und die lang genug ist',
          },
        ],
        answer:
          'Deine Mobilfunkrechnung beläuft sich auf 39,99 EUR und ist am Monatsende fällig [F1].',
      }),
      READ,
    );

    // Ohne einen einzigen Beleg darf keine Behauptung stehen bleiben.
    expect(result.answer).toBe(NOTHING_FOUND_TEXT);
  });

  it('lässt eine ehrliche Fehlanzeige stehen', () => {
    const result = verifyAnswer(
      answer({
        facts: [],
        notFound: ['Mobilfunkvertrag'],
        answer: 'Zu deinem Mobilfunkvertrag habe ich nichts gefunden.',
      }),
      READ,
    );

    expect(result.answer).toBe('Zu deinem Mobilfunkvertrag habe ich nichts gefunden.');
    expect(result.notFound).toEqual(['Mobilfunkvertrag']);
  });

  it('lässt eine kurze Antwort ohne Belege stehen', () => {
    const result = verifyAnswer(answer({ facts: [], answer: 'Nein.' }), READ);
    expect(result.answer).toBe('Nein.');
  });

  it('behält die Deutung, auch wenn kein Fakt übrig bleibt', () => {
    // Eine Einordnung ist keine Tatsachenbehauptung - sie muss nur als
    // solche gekennzeichnet sein, und das ist sie durch das Feld.
    const result = verifyAnswer(
      answer({
        facts: [],
        interpretation: 'Vermutlich handelt es sich um eine jährliche Anpassung.',
        answer: 'Dazu finde ich nichts.',
      }),
      READ,
    );

    expect(result.interpretation).toBe('Vermutlich handelt es sich um eine jährliche Anpassung.');
  });
});
