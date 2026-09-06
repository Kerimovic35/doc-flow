import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Integrationstests gegen eine echte PostgreSQL-Datenbank.
 *
 * Voraussetzung: die Datenbank `docflow_test` existiert und ist migriert.
 * Sie wird zwischen den Tests geleert und darf deshalb niemals Echtdaten
 * enthalten.
 *
 * Nacheinander statt parallel: Die Tests teilen sich eine Datenbank, ein
 * paralleler Lauf wuerde sich gegenseitig die Tabellen unter den Fuessen
 * wegleeren. Der Nebenlaeufigkeitstest der Auftragsverwaltung erzeugt seine
 * Parallelitaet ausdruecklich selbst.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.int.test.ts'],
    fileParallelism: false,
    // OCR und Bildaufbereitung brauchen laenger als eine Datenbankabfrage.
    testTimeout: 60000,
  },
});
