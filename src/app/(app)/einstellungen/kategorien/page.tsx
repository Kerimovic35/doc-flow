import Link from 'next/link';
import { PageBody, PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/server/auth/context';
import { listCategories } from '@/server/services/categories';
import { NewCategoryForm, RenameCategoryForm } from './category-forms';
import { toggleCategoryAction } from './actions';

export const metadata = { title: 'Kategorien | Doc-Flow' };

export default async function CategoriesPage() {
  const actor = await requireUser();
  const categories = await listCategories(actor);

  return (
    <>
      <PageHeader
        title="Kategorien"
        subtitle="Einordnung der Dokumente"
        action={<Link href="/einstellungen">Zurück</Link>}
      />
      <PageBody>
        <div className="flex flex-col gap-4">
          <p className="text-text-muted text-sm">
            Mitgelieferte Kategorien lassen sich umbenennen, aber nicht löschen — an ihnen können
            Dokumente hängen. Ausblenden genügt.
          </p>

          <ul className="border-border bg-surface divide-border divide-y overflow-hidden rounded-2xl border">
            {categories.map((category) => (
              <li key={category.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {category.name}
                      {!category.active && (
                        <span className="text-text-muted ml-2 text-xs">ausgeblendet</span>
                      )}
                    </p>
                    <p className="text-text-muted text-sm">
                      {category.documentCount === 1
                        ? '1 Dokument'
                        : `${category.documentCount} Dokumente`}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <RenameCategoryForm category={{ id: category.id, name: category.name }} />
                    <form action={toggleCategoryAction}>
                      <input type="hidden" name="categoryId" value={category.id} />
                      <input type="hidden" name="activate" value={category.active ? '0' : '1'} />
                      <Button type="submit" variant="ghost">
                        {category.active ? 'Ausblenden' : 'Einblenden'}
                      </Button>
                    </form>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <NewCategoryForm />
        </div>
      </PageBody>
    </>
  );
}
