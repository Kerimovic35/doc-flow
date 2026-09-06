'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { SearchIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

/**
 * Suchfeld und Filter.
 *
 * Alles steht in der Adresse, nicht im Zustand der Komponente: Eine gefundene
 * Ansicht laesst sich damit als Lesezeichen behalten, teilen und mit dem
 * Zurueck-Knopf verlassen.
 *
 * Der Suchbegriff wird beim Abschicken uebernommen, nicht bei jedem
 * Tastendruck. Eine Suche, die bei jedem Buchstaben neu laedt, ist auf dem
 * Telefon unruhig und belastet den Server ohne Not.
 */
export function SearchForm({
  query,
  persons,
  categories,
  years,
  selected,
}: {
  query: string;
  persons: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  years: number[];
  selected: { person: string; kategorie: string; jahr: string; frist: boolean };
}) {
  const router = useRouter();
  const [value, setValue] = useState(query);
  const [filtersOpen, setFiltersOpen] = useState(
    Boolean(selected.person || selected.kategorie || selected.jahr || selected.frist),
  );

  function go(overrides: Partial<Record<string, string>> = {}) {
    const params = new URLSearchParams();
    const next = {
      q: value,
      person: selected.person,
      kategorie: selected.kategorie,
      jahr: selected.jahr,
      frist: selected.frist ? '1' : '',
      ...overrides,
    };

    for (const [key, entry] of Object.entries(next)) {
      if (entry) params.set(key, entry);
    }

    router.push(`/suche?${params.toString()}`);
  }

  const activeFilters =
    (selected.person ? 1 : 0) +
    (selected.kategorie ? 1 : 0) +
    (selected.jahr ? 1 : 0) +
    (selected.frist ? 1 : 0);

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          go();
        }}
        className="flex gap-2"
      >
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="AOK, Aktenzeichen, Betrag …"
          // Auf dem iPhone die Suchtastatur statt der Eingabetaste.
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          aria-label="Suchbegriff"
          className="flex-1"
        />
        <Button type="submit" aria-label="Suchen">
          <SearchIcon className="h-5 w-5" />
        </Button>
      </form>

      <button
        type="button"
        onClick={() => setFiltersOpen((open) => !open)}
        className="text-text-muted self-start text-sm font-medium"
      >
        Filter{activeFilters > 0 ? ` (${activeFilters})` : ''} {filtersOpen ? '▴' : '▾'}
      </button>

      {filtersOpen && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Select
            aria-label="Person"
            value={selected.person}
            onChange={(event) => go({ person: event.target.value })}
            placeholder="Alle Personen"
            options={persons.map((person) => ({ value: person.id, label: person.name }))}
          />

          <Select
            aria-label="Kategorie"
            value={selected.kategorie}
            onChange={(event) => go({ kategorie: event.target.value })}
            placeholder="Alle Kategorien"
            options={categories.map((category) => ({ value: category.id, label: category.name }))}
          />

          <Select
            aria-label="Jahr"
            value={selected.jahr}
            onChange={(event) => go({ jahr: event.target.value })}
            placeholder="Alle Jahre"
            options={years.map((year) => ({ value: String(year), label: String(year) }))}
          />

          <button
            type="button"
            onClick={() => go({ frist: selected.frist ? '' : '1' })}
            className={cn(
              'border-border min-h-12 rounded-xl border px-3 text-sm font-medium',
              selected.frist ? 'bg-accent/10 text-accent border-accent' : 'bg-surface text-text-muted',
            )}
          >
            Mit Frist
          </button>
        </div>
      )}
    </div>
  );
}
