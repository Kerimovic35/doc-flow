import next from 'eslint-config-next';
import nextTypescript from 'eslint-config-next/typescript';
import coreWebVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...next,
  ...coreWebVitals,
  ...nextTypescript,
  {
    ignores: ['src/generated/**', 'node_modules/**', '.next/**'],
  },
  {
    rules: {
      // Ungenutzte Variablen sind ein Fehler, ausser sie sind mit _ als
      // absichtlich ungenutzt markiert.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
];

export default config;
