import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/server/auth/context';
import { getSystemStatus } from '@/server/services/system';
import { BackupButton } from './backup-panel';
import { deleteBackupAction } from './actions';

export const metadata = { title: 'System | Doc-Flow' };
export const dynamic = 'force-dynamic';

const KIND_LABELS = {
  DB: 'Datenbank',
  FILES_FULL: 'Dateien, vollständig',
  FILES_INC: 'Dateien, Zuwachs',
} as const;

export default async function SystemPage() {
  const user = await requireUser();
  // Doppelt geprueft: Hier nur Kosmetik, verbindlich ist die Pruefung im
  // Dienst.
  if (user.role !== 'ADMIN') notFound();

  const status = await getSystemStatus(user);

  return (
    <>
      <PageHeader
        title="System"
        subtitle="Verarbeitung und Sicherung"
        action={<Link href="/einstellungen">Zurück</Link>}
      />
      <PageBody>
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Zustand</h2>
            <dl className="border-border bg-surface divide-border divide-y overflow-hidden rounded-2xl border">
              <Row label="Verarbeitung" value={status.workerLabel} />
              <Row label="Wartende Aufträge" value={String(status.pendingJobs)} />
              <Row label="Laufende Aufträge" value={String(status.runningJobs)} />
              <Row label="Gescheiterte Aufträge" value={String(status.failedJobs)} />
              <Row label="Dokumente" value={String(status.documents)} />
              <Row label="Seiten" value={String(status.pages)} />
            </dl>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Backups</h2>
            <p className="text-text-muted text-sm">
              Jeder Lauf sichert die Datenbank und die Originaldateien. Wöchentlich vollständig,
              dazwischen nur, was hinzugekommen ist.
              {status.backupsEncrypted
                ? ' Die Abzüge sind mit age verschlüsselt.'
                : ' Die Abzüge sind unverschlüsselt — sie liegen im Klartext auf dem Volume.'}
            </p>

            <BackupButton />

            {status.backups.length === 0 ? (
              <p className="text-text-muted text-sm">Noch kein Abzug vorhanden.</p>
            ) : (
              <ul className="border-border bg-surface divide-border divide-y overflow-hidden rounded-2xl border">
                {status.backups.map((backup) => (
                  <li key={backup.name} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{KIND_LABELS[backup.kind]}</p>
                      <p className="text-text-muted tabular text-xs">
                        {formatDate(backup.createdAt)} · {formatSize(backup.sizeBytes)}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <a
                        href={`/api/system/backup/${encodeURIComponent(backup.name)}`}
                        className="text-accent inline-flex min-h-11 items-center px-2 text-sm font-medium"
                      >
                        Laden
                      </a>
                      <form action={deleteBackupAction}>
                        <input type="hidden" name="name" value={backup.name} />
                        <Button type="submit" variant="ghost">
                          Löschen
                        </Button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-text-muted text-sm">
              Eine Wiederherstellung läuft bewusst über die Kommandozeile:{' '}
              <code className="text-xs">./scripts/restore.sh &lt;datei.dump&gt;</code>
            </p>
          </section>
        </div>
      </PageBody>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-text-muted text-sm">{label}</dt>
      <dd className="tabular text-sm font-medium">{value}</dd>
    </div>
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
