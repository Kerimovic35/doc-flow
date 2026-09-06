import { describe, expect, it } from 'vitest';
import { dayKey, millisecondsUntilNextRun } from './schedule-time';

describe('Zeitpunkt des nächsten Laufs', () => {
  it('wartet bis heute Abend, wenn der Termin noch bevorsteht', () => {
    const now = new Date(2026, 8, 6, 1, 0, 0);
    const ms = millisecondsUntilNextRun(now, 3, 30);

    expect(ms).toBe((2 * 60 + 30) * 60 * 1000);
  });

  it('springt auf morgen, wenn der Termin heute vorbei ist', () => {
    const now = new Date(2026, 8, 6, 4, 0, 0);
    const ms = millisecondsUntilNextRun(now, 3, 30);

    expect(ms).toBe((23 * 60 + 30) * 60 * 1000);
  });

  it('behandelt den Termin auf die Minute genau als vergangen', () => {
    // Sonst liefe der Auftrag bei einem Start genau zur vollen Minute
    // moeglicherweise zweimal.
    const now = new Date(2026, 8, 6, 3, 30, 0);
    const ms = millisecondsUntilNextRun(now, 3, 30);

    expect(ms).toBe(24 * 60 * 60 * 1000);
  });
});

describe('Tagesschlüssel', () => {
  it('bildet das Datum in Ortszeit ab', () => {
    // Ortszeit, nicht UTC: Sonst bekaeme ein Lauf um 3:30 deutscher Zeit im
    // Sommer den Schluessel des Vortages und liefe zweimal.
    expect(dayKey(new Date(2026, 8, 6, 3, 30))).toBe('2026-09-06');
    expect(dayKey(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });
});
