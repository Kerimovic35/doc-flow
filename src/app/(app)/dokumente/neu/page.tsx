import Link from 'next/link';
import { PageBody, PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/server/auth/context';
import { listCategories } from '@/server/services/categories';
import { listPersons } from '@/server/services/persons';
import { CaptureForm } from './capture-form';

export const metadata = { title: 'Dokument hinzufügen | Doc-Flow' };

export default async function NewDocumentPage() {
  const actor = await requireUser();

  const [persons, categories] = await Promise.all([listPersons(actor), listCategories(actor)]);

  return (
    <>
      <PageHeader
        title="Dokument hinzufügen"
        action={<Link href="/dokumente">Abbrechen</Link>}
      />
      <PageBody>
        <CaptureForm
          persons={persons.filter((person) => person.active).map(({ id, name }) => ({ id, name }))}
          categories={categories
            .filter((category) => category.active)
            .map(({ id, name }) => ({ id, name }))}
        />
      </PageBody>
    </>
  );
}
