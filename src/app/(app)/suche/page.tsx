import Link from 'next/link';
import { PageBody, PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/documents/status-badge';
import { SearchIcon } from '@/components/ui/icons';
import { requireUser } from '@/server/auth/context';
import { listCategories } from '@/server/services/categories';
import { listPersons } from '@/server/services/persons';
import { availableYears, searchDocuments } from '@/server/services/search';
import { SearchForm } from './search-form';

export const metadata = { title: 'Suche | Doc-Flow' };
export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    person?: string;
    kategorie?: string;
    jahr?: string;
    frist?: string;
    seite?: string;
  }>;
}) {
  const actor = await requireUser();
  const params = await searchParams;
  const query = (params.q ?? '').trim();

  const [persons, categories, years] = await Promise.all([
    listPersons(actor),
    listCategories(actor),
    availableYears(actor),
  ]);

  const result = await searchDocuments(actor, query, {
    personId: params.person || null,
    categoryId: params.kategorie || null,
    year: params.jahr ? Number(params.jahr) : null,
    withDeadline: params.frist === '1',
    page: Number(params.seite ?? '1') || 1,
  });

  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <>
      <PageHeader
        title="Suche"
        subtitle={
          query
            ? `${result.total} ${result.total === 1 ? 'Treffer' : 'Treffer'}`
            : 'Volltext über alle Dokumente'
        }
      />
      <PageBody>
        <div className="flex flex-col gap-4">
          <SearchForm
            query={query}
            persons={persons.filter((p) => p.active).map(({ id, name }) => ({ id, name }))}
            categories={categories.filter((c) => c.active).map(({ id, name }) => ({ id, name }))}
            years={years}
            selected={{
              person: params.person ?? '',
              kategorie: params.kategorie ?? '',
              jahr: params.jahr ?? '',
              frist: params.frist === '1',
            }}
          />

          {result.hits.length === 0 ? (
            <div className="border-border flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
              <SearchIcon className="text-text-muted h-8 w-8" />
              <p className="text-text-muted text-sm">
                {query
                  ? 'Nichts gefunden. Gesucht wird im erkannten Text, in den Angaben und in den Nummern.'
                  : 'Suchbegriff eingeben oder filtern.'}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {result.hits.map((hit) => (
                <li key={hit.id}>
                  <Link
                    href={
                      hit.matchPage !== null
                        ? `/dokumente/${hit.id}?seite=${hit.matchPage}`
                        : `/dokumente/${hit.id}`
                    }
                    className="border-border bg-surface active:bg-surface-muted flex gap-3 rounded-2xl border p-3"
                  >
                    <div className="bg-surface-muted h-16 w-12 shrink-0 overflow-hidden rounded-lg">
                      {hit.thumbPageId && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/dokumente/${hit.id}/seite/${hit.thumbPageId}?vorschau=1`}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      )}
                    </div>

                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate font-medium">
                          {hit.title ?? hit.sender ?? 'Ohne Titel'}
                        </p>
                        <StatusBadge
                          status={hit.processingStatus}
                          reviewState={hit.reviewState}
                        />
                      </div>

                      {hit.snippet ? (
                        <p
                          className="text-text-muted line-clamp-2 text-sm [&_mark]:bg-accent/20 [&_mark]:text-text [&_mark]:rounded [&_mark]:px-0.5"
                          // Die Hervorhebung kommt aus ts_headline und
                          // enthaelt ausschliesslich <mark>-Marken um Text
                          // aus der eigenen Datenbank.
                          dangerouslySetInnerHTML={{ __html: hit.snippet }}
                        />
                      ) : (
                        <p className="text-text-muted truncate text-sm">
                          {hit.subject ?? hit.sender ?? 'Noch keine Angaben'}
                        </p>
                      )}

                      <p className="text-text-muted tabular text-xs">
                        {[
                          hit.sender,
                          hit.personName,
                          hit.categoryName,
                          formatDate(hit.documentDate ?? hit.createdAt),
                          hit.matchPage !== null ? `Seite ${hit.matchPage}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {pageCount > 1 && (
            <nav className="flex items-center justify-between gap-3" aria-label="Seiten">
              <PageLink params={params} target={result.page - 1} disabled={result.page <= 1}>
                Zurück
              </PageLink>
              <span className="text-text-muted text-sm">
                Seite {result.page} von {pageCount}
              </span>
              <PageLink
                params={params}
                target={result.page + 1}
                disabled={result.page >= pageCount}
              >
                Weiter
              </PageLink>
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
  children,
}: {
  params: Record<string, string | undefined>;
  target: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="text-text-muted inline-flex min-h-11 items-center text-sm">{children}</span>
    );
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== 'seite') query.set(key, value);
  }
  query.set('seite', String(target));

  return (
    <Link
      href={`/suche?${query.toString()}`}
      className="text-accent inline-flex min-h-11 items-center text-sm font-medium"
    >
      {children}
    </Link>
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(date);
}
