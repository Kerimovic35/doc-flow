/**
 * Technisches Protokoll.
 *
 * Bewusst ohne Bibliothek: Es wird nur nach stdout geschrieben, und Coolify
 * sammelt das ohnehin ein. Wichtiger als der Funktionsumfang ist die Regel
 * dahinter.
 *
 * NIEMALS Dokumentinhalte protokollieren - kein OCR-Text, keine Zitate, keine
 * Betraege, keine Absender. Erlaubt sind Ereignisname, IDs, Zaehler, Dauer und
 * Fehlerklassen. Wer im Protokoll nachlesen kann, was in einem Arztbrief
 * steht, hat die Vertraulichkeit der Anwendung ausgehebelt.
 */

type Fields = Record<string, string | number | boolean | null | undefined>;

function emit(level: 'info' | 'warn' | 'error', event: string, fields?: Fields): void {
  const line = { level, event, time: new Date().toISOString(), ...fields };

  // In der Entwicklung lesbar, in Produktion als JSON fuer die Auswertung.
  if (process.env.NODE_ENV === 'development') {
    const extra = fields
      ? ' ' +
        Object.entries(fields)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(' ')
      : '';
    console[level](`[${event}]${extra}`);
    return;
  }

  console[level](JSON.stringify(line));
}

export const log = {
  info: (event: string, fields?: Fields) => emit('info', event, fields),
  warn: (event: string, fields?: Fields) => emit('warn', event, fields),
  error: (event: string, fields?: Fields) => emit('error', event, fields),
};

/**
 * Reduziert einen unbekannten Fehler auf eine protokolltaugliche Zeile.
 * Die Meldung kann von einer Bibliothek stammen und wird deshalb gekuerzt.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300);
  return String(error).slice(0, 300);
}
