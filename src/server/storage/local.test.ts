import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorage } from './local';
import { StorageError } from './provider';

let root: string;
let storage: LocalStorage;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'docflow-storage-'));
  storage = new LocalStorage(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const content = new TextEncoder().encode('Originalinhalt');

describe('Ablage im Dateisystem', () => {
  it('schreibt und liest wieder', async () => {
    await storage.write('u1/d1/original/f1.pdf', content);

    expect(await storage.exists('u1/d1/original/f1.pdf')).toBe(true);
    expect(new TextDecoder().decode(await storage.read('u1/d1/original/f1.pdf'))).toBe(
      'Originalinhalt',
    );
    expect(await storage.size('u1/d1/original/f1.pdf')).toBe(content.byteLength);
  });

  it('legt fehlende Verzeichnisse an', async () => {
    await storage.write('tief/verschachtelt/pfad/datei.png', content);
    expect(await storage.exists('tief/verschachtelt/pfad/datei.png')).toBe(true);
  });

  it('lässt keinen Schlüssel aus dem Verzeichnis heraus', async () => {
    // Die Schluessel entstehen serverseitig; die Pruefung faengt einen
    // kuenftigen Fehler genau dort ab, wo er gefaehrlich waere.
    await expect(storage.write('../ausbruch.txt', content)).rejects.toBeInstanceOf(StorageError);
    expect(() => storage.localPath('u1/../../etc/passwd')).toThrow(StorageError);
    expect(() => storage.localPath('')).toThrow(StorageError);
  });

  it('hinterlässt keine halben Dateien', async () => {
    await storage.write('u1/d1/original/f1.pdf', content);

    const files = await readdir(path.join(root, 'u1/d1/original'));
    // Waehrend des Schreibens existiert eine .tmp-Datei; danach darf keine
    // uebrig sein - eine halbe Datei sieht wie eine vollstaendige aus.
    expect(files).toEqual(['f1.pdf']);
  });

  it('überschreibt eine vorhandene Datei vollständig', async () => {
    await storage.write('u1/d1/derived/p1.webp', new TextEncoder().encode('altes langes Bild'));
    await storage.write('u1/d1/derived/p1.webp', new TextEncoder().encode('neu'));

    expect(new TextDecoder().decode(await storage.read('u1/d1/derived/p1.webp'))).toBe('neu');
  });

  it('entfernt einen ganzen Zweig', async () => {
    await storage.write('u1/d1/derived/p1.webp', content);
    await storage.write('u1/d1/derived/p2.webp', content);
    await storage.write('u1/d1/original/f1.pdf', content);

    await storage.removePrefix('u1/d1/derived');

    // Die Ableitungen sind weg, das Original bleibt - genau darum liegen sie
    // in getrennten Zweigen.
    expect(await storage.exists('u1/d1/derived/p1.webp')).toBe(false);
    expect(await storage.exists('u1/d1/original/f1.pdf')).toBe(true);
  });

  it('meldet fehlende Dateien, statt einen leeren Strom zu liefern', async () => {
    await expect(storage.openRead('u1/d1/original/gibtsnicht.pdf')).rejects.toThrow();
    expect(await storage.exists('u1/d1/original/gibtsnicht.pdf')).toBe(false);
  });

  it('bleibt beim Löschen einer fehlenden Datei ruhig', async () => {
    await expect(storage.remove('u1/d1/original/gibtsnicht.pdf')).resolves.toBeUndefined();
  });

  it('liefert einen Datenstrom für vorhandene Dateien', async () => {
    const target = path.join(root, 'u1/d1/original/f1.pdf');
    await storage.write('u1/d1/original/f1.pdf', content);

    const stream = await storage.openRead('u1/d1/original/f1.pdf');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);

    expect(Buffer.concat(chunks)).toEqual(await readFile(target));
  });

  it('erkennt Fremddateien im Verzeichnis nicht als eigene Schlüssel an', async () => {
    // Eine von Hand abgelegte Datei ist lesbar, sofern der Schluessel passt -
    // aber der Pfad muss weiterhin unterhalb der Wurzel liegen.
    await writeFile(path.join(root, 'fremd.txt'), 'x');
    expect(await storage.exists('fremd.txt')).toBe(true);
    expect(() => storage.localPath('..\\fremd.txt')).toThrow(StorageError);
  });
});
