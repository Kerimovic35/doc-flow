/**
 * Durchstich: Hochladen, Verarbeiten, Ausliefern.
 *
 * Prueft gegen den laufenden Entwicklungsserver, was Modul- und
 * Integrationstests nicht abdecken koennen: dass Route Handler, Sitzung,
 * Ablage und Worker im Zusammenspiel wirklich funktionieren.
 *
 * Voraussetzung: `npm run dev` laeuft.
 * Aufruf: npx tsx scripts/e2e-upload.ts
 */
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { createPrismaClient } from '../src/server/prisma-client';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const db = createPrismaClient(process.env.DATABASE_URL!);

function hashToken(token: string): string {
  return createHash('sha256').update(`${token}.${process.env.SESSION_SECRET}`).digest('hex');
}

async function makeLetterImage(text: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754">
    <rect width="100%" height="100%" fill="white"/>
    <text x="80" y="160" font-family="DejaVu Sans, Arial" font-size="34">${text}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

async function main() {
  const user = await db.user.findFirstOrThrow({ select: { id: true, email: true } });

  const token = randomBytes(32).toString('base64url');
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const headers = {
    cookie: `docflow_session=${token}`,
    origin: BASE,
    'sec-fetch-site': 'same-origin',
  };

  console.log(`Angemeldet als ${user.email}`);

  // --- Hochladen -------------------------------------------------
  let documentId: string | null = null;

  for (const [index, text] of ['Seite eins', 'Seite zwei'].entries()) {
    const image = await makeLetterImage(text);
    const form = new FormData();
    form.append('datei', new Blob([new Uint8Array(image)], { type: 'image/jpeg' }), `seite${index + 1}.jpg`);
    if (documentId) form.append('documentId', documentId);

    const response = await fetch(`${BASE}/api/dokumente/upload`, {
      method: 'POST',
      headers,
      body: form,
    });
    const data = (await response.json()) as { documentId?: string; error?: string };

    if (!response.ok) throw new Error(`Upload ${index + 1} gescheitert: ${data.error}`);
    documentId ??= data.documentId!;
    console.log(`Seite ${index + 1} hochgeladen (${image.byteLength} Bytes)`);
  }

  // --- Abschliessen ----------------------------------------------
  const finish = await fetch(`${BASE}/api/dokumente/${documentId}/abschliessen`, {
    method: 'POST',
    headers,
  });
  if (!finish.ok) throw new Error(`Abschließen gescheitert: ${await finish.text()}`);
  console.log('Erfassung abgeschlossen, Auftrag steht in der Warteschlange');

  // --- Verarbeitung abwarten -------------------------------------
  const { startWorker } = await import('../src/server/jobs/worker');
  const { HANDLERS } = await import('../src/server/jobs/handlers');
  const worker = startWorker(HANDLERS);

  let status: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const response = await fetch(`${BASE}/api/dokumente/${documentId}/status`, { headers });
    status = (await response.json()) as Record<string, unknown>;
    console.log(`  Status: ${status.processingStatus} ${status.processingStep ?? ''}`);
    if (status.processingStatus !== 'PREPARING' && status.processingStatus !== 'UPLOADED') break;
  }
  await worker.stop();

  // --- Ergebnis pruefen ------------------------------------------
  const pages = await db.documentPage.findMany({
    where: { documentId: documentId! },
    orderBy: { pageNumber: 'asc' },
    select: { id: true, pageNumber: true, imageKey: true, thumbKey: true, ocrInputKey: true },
  });
  console.log(`Seiten in der Datenbank: ${pages.length}`);

  for (const page of pages) {
    const image = await fetch(`${BASE}/api/dokumente/${documentId}/seite/${page.id}`, { headers });
    const thumb = await fetch(
      `${BASE}/api/dokumente/${documentId}/seite/${page.id}?vorschau=1`,
      { headers },
    );
    console.log(
      `  Seite ${page.pageNumber}: Bild ${image.status} (${image.headers.get('content-type')}), Vorschau ${thumb.status}`,
    );
    if (!image.ok || !thumb.ok) throw new Error('Seitenbild nicht auslieferbar');
  }

  const file = await db.documentFile.findFirstOrThrow({ where: { documentId: documentId! } });
  const original = await fetch(`${BASE}/api/dokumente/${documentId}/datei/${file.id}`, { headers });
  console.log(`Original: ${original.status} (${original.headers.get('content-type')})`);

  // --- Zugriffsschutz --------------------------------------------
  const ohneSitzung = await fetch(`${BASE}/api/dokumente/${documentId}/datei/${file.id}`);
  console.log(`Ohne Anmeldung: ${ohneSitzung.status} (erwartet 404)`);
  if (ohneSitzung.status !== 404) throw new Error('Datei war ohne Anmeldung erreichbar!');

  // Ein zweites Konto: Das ist der Fall, der zaehlt, sobald die Anwendung
  // einmal fuer mehrere Benutzer geoeffnet wird.
  const fremd = await db.user.upsert({
    where: { email: 'zugriffsprobe@docflow.local' },
    create: {
      email: 'zugriffsprobe@docflow.local',
      name: 'Zugriffsprobe',
      passwordHash: 'nicht-verwendet',
      role: 'USER',
    },
    update: {},
    select: { id: true },
  });

  const fremdToken = randomBytes(32).toString('base64url');
  await db.session.create({
    data: {
      userId: fremd.id,
      tokenHash: hashToken(fremdToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const fremdHeaders = { ...headers, cookie: `docflow_session=${fremdToken}` };

  const geprueft: Array<[string, string]> = [
    ['Originaldatei', `${BASE}/api/dokumente/${documentId}/datei/${file.id}`],
    ['Seitenbild', `${BASE}/api/dokumente/${documentId}/seite/${pages[0]!.id}`],
    ['Status', `${BASE}/api/dokumente/${documentId}/status`],
  ];

  for (const [name, url] of geprueft) {
    const response = await fetch(url, { headers: fremdHeaders, redirect: 'manual' });
    console.log(`Fremdes Konto, ${name}: ${response.status} (erwartet 404)`);
    if (response.status !== 404) throw new Error(`${name} war aus einem fremden Konto erreichbar!`);
  }

  // Die Detailseite antwortet mit 200, nicht mit 404 - und das ist kein
  // Versehen: Die Huelle der geschuetzten Seiten hat eine Ladeansicht,
  // Next beginnt deshalb sofort zu streamen und hat den Status schon
  // gesendet, wenn notFound() greift. Entscheidend ist, was in der Antwort
  // steht: die Nicht-gefunden-Seite, kein Dokumentinhalt. Genau das wird
  // hier geprueft.
  const detail = await fetch(`${BASE}/dokumente/${documentId}`, {
    headers: fremdHeaders,
    redirect: 'manual',
  });
  const koerper = await detail.text();
  const zeigtInhalt = koerper.includes('seite1.jpg') || koerper.includes('Original öffnen');
  const zeigtNichtGefunden = /Nicht gefunden/i.test(koerper);

  console.log(
    `Fremdes Konto, Detailseite: ${detail.status}, Inhalt sichtbar: ${zeigtInhalt}, Nicht-gefunden-Seite: ${zeigtNichtGefunden}`,
  );
  if (zeigtInhalt || !zeigtNichtGefunden) {
    throw new Error('Die Detailseite gab einem fremden Konto Inhalte preis!');
  }

  await db.session.deleteMany({ where: { userId: fremd.id } });
  await db.user.delete({ where: { id: fremd.id } });

  const fremdeHerkunft = await fetch(`${BASE}/api/dokumente/upload`, {
    method: 'POST',
    headers: { ...headers, 'sec-fetch-site': 'cross-site' },
    body: new FormData(),
  });
  console.log(`Fremde Herkunft: ${fremdeHerkunft.status} (erwartet 403)`);
  if (fremdeHerkunft.status !== 403) throw new Error('Fremde Herkunft wurde akzeptiert!');

  console.log(`\nDurchstich erfolgreich. Dokument: ${BASE}/dokumente/${documentId}`);
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  process.exit(0);
}

main().catch(async (error) => {
  console.error('Durchstich gescheitert:', error);
  process.exit(1);
});
