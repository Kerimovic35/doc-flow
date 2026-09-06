import { describe, expect, it } from 'vitest';
import { amountToCents, findAmounts, formatAmount, parseAmount, parseDecimal } from './amount';
import { findDates, formatGerman, parseGermanDate } from './german-date';
import { findIbans, isValidIban } from './iban';
import { addTo, findRelativeDeadline, resolveDeadline } from './relative-deadline';

describe('Deutsche Datumsangaben', () => {
  it('liest die üblichen Schreibweisen', () => {
    expect(parseGermanDate('Datum: 04.09.2026')?.iso).toBe('2026-09-04');
    expect(parseGermanDate('gültig ab 4.9.2026')?.iso).toBe('2026-09-04');
    expect(parseGermanDate('am 4. September 2026')?.iso).toBe('2026-09-04');
    expect(parseGermanDate('am 4. Sept. 2026')?.iso).toBe('2026-09-04');
    expect(parseGermanDate('2026-09-04')?.iso).toBe('2026-09-04');
  });

  it('ergänzt eine zweistellige Jahreszahl am Bezugsjahr', () => {
    expect(parseGermanDate('12.09.26', 2026)?.iso).toBe('2026-09-12');
  });

  it('liest „September 2026" als Monatsende', () => {
    // Umgangssprachlich meint "bis September" das Monatsende, nicht den
    // Ersten.
    const date = parseGermanDate('Zahlung bis September 2026');
    expect(date?.iso).toBe('2026-09-30');
    expect(date?.monthOnly).toBe(true);
  });

  it('verwirft unmögliche Daten', () => {
    // Der 31. Februar ist kein Datum, sondern ein Erkennungsfehler.
    expect(parseGermanDate('31.02.2026')).toBeNull();
    expect(parseGermanDate('04.13.2026')).toBeNull();
    expect(parseGermanDate('00.09.2026')).toBeNull();
  });

  it('findet alle Daten eines Satzes', () => {
    const dates = findDates('Bescheid vom 04.09.2026, zahlbar bis zum 12.09.2026');
    expect(dates.map((date) => date.iso)).toEqual(['2026-09-04', '2026-09-12']);
  });

  it('hält Hausnummern und Aktenzeichen nicht für Daten', () => {
    expect(parseGermanDate('Musterweg 5, 80333 München')).toBeNull();
    expect(parseGermanDate('Kundennummer 123456789')).toBeNull();
  });

  it('formatiert deutsch', () => {
    expect(formatGerman('2026-09-04')).toBe('04.09.2026');
  });
});

describe('Geldbeträge', () => {
  it('liest die üblichen Schreibweisen', () => {
    expect(parseAmount('127,50 EUR')?.cents).toBe(12750);
    expect(parseAmount('127,50 €')?.cents).toBe(12750);
    expect(parseAmount('EUR 1.234,56')?.cents).toBe(123456);
    expect(parseAmount('€ 89')?.cents).toBe(8900);
    expect(parseAmount('12,- €')?.cents).toBe(1200);
  });

  it('verwechselt Tausendertrenner nicht mit dem Komma', () => {
    // Der teuerste denkbare Lesefehler: aus 1.234,56 EUR würden 1,23 EUR.
    expect(parseDecimal('1.234,56')).toBe(123456);
    expect(parseDecimal('1234,56')).toBe(123456);
    expect(parseDecimal('1.234')).toBe(123400);
  });

  it('hält eine Zahl ohne Währung nicht für einen Betrag', () => {
    // In jedem Brief stehen Kundennummern und Hausnummern.
    expect(parseAmount('Kundennummer 123456')).toBeNull();
    expect(parseAmount('Musterweg 5')).toBeNull();
  });

  it('findet mehrere Beträge in einem Satz', () => {
    const amounts = findAmounts('Der Beitrag beträgt 127,50 EUR, die Nachzahlung 45,00 EUR.');
    expect(amounts.map((amount) => amount.cents)).toEqual([12750, 4500]);
  });

  it('rechnet die Modellangabe in Cent um', () => {
    expect(amountToCents('127.50')).toBe(12750);
    expect(amountToCents('127,50')).toBe(12750);
    expect(amountToCents(127.5)).toBe(12750);
    expect(amountToCents('1.234,56')).toBe(123456);
    expect(amountToCents('kein Betrag')).toBeNull();
  });

  it('zeigt Beträge deutsch an', () => {
    expect(formatAmount(12750)).toMatch(/127,50/);
  });
});

describe('IBAN', () => {
  it('erkennt eine gültige IBAN', () => {
    const iban = findIbans('Konto: DE89 3704 0044 0532 0130 00')[0];
    expect(iban?.value).toBe('DE89370400440532013000');
    expect(iban?.formatted).toBe('DE89 3704 0044 0532 0130 00');
  });

  it('verwirft eine IBAN mit falscher Prüfsumme', () => {
    // Eine falsch gelesene Ziffer in einer Kontonummer fällt sonst
    // niemandem auf, bis das Geld woanders ankommt.
    expect(isValidIban('DE89370400440532013001')).toBe(false);
    expect(findIbans('Konto: DE89 3704 0044 0532 0130 01')).toHaveLength(0);
  });

  it('verwirft eine IBAN mit falscher Länge', () => {
    expect(isValidIban('DE8937040044053201')).toBe(false);
  });

  it('erkennt österreichische und Schweizer Konten', () => {
    expect(isValidIban('AT611904300234573201')).toBe(true);
    expect(isValidIban('CH9300762011623852957')).toBe(true);
  });
});

describe('Relative Fristen', () => {
  it('erkennt die gebräuchlichen Wendungen', () => {
    expect(findRelativeDeadline('innerhalb von zwei Wochen')).toEqual({
      amount: 2,
      unit: 'WEEKS',
      anchor: 'DOCUMENT_DATE',
    });

    expect(findRelativeDeadline('binnen 14 Tagen')).toEqual({
      amount: 14,
      unit: 'DAYS',
      anchor: 'DOCUMENT_DATE',
    });

    expect(findRelativeDeadline('innerhalb eines Monats')).toEqual({
      amount: 1,
      unit: 'MONTHS',
      anchor: 'DOCUMENT_DATE',
    });
  });

  it('erkennt den Zugang als Bezugspunkt', () => {
    expect(findRelativeDeadline('14 Tage nach Zugang dieses Bescheids')).toEqual({
      amount: 14,
      unit: 'DAYS',
      anchor: 'RECEIVED_DATE',
    });

    expect(findRelativeDeadline('innerhalb von zwei Wochen nach Erhalt')?.anchor).toBe(
      'RECEIVED_DATE',
    );
  });

  it('rät nicht bei unbekannten Formulierungen', () => {
    // Was hier nicht steht, wird nicht falsch geraten, sondern gar nicht
    // erkannt - dann trägt der Benutzer die Frist nach.
    expect(findRelativeDeadline('zeitnah')).toBeNull();
    expect(findRelativeDeadline('so bald wie möglich')).toBeNull();
  });

  it('rechnet die Frist aus und zeigt die Herleitung', () => {
    const result = resolveDeadline(
      { amount: 2, unit: 'WEEKS', anchor: 'DOCUMENT_DATE' },
      { documentDate: '2026-03-12' },
    );

    expect(result.iso).toBe('2026-03-26');
    // Immer unsicher: Der Bezugspunkt ist eine Annahme.
    expect(result.uncertain).toBe(true);
    expect(result.rule).toContain('12.03.2026');
    expect(result.rule).toContain('26.03.2026');
  });

  it('lässt bei Werktagen das Wochenende aus', () => {
    // Freitag, 6.3.2026 plus drei Werktage = Mittwoch, 11.3.
    expect(addTo('2026-03-06', 3, 'BUSINESS_DAYS')).toBe('2026-03-11');
  });

  it('rechnet Monatsenden richtig', () => {
    // Der 31. Januar plus ein Monat ist der 28. Februar, nicht der 3. März.
    expect(addTo('2026-01-31', 1, 'MONTHS')).toBe('2026-02-28');
    expect(addTo('2024-01-31', 1, 'MONTHS')).toBe('2024-02-29');
    expect(addTo('2026-11-30', 2, 'MONTHS')).toBe('2027-01-30');
  });

  it('liefert ohne Bezugsdatum kein Datum, aber eine Erklärung', () => {
    const result = resolveDeadline({ amount: 2, unit: 'WEEKS', anchor: 'DOCUMENT_DATE' }, {});

    expect(result.iso).toBeNull();
    expect(result.uncertain).toBe(true);
    expect(result.rule).toContain('Bezugsdatum fehlt');
  });

  it('weicht auf das Eingangsdatum aus, wenn das Schreiben keines trägt', () => {
    const result = resolveDeadline(
      { amount: 1, unit: 'WEEKS', anchor: 'DOCUMENT_DATE' },
      { documentDate: null, receivedDate: '2026-03-12' },
    );

    expect(result.iso).toBe('2026-03-19');
  });
});
