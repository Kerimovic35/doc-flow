import Link from 'next/link';
import { PageBody, PageHeader } from '@/components/ui/page-header';

/**
 * Wird gezeigt, wenn es das Dokument nicht gibt - und wenn es einem anderen
 * Konto gehoert.
 *
 * Bewusst dieselbe Seite fuer beide Faelle: Eine Unterscheidung verriete,
 * dass ein Dokument mit dieser Kennung existiert.
 */
export default function DocumentNotFound() {
  return (
    <>
      <PageHeader title="Nicht gefunden" action={<Link href="/dokumente">Zurück</Link>} />
      <PageBody>
        <p className="text-text-muted text-sm">
          Dieses Dokument gibt es nicht oder es wurde ausgeblendet.
        </p>
      </PageBody>
    </>
  );
}
