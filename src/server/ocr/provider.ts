/**
 * Texterkennung.
 *
 * Hinter dieser Schnittstelle steht heute Tesseract als Kindprozess. Sie
 * bleibt schmal, damit sich spaeter ein anderes Verfahren dahinterschieben
 * laesst - etwa ein Bildmodell fuer Seiten, an denen Tesseract scheitert.
 *
 * Die Konfidenz ist kein Beiwerk: Sie entscheidet, ob ein Dokument zur
 * Prüfung vorgelegt wird und wie weit den Belegen der KI zu trauen ist.
 */

export interface OcrPageResult {
  text: string;
  /** Laengengewichtete mittlere Wortkonfidenz, 0 bis 100. */
  confidence: number;
  /** Erkannte Drehung in Grad, falls das Blatt schief eingezogen war. */
  rotation?: number;
}

export interface OcrProvider {
  readonly name: string;
  /** Ist das Verfahren einsatzbereit? */
  available(): Promise<boolean>;
  recognize(image: Uint8Array, options?: { languages?: string }): Promise<OcrPageResult>;
}

/** Fehler der Texterkennung, der einen erneuten Versuch nicht lohnt. */
export class OcrUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcrUnavailableError';
  }
}
