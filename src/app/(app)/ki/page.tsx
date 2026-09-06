import { PageBody, PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/server/auth/context';

export const metadata = { title: 'KI-Assistent | Doc-Flow' };

/**
 * Platzhalter. Der Bereich entsteht in einer der naechsten Ausbaustufen -
 * die Navigation zeigt ihn aber schon, damit die Anwendung vollstaendig
 * begehbar ist und kein Klick ins Leere fuehrt.
 */
export default async function Page() {
  await requireUser();

  return (
    <>
      <PageHeader title="KI-Assistent" subtitle="Fragen zu deinen Dokumenten" />
      <PageBody>
        <p className="text-text-muted text-sm">Der Assistent antwortet ausschließlich anhand deiner Dokumente und nennt zu jeder Aussage die Fundstelle.</p>
      </PageBody>
    </>
  );
}
