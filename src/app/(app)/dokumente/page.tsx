import Link from 'next/link';
import { PageBody, PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/documents/status-badge';
import { DocumentIcon } from '@/components/ui/icons';
import { requireUser } from '@/server/auth/context';
import { listCategories } from '@/server/services/categories';
import { listDocuments } from '@/server/services/documents';
import { listPersons } from '@/server/services/persons';
import { Filters } from './filters';

export const metadata = { title: 'Dokumente | Doc-Flow' };
export const dynamic = 'force-dynamic';

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string; kategorie?: string; zustand?: string; seite?: string }>;
}) {
  const actor = await requireUser();
  const params = await searchParams;

  const [persons, categories] = await Promise.all([listPersons(actor), listCategories(actor)]);

  const lifecycle =
    params.zustand === 'archiviert'
      ? 'ARCHIVED'
      : params.zustand === 'erledigt'
        ? 'DONE'
        : params.zustand === 'alle'
          ? null
          : 'ACTIVE';

  const result = await listDocuments(actor, {
    personId: params.person || null,
    categoryId: params.kategorie || null,
    lifecycle,
    page: Number(params.seite ?? '1') || 1,
  });

  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <>
      <PageHeader
        title="Dokumente"
        subtitle={result.total === 1 ? '1 Dokument' : `${result.total} Dokumente`}
        action={<Link href="/dokumente/neu">Hinzufügen</Link>}
      />
      <PageBody>
        <div className="flex flex-col gap-4">
          <Filters
            persons={persons.filter((p) => p.active).map(({ id, name }) => ({ id, name }))}
            categories={categories.filter((c) => c.active).map(({ id, name }) => ({ id, name }))}
            selected={{
              person: params.person ?? '',
              kategorie: params.kategorie ?? '',
              zustand: params.zustand ?? 'aktiv',
            }}
          />

          {result.items.length === 0 ? (
            <div className="border-border flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
              <DocumentIcon className="text-text-muted h-8 w-8" />
              <p className="text-text-muted text-sm">
                Keine Dokumente gefunden. Über „Dokument hinzufügen“ geht es los.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {result.items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/dokumente/${item.id}`}
                    className="border-border bg-surface active:bg-surface-muted flex gap-3 rounded-2xl border p-3"
                  >
                    <div className="bg-surface-muted h-16 w-12 shrink-0 overflow-hidden rounded-lg">
                      {item.thumbPageId && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/dokumente/${item.id}/seite/${item.thumbPageId}?vorschau=1`}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      )}
                    </div>

                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate font-medium">
                          {item.title ?? item.sender ?? 'Ohne Titel'}
                        </p>
                        <StatusBadge
                          status={item.processingStatus}
                          reviewState={item.reviewState}
                          step={item.processingStep}
                          done={item.progressDone}
                          total={item.progressTotal}
                        />
                      </div>

                      <p className="text-text-muted truncate text-sm">
                        {[
                          item.sender && item.title ? item.sender : null,
                          item.personName,
                          item.categoryName,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'Noch keine Angaben'}
                      </p>

                      <p className="text-text-muted tabular text-xs">
                        {formatDate(item.documentDate ?? item.createdAt)}
                        {item.pageCount > 0 &&
                          ` · ${item.pageCount} ${item.pageCount === 1 ? 'Seite' : 'Seiten'}`}
                        {item.lifecycle === 'ARCHIVED' && ' · archiviert'}
                        {item.lifecycle === 'DONE' && ' · erledigt'}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {pageCount > 1 && (
            <nav className="flex items-center justify-between gap-3" aria-label="Seiten">
              <PageLink
                params={params}
                target={result.page - 1}
                disabled={result.page <= 1}
                label="Zurück"
              />
              <span className="text-text-muted text-sm">
                Seite {result.page} von {pageCount}
              </span>
              <PageLink
                params={params}
                target={result.page + 1}
                disabled={result.page >= pageCount}
                label="Weiter"
              />
            </nav>
          )}
        </div>
      </PageBody>
    </>
  );
}

function PageLink({
  params,
  target,
  disabled,
  label,
}: {
  params: Record<string, string | undefined>;
  target: number;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return <span className="text-text-muted inline-flex min-h-11 items-center text-sm">{label}</span>;
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== 'seite') query.set(key, value);
  }
  query.set('seite', String(target));

  return (
    <Link
      href={`/dokumente?${query.toString()}`}
      className="text-accent inline-flex min-h-11 items-center text-sm font-medium"
    >
      {label}
    </Link>
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(date);
}
