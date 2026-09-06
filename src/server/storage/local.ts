import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { StorageError, type StorageProvider } from './provider';

/**
 * Ablage im Dateisystem des Servers.
 *
 * In Produktion zeigt FILES_DIR auf ein eingehaengtes Volume. Der
 * Containerstart bricht ab, wenn dieses Verzeichnis nicht beschreibbar ist -
 * eine Anwendung, die Dokumente entgegennimmt und beim naechsten Deployment
 * verliert, waere schlimmer als eine, die gar nicht startet.
 */
export class LocalStorage implements StorageProvider {
  private readonly root: string;

  constructor(root?: string) {
    this.root = path.resolve(root ?? process.env.FILES_DIR ?? './data/files');
  }

  /**
   * Loest einen Schluessel zu einem Pfad auf und stellt sicher, dass er
   * unterhalb der Wurzel bleibt.
   *
   * Die Schluessel entstehen ausschliesslich serverseitig, ein Ausbruch ist
   * also ohnehin nicht vorgesehen. Die Pruefung steht trotzdem hier: Sie
   * kostet nichts und faengt einen kuenftigen Fehler an der einen Stelle ab,
   * an der er wirklich gefaehrlich waere.
   */
  localPath(key: string): string {
    if (!key || key.includes('\0')) {
      throw new StorageError('Ungültiger Ablageschlüssel.');
    }

    const target = path.resolve(this.root, key);
    const relative = path.relative(this.root, target);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new StorageError('Ablageschlüssel zeigt aus dem Verzeichnis heraus.');
    }

    return target;
  }

  /**
   * Schreibt ueber eine temporaere Datei und benennt sie erst am Ende um.
   *
   * Ein Absturz mitten im Schreiben hinterliesse sonst ein halbes Original -
   * und ein halbes Original sieht wie ein vollstaendiges aus.
   */
  async write(key: string, content: Uint8Array): Promise<void> {
    const target = this.localPath(key);
    await mkdir(path.dirname(target), { recursive: true });

    const temporary = `${target}.${process.pid}.tmp`;
    const handle = await open(temporary, 'w');
    try {
      await handle.write(content);
      // Erst wenn die Daten wirklich auf der Platte sind, darf umbenannt
      // werden - sonst zeigt der Name auf einen leeren Puffer.
      await handle.sync();
    } finally {
      await handle.close();
    }

    await rename(temporary, target).catch(async (error) => {
      await unlink(temporary).catch(() => undefined);
      throw error;
    });
  }

  async read(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.localPath(key)));
  }

  async openRead(key: string): Promise<NodeJS.ReadableStream> {
    const target = this.localPath(key);
    // Vorher pruefen, damit ein fehlender Schluessel als Fehler ankommt und
    // nicht erst als abgebrochener Datenstrom beim Browser.
    await stat(target);
    return createReadStream(target);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.localPath(key));
      return true;
    } catch {
      return false;
    }
  }

  async size(key: string): Promise<number> {
    const info = await stat(this.localPath(key));
    return info.size;
  }

  async remove(key: string): Promise<void> {
    await unlink(this.localPath(key)).catch(() => undefined);
  }

  async removePrefix(prefix: string): Promise<void> {
    await rm(this.localPath(prefix), { recursive: true, force: true });
  }
}

let cached: StorageProvider | null = null;

/** Die Ablage der Anwendung. */
export function storage(): StorageProvider {
  cached ??= new LocalStorage();
  return cached;
}

/** Nur fuer Tests: setzt die zwischengespeicherte Ablage zurueck. */
export function resetStorage(): void {
  cached = null;
}
