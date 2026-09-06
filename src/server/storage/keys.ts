/**
 * Aufbau der Ablageschluessel.
 *
 *   <userId>/<documentId>/original/<fileId>.<ext>
 *   <userId>/<documentId>/derived/<pageId>.webp
 *   <userId>/<documentId>/derived/<pageId>-thumb.webp
 *   <userId>/<documentId>/derived/<pageId>-ocr.png
 *
 * Die Trennung in `original` und `derived` ist der Kern: Was unter `original`
 * liegt, wird nach dem Hochladen nie wieder geschrieben. Alles unter
 * `derived` ist jederzeit neu erzeugbar, wird beim erneuten Verarbeiten
 * vollstaendig verworfen und muss nicht gesichert werden.
 *
 * Es geht ausschliesslich Serverseitiges in einen Schluessel ein. Der
 * Dateiname des Benutzers steht nur als Anzeigefeld in der Datenbank.
 */

export function originalKey(
  userId: string,
  documentId: string,
  fileId: string,
  extension: string,
): string {
  return `${userId}/${documentId}/original/${fileId}.${extension}`;
}

export function pageImageKey(userId: string, documentId: string, pageId: string): string {
  return `${userId}/${documentId}/derived/${pageId}.webp`;
}

export function pageThumbKey(userId: string, documentId: string, pageId: string): string {
  return `${userId}/${documentId}/derived/${pageId}-thumb.webp`;
}

export function pageOcrKey(userId: string, documentId: string, pageId: string): string {
  return `${userId}/${documentId}/derived/${pageId}-ocr.png`;
}

/** Alle Ableitungen eines Dokuments - zum Verwerfen vor dem Neuaufbau. */
export function derivedPrefix(userId: string, documentId: string): string {
  return `${userId}/${documentId}/derived`;
}

/** Alles zu einem Dokument. */
export function documentPrefix(userId: string, documentId: string): string {
  return `${userId}/${documentId}`;
}
