import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Doc-Flow',
  description: 'Persönliche Dokumentenablage mit Texterkennung und Fristenübersicht',
  // Ermoeglicht "Zum Home-Bildschirm hinzufuegen" mit eigenem Startbildschirm.
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Doc-Flow',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    // iOS ignoriert SVG an dieser Stelle und wuerde sonst ein verkleinertes
    // Bildschirmfoto der Seite als Symbol verwenden.
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  // Private Anwendung: niemals in Suchmaschinen aufnehmen.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Laesst den Inhalt bis unter die Home-Indicator-Zone laufen; die Leisten
  // halten ueber env(safe-area-inset-*) selbst Abstand.
  viewportFit: 'cover',
  // Zoom bleibt bewusst erlaubt - er wird beim Lesen gescannter Seiten
  // gebraucht.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0c1015' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
