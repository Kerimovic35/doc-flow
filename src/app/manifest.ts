import type { MetadataRoute } from 'next';

/**
 * Angaben fuer "Zum Home-Bildschirm hinzufuegen".
 *
 * `display: standalone` laesst die Anwendung ohne Browserleiste starten -
 * auf dem iPhone der Unterschied zwischen "Website" und "App".
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Doc-Flow',
    short_name: 'Doc-Flow',
    description: 'Persönliche Dokumentenablage',
    start_url: '/start',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f6f7f9',
    theme_color: '#f6f7f9',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
