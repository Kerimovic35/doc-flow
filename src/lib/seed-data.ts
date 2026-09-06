/**
 * Mitgelieferte Startdaten.
 *
 * Liegt in `lib`, weil sowohl der Serverstart (bootstrap.ts) als auch das
 * Seed-Skript sie brauchen - und beide dieselbe Liste verwenden muessen,
 * sonst haetten Entwicklung und Produktion unterschiedliche Kategorien.
 */

export interface SeedCategory {
  slug: string;
  name: string;
}

/**
 * Die zwoelf Kategorien decken den privaten Briefverkehr ab. Der Benutzer
 * kann sie umbenennen und eigene ergaenzen; loeschen laesst sich eine
 * mitgelieferte Kategorie nicht, weil Dokumente daran haengen koennten.
 *
 * "Sonstiges" steht bewusst am Ende: Es ist der Auffangkorb, wenn die
 * Einordnung nicht eindeutig ist.
 */
export const SEED_CATEGORIES: SeedCategory[] = [
  { slug: 'behoerden', name: 'Behörden' },
  { slug: 'krankenkasse', name: 'Krankenkasse' },
  { slug: 'versicherung', name: 'Versicherung' },
  { slug: 'arbeit', name: 'Arbeit' },
  { slug: 'finanzen', name: 'Finanzen' },
  { slug: 'vertraege', name: 'Verträge' },
  { slug: 'mobilfunk', name: 'Mobilfunk' },
  { slug: 'rechnungen', name: 'Rechnungen' },
  { slug: 'bescheide', name: 'Bescheide' },
  { slug: 'zertifikate', name: 'Zertifikate' },
  { slug: 'quittungen', name: 'Quittungen' },
  { slug: 'sonstiges', name: 'Sonstiges' },
];

/**
 * Die erste Person ist immer der Kontoinhaber selbst. Weitere Personen legt
 * der Benutzer an - welche Angehoerigen es gibt, kann die Anwendung nicht
 * erraten.
 */
export const SELF_PERSON_NAME = 'Ich';
