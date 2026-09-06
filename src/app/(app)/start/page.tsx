import { PageBody, PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/server/auth/context';

export const metadata = { title: 'Start | Doc-Flow' };

/**
 * Das Dashboard. In dieser Ausbaustufe nur die Begruessung - Handlungsbedarf,
 * Fristen und Zahlungen kommen, sobald es Dokumente gibt, die sie liefern.
 */
export default async function StartPage() {
  const user = await requireUser();

  return (
    <>
      <PageHeader title={greeting(new Date())} subtitle={user.name} />
      <PageBody>
        <p className="text-text-muted text-sm">
          Noch keine Dokumente erfasst. Über „Dokument hinzufügen“ geht es los.
        </p>
      </PageBody>
    </>
  );
}

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 11) return 'Guten Morgen';
  if (hour < 18) return 'Guten Tag';
  return 'Guten Abend';
}
