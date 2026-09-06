/**
 * Textnormalisierung fuer den Zitatvergleich.
 *
 * Das Modell gibt ein Zitat zurueck, das im erkannten Text der Seite stehen
 * soll. Woertlich stimmt es fast nie ueberein: Die Texterkennung setzt
 * Zeilenumbrueche, wo im Modell ein Leerzeichen steht, trennt Woerter am
 * Zeilenende, und typografische Anfuehrungszeichen wechseln zwischen beiden.
 *
 * Diese Funktionen bringen beide Seiten auf eine Form, in der ein ehrliches
 * Zitat sicher gefunden wird - und ein erfundenes weiterhin nicht.
 *
 * Die Zuordnung zurueck auf das Original ist Teil der Aufgabe: Ohne sie
 * liesse sich die Fundstelle spaeter nicht im Seitentext hervorheben.
 */

export interface NormalizedText {
  /** Der vereinheitlichte Text. */
  value: string;
  /** Zu jeder Stelle im vereinheitlichten Text die Stelle im Original. */
  offsets: number[];
}

const QUOTES = /[«»""„“”‟〝〞‚‘’‛]/g;
const DASHES = /[‐‑‒–—―−]/g;
const SOFT_HYPHEN = /­/g;

/**
 * Vereinheitlicht Text und merkt sich, woher jedes Zeichen stammt.
 *
 * Schritte, jeder mit einem eigenen Grund:
 *   NFKC              - zerlegte Umlaute (a + Punkte) werden zu einem Zeichen
 *   Kleinschreibung   - "Bescheid" und "BESCHEID" sind dasselbe Zitat
 *   weiche Trennung   - unsichtbare Trennzeichen fallen weg
 *   Trennung am Ende  - "Versiche-\nrung" wird wieder "versicherung"
 *   Anfuehrung/Strich - die vielen Varianten werden zu einer
 *   Leerraum          - jede Folge aus Leerzeichen und Umbruechen wird eines
 */
export function normalize(text: string): NormalizedText {
  const source = text.normalize('NFKC');

  const characters: string[] = [];
  const offsets: number[] = [];

  let index = 0;
  let lastWasSpace = true; // fuehrenden Leerraum gleich verschlucken

  while (index < source.length) {
    const character = source[index]!;

    // Weiches Trennzeichen: existiert nur zum Umbrechen.
    if (SOFT_HYPHEN.test(character)) {
      SOFT_HYPHEN.lastIndex = 0;
      index += 1;
      continue;
    }
    SOFT_HYPHEN.lastIndex = 0;

    // Trennstrich am Zeilenende: Wort wieder zusammenfuegen.
    if (isHyphen(character)) {
      const rest = source.slice(index + 1);
      const match = /^[ \t]*\r?\n[ \t]*/.exec(rest);
      if (match && /[A-Za-zÄÖÜäöüß]/.test(source[index - 1] ?? '')) {
        index += 1 + match[0].length;
        continue;
      }
    }

    if (/\s/.test(character)) {
      if (!lastWasSpace) {
        characters.push(' ');
        offsets.push(index);
        lastWasSpace = true;
      }
      index += 1;
      continue;
    }

    let normalized = character.toLowerCase();
    if (QUOTES.test(normalized)) normalized = '"';
    QUOTES.lastIndex = 0;
    if (DASHES.test(normalized)) normalized = '-';
    DASHES.lastIndex = 0;

    characters.push(normalized);
    offsets.push(index);
    lastWasSpace = false;

    index += 1;
  }

  // Abschliessenden Leerraum entfernen.
  while (characters.length > 0 && characters[characters.length - 1] === ' ') {
    characters.pop();
    offsets.pop();
  }

  return { value: characters.join(''), offsets };
}

function isHyphen(character: string): boolean {
  return character === '-' || /[‐‑‒–—―]/.test(character);
}

/** Kurzform, wenn die Zuordnung zum Original nicht gebraucht wird. */
export function normalizeSimple(text: string): string {
  return normalize(text).value;
}

/**
 * Entfernt alles ausser Buchstaben und Ziffern.
 *
 * Fuer Aktenzeichen und Kundennummern: "KV-2026 / 004711" und
 * "KV2026004711" sind dieselbe Nummer, und danach wird gesucht.
 */
export function normalizeIdentifier(value: string): string {
  return value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9ÄÖÜ]/g, '');
}
