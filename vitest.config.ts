import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Konfiguration der Modultests.
 *
 * Integrationstests (*.int.test.ts) sind hier ausgenommen: Sie brauchen eine
 * laufende Datenbank. Die Modultests sollen ohne jede Voraussetzung laufen,
 * damit sie waehrend der Entwicklung staendig ausgefuehrt werden koennen.
 * Siehe vitest.integration.config.ts fuer die Integrationstests.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.int.test.ts'],
  },
});
