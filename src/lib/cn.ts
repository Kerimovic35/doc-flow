/**
 * Fuegt Klassennamen zusammen und laesst falsche Werte weg.
 *
 * Bewusst ohne `tailwind-merge`: Die Komponenten dieser Anwendung geben ihre
 * Klassen selbst vor, Konflikte durch Ueberschreiben treten nicht auf.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
