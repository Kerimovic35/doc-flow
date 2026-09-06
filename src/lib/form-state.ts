/**
 * Gemeinsamer Rueckgabetyp aller Formular-Aktionen.
 *
 * `error` traegt die Meldung zum gesamten Vorgang ("Nicht genügend Bestand"),
 * `fieldErrors` die Meldungen zu einzelnen Feldern. Beides getrennt, damit
 * eine Feldmeldung direkt unter dem betroffenen Feld erscheinen kann statt
 * als Sammelmeldung am Formularende.
 */
export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Fasst die Zod-Fehler zu einer Zuordnung Feldname -> Meldung zusammen.
 *
 * Nur die erste Meldung je Feld: Mehrere Hinweise am selben Feld
 * ueberfordern eher, als dass sie helfen.
 */
export function toFieldErrors(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  for (const issue of issues) {
    const key = String(issue.path[0] ?? '');
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }

  return fieldErrors;
}
