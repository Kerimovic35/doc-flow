import { describe, expect, it } from 'vitest';
import { checkUpload, extensionFor, looksLikeHeic, sniffMimeType } from './upload';

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

/** Ein Puffer der gewuenschten Groesse mit der Signatur am Anfang. */
function padded(signature: number[], size: number): Uint8Array {
  const buffer = new Uint8Array(size);
  buffer.set(signature, 0);
  return buffer;
}

const PDF = [0x25, 0x50, 0x44, 0x46];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];

describe('Dateityp erkennen', () => {
  it('erkennt die erlaubten Formate an ihrer Signatur', () => {
    expect(sniffMimeType(bytes(...PDF))).toBe('application/pdf');
    expect(sniffMimeType(bytes(...PNG))).toBe('image/png');
    expect(sniffMimeType(bytes(...JPEG))).toBe('image/jpeg');
    expect(sniffMimeType(bytes(...WEBP))).toBe('image/webp');
  });

  it('lehnt SVG ab', () => {
    // SVG ist XML und kann Skripte enthalten. Von der eigenen Domain
    // ausgeliefert waere das ein Einfallstor.
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(sniffMimeType(svg)).toBeNull();
  });

  it('erkennt HEIC, um eine hilfreiche Meldung geben zu können', () => {
    const heic = bytes(0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63);
    expect(sniffMimeType(heic)).toBeNull();
    expect(looksLikeHeic(heic)).toBe(true);
  });

  it('verwechselt RIFF ohne WEBP nicht mit einem Bild', () => {
    const wav = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45);
    expect(sniffMimeType(wav)).toBeNull();
  });
});

describe('Hochgeladene Datei prüfen', () => {
  it('nimmt eine gültige Datei an und liefert den erkannten Typ', () => {
    const result = checkUpload(padded(PDF, 5000), 'application/pdf');
    expect(result).toEqual({ ok: true, mimeType: 'application/pdf' });
  });

  it('glaubt der Angabe des Browsers nicht', () => {
    // Eine als PDF deklarierte PNG-Datei: Der Inhalt entscheidet, und der
    // Widerspruch wird abgelehnt.
    const result = checkUpload(padded(PNG, 5000), 'application/pdf');
    expect(result.ok).toBe(false);
  });

  it('nimmt eine Datei ohne brauchbare Typangabe trotzdem an', () => {
    // Manche Browser schicken beim Teilen aus der Galerie einen leeren Typ.
    const result = checkUpload(padded(JPEG, 5000), '');
    expect(result).toEqual({ ok: true, mimeType: 'image/jpeg' });
  });

  it('lehnt leere Dateien ab', () => {
    expect(checkUpload(new Uint8Array(0), 'application/pdf').ok).toBe(false);
  });

  it('lehnt zu große Dateien ab', () => {
    const result = checkUpload(padded(PDF, 2000), 'application/pdf', 1000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/zu groß/);
  });

  it('nennt bei HEIC den Weg zur Lösung', () => {
    const heic = padded([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 5000);
    const result = checkUpload(heic, 'image/heic');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Eine Fehlermeldung, die nur "nicht unterstuetzt" sagt, laesst den
    // Benutzer ratlos zurueck.
    expect(result.error).toMatch(/HEIC/);
    expect(result.error).toMatch(/Kompatibilität/);
  });
});

describe('Dateiendung', () => {
  it('bildet jeden erlaubten Typ ab', () => {
    expect(extensionFor('application/pdf')).toBe('pdf');
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/png')).toBe('png');
    expect(extensionFor('image/webp')).toBe('webp');
  });
});
