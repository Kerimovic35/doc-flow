import { PageBody, PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/server/auth/context';

export const metadata = { title: 'Suche | Doc-Flow' };

/**
 * Platzhalter. Der Bereich entsteht in einer der naechsten Ausbaustufen -
 * die Navigation zeigt ihn aber schon, damit die Anwendung vollstaendig
 * begehbar ist und kein Klick ins Leere fuehrt.
 */
export default async function Page() {
  await requireUser();

  return (
    <>
      <PageHeader title="Suche" subtitle="Volltext über alle Dokumente" />
      <PageBody>
        <p className="text-text-muted text-sm">Die Suche steht bereit, sobald Dokumente erfasst und ihr Text erkannt wurde.</p>
      </PageBody>
    </>
  );
}
