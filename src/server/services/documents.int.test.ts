import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { actorFor, resetTestDb, seedBasics, testDb } from '@/test/integration-db';
import { LETTER_TEXT, makeImage, makeTextPdf } from '@/test/fixtures';

vi.mock('@/server/db', async () => {
  const { testDb: client } = await import('@/test/integration-db');
  return { db: client };
});

let filesRoot: string;

beforeAll(async () => {
  filesRoot = await mkdtemp(path.join(tmpdir(), 'docflow-files-'));
  process.env.FILES_DIR = filesRoot;
});

afterAll(async () => {
  await rm(filesRoot, { recursive: true, force: true });
});

const { createDocument, addFile, finishUpload, listDocuments, getDocument, softDeleteDocument, restoreDocument, discardDraft, openOriginal } =
  await import('./documents');
const { storage } = await import('@/server/storage/local');

let userId: string;
let personId: string;

beforeEach(async () => {
  await resetTestDb();
  ({ userId, personId } = await seedBasics());
});

describe('Dokument erfassen', () => {
  it('nimmt mehrere Fotos als ein Dokument an und behält die Reihenfolge', async () => {
    const actor = actorFor(userId);
    const document = await createDocument(actor, { personId });

    for (const seite of ['seite1.jpg', 'seite2.jpg', 'seite3.jpg']) {
      const result = await addFile(actor, document.id, {
        content: await makeImage(),
        originalName: seite,
        declaredMimeType: 'image/jpeg',
      });
      expect(result.ok).toBe(true);
    }

    const finished = await finishUpload(actor, document.id);
    expect(finished.ok).toBe(true);

    const stored = await getDocument(actor, document.id);
    expect(stored?.files.map((file) => file.originalName)).toEqual([
      'seite1.jpg',
      'seite2.jpg',
      'seite3.jpg',
    ]);
    expect(stored?.files.map((file) => file.sortOrder)).toEqual([0, 1, 2]);

    // Das Erfassen stellt den Verarbeitungsauftrag ein.
    const job = await testDb.processingJob.findFirst({ where: { documentId: document.id } });
    expect(job?.type).toBe('INGEST');
  });

  it('legt die Originaldatei unverändert in der Ablage ab', async () => {
    const actor = actorFor(userId);
    const document = await createDocument(actor);
    const content = await makeImage({ width: 800, height: 1000 });

    const result = await addFile(actor, document.id, {
      content,
      originalName: 'brief.jpg',
      declaredMimeType: 'image/jpeg',
    });
    expect(result.ok).toBe(true);

    const file = await testDb.documentFile.findFirstOrThrow({
      where: { documentId: document.id },
    });
    const stored = await storage().read(file.storageKey);

    // Byte fuer Byte dasselbe: Das Original ist unantastbar.
    expect(Buffer.from(stored)).toEqual(Buffer.from(content));
    expect(file.sizeBytes).toBe(content.byteLength);
  });

  it('bildet den Ablagepfad nur aus Server-IDs', async () => {
    const actor = actorFor(userId);
    const document = await createDocument(actor);

    await addFile(actor, document.id, {
      content: await makeImage(),
      originalName: '../../etc/passwd.jpg',
      declaredMimeType: 'image/jpeg',
    });

    const file = await testDb.documentFile.findFirstOrThrow({
      where: { documentId: document.id },
    });

    // Der Name des Benutzers steht nur als Anzeigefeld in der Datenbank.
    expect(file.storageKey).not.toContain('..');
    expect(file.storageKey).toMatch(new RegExp(`^${userId}/${document.id}/original/`));
    expect(file.originalName).toBe('../../etc/passwd.jpg');
  });

  it('lehnt eine Datei ab, deren Inhalt nicht zum Typ passt', async () => {
    const actor = actorFor(userId);
    const document = await createDocument(actor);

    const result = await addFile(actor, document.id, {
      content: makeTextPdf(['Ein Text']),
      originalName: 'foto.jpg',
      declaredMimeType: 'image/jpeg',
    });

    expect(result.ok).toBe(false);
    // Kein halber Zustand: weder Eintrag noch Datei.
    expect(await testDb.documentFile.count({ where: { documentId: document.id } })).toBe(0);
  });

  it('meldet eine Dublette, ohne sie abzulehnen', async () => {
    const actor = actorFor(userId);
    const content = await makeImage();

    const first = await createDocument(actor);
    await addFile(actor, first.id, {
      content,
      originalName: 'a.jpg',
      declaredMimeType: 'image/jpeg',
    });

    const second = await createDocument(actor);
    const result = await addFile(actor, second.id, {
      content,
      originalName: 'b.jpg',
      declaredMimeType: 'image/jpeg',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Vielleicht liegt derselbe Bescheid absichtlich zweimal vor - die
    // Entscheidung trifft der Benutzer, nicht die Anwendung.
    expect(result.duplicateOf).toBe(first.id);
  });

  it('nimmt nach dem Abschließen keine weitere Datei mehr an', async () => {
    const actor = actorFor(userId);
    const document = await createDocument(actor);
    await addFile(actor, document.id, {
      content: await makeImage(),
      originalName: 'a.jpg',
      declaredMimeType: 'image/jpeg',
    });
    await testDb.document.update({
      where: { id: document.id },
      data: { processingStatus: 'PREPARING' },
    });

    const result = await addFile(actor, document.id, {
      content: await makeImage(),
      originalName: 'b.jpg',
      declaredMimeType: 'image/jpeg',
    });

    expect(result.ok).toBe(false);
  });

  it('schließt nicht ab, wenn keine Datei angekommen ist', async () => {
    const actor = actorFor(userId);
    const document = await createDocument(actor);

    const result = await finishUpload(actor, document.id);
    expect(result.ok).toBe(false);
    expect(await testDb.processingJob.count()).toBe(0);
  });

  it('übernimmt keine fremde Person', async () => {
    const fremd = await seedBasics({ email: 'fremd@docflow.local', name: 'Fremd' });
    const fremdePerson = await testDb.person.findFirstOrThrow({ where: { userId: fremd.userId } });

    const document = await createDocument(actorFor(userId), { personId: fremdePerson.id });

    const stored = await testDb.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(stored.personId).toBeNull();
  });
});

describe('Zugriff auf Dokumente', () => {
  it('zeigt einem fremden Konto weder Liste noch Datei', async () => {
    const actor = actorFor(userId);
    const document = await createDocument(actor);
    await addFile(actor, document.id, {
      content: await makeImage(),
      originalName: 'a.jpg',
      declaredMimeType: 'image/jpeg',
    });
    const file = await testDb.documentFile.findFirstOrThrow({
      where: { documentId: document.id },
    });

    const fremd = await seedBasics({ email: 'fremd@docflow.local', name: 'Fremd' });
    const fremdActor = actorFor(fremd.userId);

    expect((await listDocuments(fremdActor)).items).toHaveLength(0);
    expect(await getDocument(fremdActor, document.id)).toBeNull();
    expect(await openOriginal(fremdActor, document.id, file.id)).toBeNull();
  });

  it('blendet aus statt zu löschen und holt zurück', async () => {
    const actor = actorFor(userId);
    const document = await createDocument(actor);
    await addFile(actor, document.id, {
      content: await makeImage(),
      originalName: 'a.jpg',
      declaredMimeType: 'image/jpeg',
    });

    await softDeleteDocument(actor, document.id);

    expect((await listDocuments(actor)).items).toHaveLength(0);
    expect(await getDocument(actor, document.id)).toBeNull();
    // Die Zeile und die Datei sind weiterhin da - die Anwendung ist ein
    // Langzeitarchiv.
    expect(await testDb.document.findUnique({ where: { id: document.id } })).not.toBeNull();

    await restoreDocument(actor, document.id);
    expect((await listDocuments(actor)).items).toHaveLength(1);
  });

  it('verwirft einen nie abgeschlossenen Entwurf samt Dateien', async () => {
    const actor = actorFor(userId);
    const document = await createDocument(actor);
    await addFile(actor, document.id, {
      content: await makeImage(),
      originalName: 'a.jpg',
      declaredMimeType: 'image/jpeg',
    });
    const file = await testDb.documentFile.findFirstOrThrow({
      where: { documentId: document.id },
    });

    await discardDraft(actor, document.id);

    expect(await testDb.document.findUnique({ where: { id: document.id } })).toBeNull();
    expect(await storage().exists(file.storageKey)).toBe(false);
  });

  it('verwirft ein bereits verarbeitetes Dokument nicht', async () => {
    const actor = actorFor(userId);
    const document = await createDocument(actor);
    await testDb.document.update({
      where: { id: document.id },
      data: { processingStatus: 'DONE' },
    });

    await discardDraft(actor, document.id);

    expect(await testDb.document.findUnique({ where: { id: document.id } })).not.toBeNull();
  });

  it('filtert die Liste nach Person und Kategorie', async () => {
    const actor = actorFor(userId);
    const category = await testDb.category.findFirstOrThrow({
      where: { userId, slug: 'krankenkasse' },
    });

    const mit = await createDocument(actor, { personId, categoryId: category.id });
    const ohne = await createDocument(actor);

    const gefiltert = await listDocuments(actor, { personId });
    expect(gefiltert.items.map((item) => item.id)).toEqual([mit.id]);

    const alle = await listDocuments(actor);
    expect(alle.items.map((item) => item.id).sort()).toEqual([mit.id, ohne.id].sort());
  });
});

describe('PDF-Text erkennen', () => {
  it('hält den Text eines echten Brief-PDFs für brauchbar', async () => {
    const { isUsableText } = await import('@/server/files/pdf');
    expect(isUsableText(LETTER_TEXT)).toBe(true);
  });
});
