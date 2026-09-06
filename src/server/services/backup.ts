import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { toLibpqUrl } from '@/lib/postgres-url';
import { assertRole } from '@/server/auth/guard';
import type { SessionUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { errorMessage, log } from '@/server/log';

/**
 * Backups.
 *
 * Zwei Teile, weil die Anwendung aus zwei Teilen besteht: die Datenbank mit
 * allem Erkannten und Erschlossenen, und die Originaldateien. Eine
 * Wiederherstellung braucht beide - eine Datenbank ohne Dateien zeigt
 * Dokumente an, die niemand mehr oeffnen kann.
 *
 * Nur die Originale werden gesichert. Seitenbilder und Vorschauen sind
 * jederzeit neu erzeugbar und wuerden das Archiv ohne Gewinn vervielfachen.
 *
 * Eine WIEDERHERSTELLUNG gibt es hier bewusst nicht. Sie wuerde die laufende
 * Datenbank ueberschreiben, und ein Fehlklick waere nicht rueckgaengig zu
 * machen. Der Weg dafuer steht im README und laeuft ueber die Kommandozeile -
 * mit der Bedenkzeit, die ein solcher Schritt braucht.
 */

export type BackupKind = 'DB' | 'FILES_FULL' | 'FILES_INC';

/** Erlaubt sind ausschliesslich die von uns selbst erzeugten Namen. */
const FILENAME_PATTERN =
  /^docflow-(db|files-full|files-inc)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.(dump|tar\.gz)(\.age)?$/;

const FULL_ARCHIVE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function backupDir(): string {
  return path.resolve(process.env.BACKUP_DIR ?? './data/backups');
}

function filesDir(): string {
  return path.resolve(process.env.FILES_DIR ?? './data/files');
}

/**
 * Pfad zu pg_dump. Konfigurierbar, weil das Programm nicht ueberall im
 * Suchpfad liegt: Unter Windows traegt der Installer es nicht ein.
 */
function pgDumpPath(): string {
  // Auf Wahrheitswert pruefen, nicht auf null: In einer .env steht ein nicht
  // gesetzter Wert als leere Zeichenkette, und die liesse `??` durch.
  return process.env.PG_DUMP_PATH || 'pg_dump';
}

/** Empfaenger-Schluessel fuer age. Leer bedeutet: unverschluesselt. */
function ageRecipient(): string | null {
  return process.env.BACKUP_AGE_RECIPIENT || null;
}

export interface BackupFile {
  name: string;
  kind: BackupKind;
  sizeBytes: number;
  createdAt: Date;
  encrypted: boolean;
}

export async function listBackups(actor: SessionUser): Promise<BackupFile[]> {
  assertRole(actor, 'ADMIN');
  return readBackups();
}

async function readBackups(): Promise<BackupFile[]> {
  const dir = backupDir();
  await mkdir(dir, { recursive: true });

  const files: BackupFile[] = [];
  for (const name of await readdir(dir)) {
    if (!FILENAME_PATTERN.test(name)) continue;
    const info = await stat(path.join(dir, name));
    files.push({
      name,
      kind: kindOf(name),
      sizeBytes: info.size,
      createdAt: info.mtime,
      encrypted: name.endsWith('.age'),
    });
  }

  return files.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function kindOf(name: string): BackupKind {
  if (name.includes('-files-full-')) return 'FILES_FULL';
  if (name.includes('-files-inc-')) return 'FILES_INC';
  return 'DB';
}

export type BackupResult =
  | { ok: true; names: string[]; sizeBytes: number }
  | { ok: false; error: string };

/** Vom Benutzer angestossen. */
export async function createBackup(actor: SessionUser): Promise<BackupResult> {
  assertRole(actor, 'ADMIN');
  return runBackup();
}

/**
 * Der naechtliche Lauf.
 *
 * Getrennt vom Aufruf durch den Benutzer, weil hier niemand angemeldet ist,
 * dessen Rolle sich pruefen liesse. `runBackup` selbst wird nicht
 * exportiert - von aussen erreichbar sind nur die beiden Wege mit ihrer
 * jeweils passenden Absicherung.
 */
export async function runScheduledBackup(): Promise<BackupResult> {
  const result = await runBackup();
  if (!result.ok) {
    log.error('backup.failed', { error: result.error });
    return result;
  }

  const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? '30');
  // Erst aufraeumen, wenn ein neuer Abzug wirklich liegt. Sonst loeschte ein
  // dauerhaft scheiternder Lauf nach und nach alle vorhandenen.
  const removed = await pruneOldBackups(Number.isFinite(keepDays) ? keepDays : 30);

  log.info('backup.done', { files: result.names.length, removed });
  return result;
}

async function runBackup(): Promise<BackupResult> {
  const dir = backupDir();
  await mkdir(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/\..+$/, '').replace(/:/g, '-');
  const names: string[] = [];
  let sizeBytes = 0;

  const dump = await dumpDatabase(stamp);
  if (!dump.ok) return dump;
  names.push(dump.name);
  sizeBytes += dump.sizeBytes;

  const archive = await archiveFiles(stamp);
  if (!archive.ok) return { ok: false, error: archive.error };
  if (archive.name) {
    names.push(archive.name);
    sizeBytes += archive.sizeBytes;
  }

  return { ok: true, names, sizeBytes };
}

type StepResult = { ok: true; name: string; sizeBytes: number } | { ok: false; error: string };

async function dumpDatabase(stamp: string): Promise<StepResult> {
  const url = process.env.DATABASE_URL;
  if (!url) return { ok: false, error: 'DATABASE_URL ist nicht gesetzt.' };

  const encrypted = Boolean(ageRecipient());
  const name = `docflow-db-${stamp}.dump${encrypted ? '.age' : ''}`;
  const target = path.join(backupDir(), name);

  // Eigenes Format (-Fc) statt reinem SQL: komprimiert, und pg_restore kann
  // daraus auch einzelne Tabellen einspielen.
  const args = encrypted
    ? ['--format=custom', toLibpqUrl(url)]
    : ['--format=custom', '--file', target, toLibpqUrl(url)];

  return runTool(pgDumpPath(), args, target, name, {
    // Verbindungsdaten gehen als Argument, nicht durch eine Shell - ein
    // Sonderzeichen im Passwort kann so nichts ausloesen.
    pipeToAge: encrypted,
    notFoundHint: `pg_dump wurde nicht gefunden (gesucht: ${pgDumpPath()}). PG_DUMP_PATH in der .env auf den vollständigen Pfad setzen.`,
  });
}

/**
 * Sichert die Originaldateien.
 *
 * Woechentlich vollstaendig, dazwischen nur, was seit dem letzten Archiv
 * hinzugekommen ist. Originale werden nach dem Hochladen nie mehr
 * veraendert, deshalb genuegt der Zeitstempel als Kriterium. Beim
 * Wiederherstellen werden alle Archive der Reihe nach ausgepackt, aeltestes
 * zuerst.
 */
async function archiveFiles(
  stamp: string,
): Promise<{ ok: true; name: string | null; sizeBytes: number } | { ok: false; error: string }> {
  const source = filesDir();

  try {
    await stat(source);
  } catch {
    // Noch keine Dokumente erfasst - nichts zu sichern, kein Fehler.
    return { ok: true, name: null, sizeBytes: 0 };
  }

  const existing = await readBackups();
  const lastFull = existing.find((file) => file.kind === 'FILES_FULL');
  const lastAny = existing.find((file) => file.kind !== 'DB');

  const needsFull =
    !lastFull || Date.now() - lastFull.createdAt.getTime() > FULL_ARCHIVE_MAX_AGE_MS;

  const encrypted = Boolean(ageRecipient());
  const kind = needsFull ? 'files-full' : 'files-inc';
  const name = `docflow-${kind}-${stamp}.tar.gz${encrypted ? '.age' : ''}`;
  const target = path.join(backupDir(), name);

  const args = ['-czf', encrypted ? '-' : target, '-C', source];

  // Unter Windows enthaelt der Zielpfad einen Doppelpunkt (C:\...), und GNU
  // tar haelt alles vor dem Doppelpunkt fuer einen entfernten Rechner. Auf
  // dem Server tritt das nicht auf, in der Entwicklung schon.
  if (process.platform === 'win32') args.unshift('--force-local');
  if (!needsFull && lastAny) {
    // Nur Neues seit dem letzten Archiv.
    args.splice(2, 0, '--newer-mtime', lastAny.createdAt.toISOString());
  }
  args.push('.');

  const result = await runTool('tar', args, target, name, {
    pipeToAge: encrypted,
    notFoundHint: 'tar wurde nicht gefunden. Ohne tar lassen sich die Dateien nicht sichern.',
    allowEmpty: !needsFull,
  });

  if (!result.ok) return result;
  return { ok: true, name: result.name, sizeBytes: result.sizeBytes };
}

/**
 * Fuehrt ein Programm aus und schreibt sein Ergebnis nach `target` - bei
 * gesetztem Schluessel durch `age` hindurch.
 */
function runTool(
  command: string,
  args: string[],
  target: string,
  name: string,
  options: { pipeToAge: boolean; notFoundHint: string; allowEmpty?: boolean },
): Promise<StepResult> {
  return new Promise<StepResult>((resolve) => {
    const recipient = ageRecipient();
    let settled = false;
    const finish = (result: StepResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const discard = async () => {
      await unlink(target).catch(() => undefined);
    };

    const child = spawn(command, args, {
      shell: false,
      stdio: options.pipeToAge ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString().slice(0, 500);
    });

    child.on('error', async (error) => {
      await discard();
      finish({
        ok: false,
        error: error.message.includes('ENOENT')
          ? options.notFoundHint
          : `${command} fehlgeschlagen: ${error.message}`,
      });
    });

    let encryptor: ReturnType<typeof spawn> | null = null;
    if (options.pipeToAge && recipient) {
      encryptor = spawn('age', ['-r', recipient, '-o', target], { shell: false });
      child.stdout?.pipe(encryptor.stdin!);

      encryptor.on('error', async (error) => {
        child.kill();
        await discard();
        finish({
          ok: false,
          error: error.message.includes('ENOENT')
            ? 'age wurde nicht gefunden. Entweder age installieren oder BACKUP_AGE_RECIPIENT leeren.'
            : `Verschlüsselung fehlgeschlagen: ${error.message}`,
        });
      });

      encryptor.on('close', async (code) => {
        if (code !== 0) {
          await discard();
          finish({ ok: false, error: `age endete mit Fehler ${code}` });
          return;
        }
        finish(await verifyResult(target, name, options.allowEmpty === true));
      });
    }

    child.on('close', async (code) => {
      // tar meldet 1, wenn sich eine Datei waehrend des Laufs geaendert hat.
      // Das ist bei unveraenderlichen Originalen kein Grund zum Abbruch.
      const acceptable = code === 0 || (command === 'tar' && code === 1);
      if (!acceptable) {
        encryptor?.kill();
        await discard();
        finish({ ok: false, error: `${command} endete mit Fehler: ${stderr.trim() || code}` });
        return;
      }

      if (!encryptor) {
        finish(await verifyResult(target, name, options.allowEmpty === true));
      }
    });
  });
}

async function verifyResult(
  target: string,
  name: string,
  allowEmpty: boolean,
): Promise<StepResult> {
  try {
    const info = await stat(target);

    // Ein leerer Abzug ist gefaehrlicher als gar keiner: Er taeuscht
    // Sicherheit vor. Bei einem Zuwachs-Archiv ohne neue Dateien ist eine
    // sehr kleine Datei dagegen normal.
    if (info.size === 0 && !allowEmpty) {
      await unlink(target).catch(() => undefined);
      return { ok: false, error: 'Der Abzug blieb leer.' };
    }

    return { ok: true, name, sizeBytes: info.size };
  } catch (error) {
    return { ok: false, error: `Abzug nicht auffindbar: ${errorMessage(error)}` };
  }
}

/**
 * Entfernt Abzuege, die aelter als die Aufbewahrungsfrist sind.
 *
 * Das juengste vollstaendige Dateiarchiv bleibt immer erhalten - ohne es
 * waeren alle spaeteren Zuwachs-Archive wertlos.
 */
export async function pruneOldBackups(keepDays: number): Promise<number> {
  const files = await readBackups();
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const newestFull = files.find((file) => file.kind === 'FILES_FULL');

  let removed = 0;
  for (const file of files) {
    if (file.createdAt.getTime() >= cutoff) continue;
    if (newestFull && file.name === newestFull.name) continue;

    await unlink(path.join(backupDir(), file.name)).catch(() => undefined);
    removed += 1;
  }

  return removed;
}

/**
 * Oeffnet einen Abzug zum Herunterladen.
 *
 * Der Name wird gegen ein festes Muster geprueft und der aufgeloeste Pfad
 * anschliessend noch einmal daraufhin, ob er wirklich im Backup-Verzeichnis
 * liegt. Ohne diese zweite Pruefung liesse sich ueber einen praeparierten
 * Namen eine beliebige Datei des Servers herunterladen.
 */
export async function openBackup(
  actor: SessionUser,
  name: string,
): Promise<{ ok: true; stream: NodeJS.ReadableStream; sizeBytes: number } | { ok: false }> {
  assertRole(actor, 'ADMIN');
  const target = safePath(name);
  if (!target) return { ok: false };

  try {
    const info = await stat(target);
    return { ok: true, stream: createReadStream(target), sizeBytes: info.size };
  } catch {
    return { ok: false };
  }
}

export async function deleteBackup(
  actor: SessionUser,
  name: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  assertRole(actor, 'ADMIN');
  const target = safePath(name);
  if (!target) return { ok: false, error: 'Ungültiger Dateiname.' };

  try {
    await unlink(target);
  } catch {
    return { ok: false, error: 'Datei konnte nicht gelöscht werden.' };
  }

  log.info('backup.deleted', { name });
  return { ok: true };
}

function safePath(name: string): string | null {
  if (!FILENAME_PATTERN.test(name)) return null;
  const dir = backupDir();
  const target = path.resolve(dir, name);
  return path.dirname(target) === dir ? target : null;
}

/** Zeitpunkt des letzten Abzugs, fuer die Systemseite. */
export async function lastBackupAt(): Promise<Date | null> {
  const files = await readBackups().catch(() => []);
  return files[0]?.createdAt ?? null;
}

/** Merkt den letzten Lauf im Systemzustand - unabhaengig vom Dateisystem. */
export async function recordBackupRun(names: string[]): Promise<void> {
  await db.systemState
    .upsert({
      where: { key: 'backup' },
      create: { key: 'backup', value: { at: new Date().toISOString(), names } },
      update: { value: { at: new Date().toISOString(), names } },
    })
    .catch(() => undefined);
}
