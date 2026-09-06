import path from 'node:path';
import { createRequire } from 'node:module';
import type { NextConfig } from 'next';

const require = createRequire(import.meta.url);

/**
 * pdfjs braucht zur Laufzeit zwei Datenverzeichnisse aus seinem Paket:
 * Standardschriften (fuer PDFs, die Helvetica & Co. nicht einbetten) und
 * CMap-Tabellen (fuer CJK- und Sonderkodierungen). Next.js kann diese Pfade
 * nicht aus dem Code ableiten, weil sie zur Laufzeit zusammengesetzt werden -
 * ohne die Aufnahme unten fehlen sie im Standalone-Paket und die
 * Seitenaufbereitung scheitert erst in Produktion.
 */
function pdfjsAssetGlobs(): string[] {
  try {
    const pkg = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const rel = path.relative(path.resolve(import.meta.dirname), pkg).split(path.sep).join('/');
    return [`${rel}/standard_fonts/**`, `${rel}/cmaps/**`];
  } catch {
    // Vor dem ersten `npm install` ist das Paket noch nicht da; der Build
    // laeuft dann ohnehin nicht.
    return [];
  }
}

const nextConfig: NextConfig = {
  /*
   * Projektwurzel ausdruecklich festlegen.
   *
   * Ohne diese Angabe sucht Next.js nach oben nach einer package-lock.json
   * und landet unter Umstaenden im Benutzerverzeichnis. Beim Standalone-Build
   * wuerde dann dessen gesamter Inhalt in die Abhaengigkeitsverfolgung
   * einbezogen.
   */
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },

  output: 'standalone',

  outputFileTracingIncludes: {
    '**': pdfjsAssetGlobs(),
  },

  outputFileTracingExcludes: {
    '**': ['data/**', 'backups/**', 'prisma/migrations/**', '.next/cache/**'],
  },

  /*
   * Native Bibliotheken duerfen nicht gebundelt werden: Argon2 (Passwoerter),
   * sharp (libvips), @napi-rs/canvas (Rasterisierung). pdfjs-dist kommt
   * hinzu, weil der Legacy-Build seine Datendateien ueber relative Pfade
   * sucht.
   */
  serverExternalPackages: ['@node-rs/argon2', 'sharp', '@napi-rs/canvas', 'pdfjs-dist'],

  poweredByHeader: false,
  reactStrictMode: true,

  /*
   * Next.js vergleicht bei jeder Server Action die Herkunft der Anfrage mit
   * dem Host - das ist der eigentliche CSRF-Schutz. Hinter einem Reverse
   * Proxy sieht die Anwendung "localhost:3000" als Host, waehrend die
   * Anfrage von der echten Domain kommt. Ohne diese Angabe wuerde jede
   * Aktion in Produktion abgelehnt.
   */
  experimental: {
    serverActions: {
      allowedOrigins: process.env.APP_ORIGIN
        ? [process.env.APP_ORIGIN.replace(/^https?:\/\//, '')]
        : undefined,

      /*
       * Dateien kommen ueber den Route Handler /api/dokumente/upload herein,
       * nicht ueber Server Actions - deshalb reicht hier ein kleines Limit
       * fuer Formulare. Die Groessenpruefung der Dokumente steht in
       * src/lib/validation/upload.ts.
       */
      bodySizeLimit: '2mb',
    },
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Kamera bleibt erlaubt: Dokumente werden mit dem Telefon
          // abfotografiert.
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=()',
          },

          /*
           * HSTS: Der Browser merkt sich, dass diese Domain ausschliesslich
           * ueber HTTPS erreichbar ist, und verweigert danach jeden
           * Klartextversuch von sich aus. Nur in Produktion - lokal laeuft
           * die Anwendung ueber http://localhost, und ein dort gespeicherter
           * HSTS-Eintrag naegelte auch andere lokale Projekte auf HTTPS fest.
           * Bewusst ohne "preload", das ist praktisch unumkehrbar.
           */
          ...(process.env.NODE_ENV === 'production'
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains',
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
