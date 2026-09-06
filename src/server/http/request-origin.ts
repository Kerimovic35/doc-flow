/**
 * Herkunftspruefung fuer Route Handler.
 *
 * Server Actions bringen diese Pruefung mit; ein Route Handler nicht. Da der
 * Upload ueber einen Route Handler laeuft, muss sie hier von Hand stehen.
 *
 * Das Sitzungs-Cookie ist `SameSite=Lax` und wird bei einem fremd
 * ausgeloesten POST ohnehin nicht mitgeschickt. Diese Pruefung ist die
 * zweite Linie: Sie kostet nichts und faengt den Fall ab, dass sich an der
 * Cookie-Einstellung einmal etwas aendert.
 */
export function isSameOrigin(request: Request): boolean {
  // Moderne Browser schicken diesen Header immer mit. "same-origin" ist der
  // eindeutige Fall; "none" bedeutet Adresszeile, "cross-site" ist fremd.
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'same-origin') return true;
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') return false;

  const origin = request.headers.get('origin');
  if (!origin) {
    // Ohne Origin-Header kommt die Anfrage nicht aus einem Browser-Formular.
    // In der Entwicklung ist das ein Werkzeug wie curl, in Produktion
    // ungewoehnlich genug, um sie abzulehnen.
    return process.env.NODE_ENV !== 'production';
  }

  const configured = process.env.APP_ORIGIN;
  if (configured) {
    return normalize(origin) === normalize(configured);
  }

  // Ohne APP_ORIGIN (Entwicklung) gegen den Host der Anfrage pruefen.
  const host = request.headers.get('host');
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function normalize(value: string): string {
  return value.replace(/\/+$/, '').toLowerCase();
}
