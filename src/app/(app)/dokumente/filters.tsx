'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui/field';

/**
 * Filterleiste ueber der Dokumentliste.
 *
 * Die Auswahl steht in der Adresse, nicht im Zustand der Komponente: So
 * laesst sich eine gefilterte Ansicht als Lesezeichen behalten, und der
 * Zurueck-Knopf tut, was man erwartet.
 */
export function Filters({
  persons,
  categories,
  selected,
}: {
  persons: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  selected: { person: string; kategorie: string; zustand: string };
}) {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // Bei jeder Filteraenderung zurueck auf die erste Seite - sonst landete
    // man auf Seite 4 einer nun einseitigen Liste.
    next.delete('seite');
    router.push(`/dokumente?${next.toString()}`);
  }

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
      <Select
        aria-label="Person"
        value={selected.person}
        onChange={(event) => update('person', event.target.value)}
        placeholder="Alle Personen"
        options={persons.map((person) => ({ value: person.id, label: person.name }))}
      />

      <Select
        aria-label="Kategorie"
        value={selected.kategorie}
        onChange={(event) => update('kategorie', event.target.value)}
        placeholder="Alle Kategorien"
        options={categories.map((category) => ({ value: category.id, label: category.name }))}
      />

      <Select
        aria-label="Zustand"
        value={selected.zustand}
        onChange={(event) => update('zustand', event.target.value)}
        options={[
          { value: 'aktiv', label: 'Aktiv' },
          { value: 'erledigt', label: 'Erledigt' },
          { value: 'archiviert', label: 'Archiviert' },
          { value: 'alle', label: 'Alle' },
        ]}
        className="col-span-2 md:col-span-1"
      />
    </div>
  );
}
