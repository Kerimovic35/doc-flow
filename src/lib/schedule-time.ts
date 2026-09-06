/**
 * Zeitrechnung fuer den taeglichen Auftrag.
 *
 * Bewusst hier und nicht im Zeitgeber selbst: reine Funktionen, ohne
 * Datenbank und ohne Framework - und damit ohne laufende Umgebung testbar.
 */

/** Millisekunden bis zum naechsten Termin (heute oder morgen). */
export function millisecondsUntilNextRun(now: Date, hour: number, minute: number): number {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

/**
 * Datum als YYYY-MM-DD in Ortszeit - taugt als Eindeutigkeitsschluessel.
 *
 * Ortszeit, nicht UTC: Ein Lauf um 3:30 deutscher Zeit bekaeme in UTC das
 * Datum des Vortages und liefe dadurch zweimal.
 */
export function dayKey(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
