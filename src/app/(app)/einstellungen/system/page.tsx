import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/server/auth/context';
import { getSystemStatus } from '@/server/services/system';

export const metadata = { title: 'System | Doc-Flow' };
export const dynamic = 'force-dynamic';

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
        subtitle="Verarbeitung und Zustand"
        action={<Link href="/einstellungen">Zurück</Link>}
      />
      <PageBody>
        <dl className="border-border bg-surface divide-border divide-y overflow-hidden rounded-2xl border">
          <Row label="Verarbeitung" value={status.workerLabel} />
          <Row label="Wartende Aufträge" value={String(status.pendingJobs)} />
          <Row label="Laufende Aufträge" value={String(status.runningJobs)} />
          <Row label="Gescheiterte Aufträge" value={String(status.failedJobs)} />
          <Row label="Dokumente" value={String(status.documents)} />
          <Row label="Seiten" value={String(status.pages)} />
        </dl>
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
