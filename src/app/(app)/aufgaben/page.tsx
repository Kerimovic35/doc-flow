import { PageBody, PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/server/auth/context';

export const metadata = { title: 'Aufgaben | Doc-Flow' };

/**
 * Platzhalter. Der Bereich entsteht in einer der naechsten Ausbaustufen -
 * die Navigation zeigt ihn aber schon, damit die Anwendung vollstaendig
 * begehbar ist und kein Klick ins Leere fuehrt.
 */
export default async function Page() {
  await requireUser();

  return (
    <>
      <PageHeader title="Aufgaben" subtitle="Was noch zu erledigen ist" />
      <PageBody>
        <p className="text-text-muted text-sm">Sobald ein Dokument analysiert wurde, erscheinen hier Aufgaben, Fristen und offene Zahlungen.</p>
      </PageBody>
    </>
  );
}
