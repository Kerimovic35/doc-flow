/**
 * Ablage fuer Dateien.
 *
 * Heute das Dateisystem des Servers. Die Schnittstelle bleibt schmal, damit
 * spaeter ein Objektspeicher dahinterpassen kann, ohne dass ein Dienst davon
 * erfaehrt.
 *
 * Ein Schluessel ist ein relativer Pfad mit Schraegstrichen, gebildet
 * ausschliesslich aus serverseitigen IDs - niemals aus einem Dateinamen des
 * Benutzers. Damit ist der Weg zu einer fremden Datei konstruktiv
 * ausgeschlossen, nicht erst durch eine Pruefung.
 */
export interface StorageProvider {
  /** Schreibt und ersetzt dabei eine vorhandene Datei. */
  write(key: string, content: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  /** Datenstrom fuer das Ausliefern grosser Dateien. */
  openRead(key: string): Promise<NodeJS.ReadableStream>;
  exists(key: string): Promise<boolean>;
  size(key: string): Promise<number>;
  remove(key: string): Promise<void>;
  /** Entfernt einen ganzen Zweig, etwa alle Ableitungen eines Dokuments. */
  removePrefix(prefix: string): Promise<void>;
  /** Nur fuer Werkzeuge, die einen echten Pfad brauchen (Tesseract). */
  localPath(key: string): string;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}
