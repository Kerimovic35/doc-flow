/**
 * Regeln fuer hochgeladene Dateien.
 *
 * Bewusst unter src/lib und nicht unter src/server: Das Upload-Formular ist
 * eine Client-Komponente und braucht dieselben Grenzwerte. Ein Import aus
 * einem Dienst zoege den Datenbank-Client ins Browser-Bundle.
 */

/**
 * Erlaubte Dateitypen.
 *
 * SVG fehlt mit Absicht: Es ist ein XML-Format, das Skripte enthalten kann.
 * Von der eigenen Domain ausgeliefert waere eine praeparierte SVG-Datei ein
 * Einfallstor fuer Code im Kontext der Anwendung.
 *
 * HEIC fehlt ebenfalls: Die vorkompilierte Fassung von sharp kann es nicht
 * lesen. iPhones liefern beim Hochladen ueblicherweise JPEG; wo doch HEIC
 * ankommt, ist eine klare Absage besser als ein Absturz in der Verarbeitung.
 */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** Fuer das `accept`-Attribut des Dateifelds. */
export const ACCEPT_ATTRIBUTE = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*';

/** Groesste Einzeldatei: ein langer Scan in guter Aufloesung passt darunter. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Mehr Seiten fotografiert man nicht am Stueck; PDFs zaehlen als eine Datei. */
export const MAX_FILES_PER_DOCUMENT = 20;

export function isAllowedMimeType(value: string): value is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Erkennt den Dateityp an den ersten Bytes.
 *
 * Der vom Browser gemeldete Typ wird NICHT geglaubt - er stammt aus der
 * Dateiendung und laesst sich frei setzen. Erst diese Pruefung stellt sicher,
 * dass spaeter beim Ausliefern auch wirklich das im Content-Type steht, was
 * in der Datei ist.
 */
export function sniffMimeType(bytes: Uint8Array): AllowedMimeType | null {
  // %PDF
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf';

  // \x89 P N G \r \n \x1a \n
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // JPEG beginnt immer mit SOI und einem Markerbyte.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // RIFF....WEBP - die vier Bytes dazwischen sind die Dateilaenge.
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * Erkennt HEIC/HEIF, um eine verstaendliche Meldung geben zu koennen statt
 * eines allgemeinen "Format nicht unterstuetzt".
 */
export function looksLikeHeic(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  // ....ftyp
  const isFtyp =
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  if (!isFtyp) return false;

  const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
  return ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand);
}

/** Menschenlesbare Groesse fuer die Anzeige. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Dateiendung zum erkannten Typ - fuer den Namen in der Ablage. */
export function extensionFor(mimeType: AllowedMimeType): string {
  switch (mimeType) {
    case 'application/pdf':
      return 'pdf';
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
  }
}

export type CheckedUpload = { ok: true; mimeType: AllowedMimeType } | { ok: false; error: string };

/**
 * Die Pruefung einer hochgeladenen Datei.
 *
 * Liefert den ERKANNTEN Typ zurueck, nicht den gemeldeten. Genau dieser Typ
 * wird gespeichert und spaeter als Content-Type ausgeliefert.
 */
export function checkUpload(
  content: Uint8Array,
  declaredMimeType: string,
  maxBytes: number = MAX_FILE_BYTES,
): CheckedUpload {
  if (content.byteLength === 0) {
    return { ok: false, error: 'Die Datei ist leer.' };
  }

  if (content.byteLength > maxBytes) {
    return {
      ok: false,
      error: `Die Datei ist zu groß (höchstens ${Math.round(maxBytes / 1024 / 1024)} MB).`,
    };
  }

  const sniffed = sniffMimeType(content);
  if (!sniffed) {
    if (looksLikeHeic(content)) {
      return {
        ok: false,
        error:
          'HEIC-Bilder können nicht gelesen werden. Auf dem iPhone unter Einstellungen › Kamera › Formate „Maximale Kompatibilität" wählen oder das Bild als JPEG teilen.',
      };
    }
    return { ok: false, error: 'Nur PDF, JPEG, PNG und WebP sind möglich.' };
  }

  // Widerspricht die Angabe des Browsers dem Inhalt, ist etwas faul.
  if (isAllowedMimeType(declaredMimeType) && declaredMimeType !== sniffed) {
    return { ok: false, error: 'Der Inhalt der Datei passt nicht zu ihrem Typ.' };
  }

  return { ok: true, mimeType: sniffed };
}
