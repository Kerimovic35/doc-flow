import { NextResponse, type NextRequest } from 'next/server';

/**
 * Content-Security-Policy mit Nonce.
 *
 * Der wirksamste Schutz gegen Cross-Site-Scripting: Der Browser fuehrt nur
 * Skripte aus, die den fuer diese eine Antwort erzeugten Nonce tragen. Selbst
 * wenn es einem Angreifer gelaenge, Markup einzuschleusen, bliebe sein Skript
 * unausgefuehrt.
 *
 * Bewusst KEIN 'unsafe-inline' fuer Skripte - das wuerde die Regel
 * aushebeln. Next.js liest den Nonce aus dem CSP-Header und setzt ihn
 * selbsttaetig an seine eigenen Skript-Tags.
 *
 * Bei Stilen ist 'unsafe-inline' unvermeidbar: React setzt beim Streaming
 * Style-Attribute direkt am Element. Inline-Styles sind als Angriffsweg
 * deutlich weniger gefaehrlich als Skripte.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';

  const csp = [
    `default-src 'self'`,
    // 'strict-dynamic' erlaubt einem vertrauenswuerdigen Skript, weitere
    // nachzuladen - das braucht Next.js fuer seine Bundles. 'unsafe-eval'
    // ausschliesslich in der Entwicklung, fuer das Neuladen bei Aenderungen.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isDev ? "'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    // blob: fuer die Vorschau frisch aufgenommener Seiten vor dem Hochladen.
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    // In der Entwicklung braucht das Neuladen eine WebSocket-Verbindung.
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    `frame-ancestors 'none'`,
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `upgrade-insecure-requests`,
  ]
    .filter(Boolean)
    .join('; ')
    .replace(/\s{2,}/g, ' ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Next.js liest den Nonce aus diesem Header der ANFRAGE heraus.
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);

  return response;
}

export const config = {
  matcher: [
    /*
     * Alles ausser statischen Dateien und Bildern. Diese brauchen keine CSP
     * und wuerden den Nonce nur unnoetig pro Datei neu erzeugen.
     */
    {
      source:
        '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-touch-icon.png|manifest.webmanifest).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
