import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { readFieldMeta } from '@/lib/validation/document';
import { requireUser } from '@/server/auth/context';
import { listCategories } from '@/server/services/categories';
import { getDocument } from '@/server/services/documents';
import { listPersons } from '@/server/services/persons';
import { DocumentTabs, PageViewer, ProcessingBanner } from './document-view';
import { MetaForm } from './meta-form';
import { deleteDocumentAction, reprocessAction, setLifecycleAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  const { id } = await params;

  const document = await getDocument(actor, id);
  if (!document) notFound();

  const [persons, categories] = await Promise.all([listPersons(actor), listCategories(actor)]);
  const meta = readFieldMeta(document.fieldMeta);

  const title = document.title ?? document.sender ?? 'Ohne Titel';
  const subtitle = [
    document.person?.name,
    document.category?.name,
    document.documentDate ? formatDate(document.documentDate) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle || 'Noch keine Angaben'}
        action={<Link href="/dokumente">Zurück</Link>}
      />

      <PageBody>
        <div className="flex flex-col gap-5">
          <ProcessingBanner
            documentId={document.id}
            initial={{
              processingStatus: document.processingStatus,
              processingStep: document.processingStep,
              progressDone: document.progressDone,
              progressTotal: document.progressTotal,
              reviewState: document.reviewState,
              pageCount: document.pageCount,
              lastError: document.lastError,
            }}
          />

          {document.summary && (
            <section className="border-border bg-surface flex flex-col gap-2 rounded-2xl border p-4">
              <h2 className="text-text-muted text-xs font-semibold tracking-wider uppercase">
                Zusammenfassung der KI
              </h2>
              <p className="text-sm leading-relaxed">{document.summary}</p>
            </section>
          )}

          <DocumentTabs
            pages={
              <div className="flex flex-col gap-4">
                <PageViewer
                  documentId={document.id}
                  pages={document.pages.map((page) => ({
                    id: page.id,
                    pageNumber: page.pageNumber,
                  }))}
                />

                {document.files.length > 0 && (
                  <section className="flex flex-col gap-2">
                    <h2 className="text-text-muted text-xs font-semibold tracking-wider uppercase">
                      Originaldateien
                    </h2>
                    <ul className="border-border bg-surface divide-border divide-y overflow-hidden rounded-2xl border">
                      {document.files.map((file) => (
                        <li
                          key={file.id}
                          className="flex items-center justify-between gap-3 px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{file.originalName}</p>
                            <p className="text-text-muted tabular text-xs">
                              {formatSize(file.sizeBytes)}
                            </p>
                          </div>
                          <a
                            href={`/api/dokumente/${document.id}/datei/${file.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent inline-flex min-h-11 shrink-0 items-center text-sm font-medium"
                          >
                            Original öffnen
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            }
            meta={
              <MetaForm
                values={{
                  documentId: document.id,
                  title: document.title ?? '',
                  documentType: document.documentType ?? '',
                  sender: document.sender ?? '',
                  recipient: document.recipient ?? '',
                  subject: document.subject ?? '',
                  documentDate: asDay(document.documentDate),
                  receivedDate: asDay(document.receivedDate),
                  personId: document.personId ?? '',
                  categoryId: document.categoryId ?? '',
                }}
                meta={meta}
                personUncertain={document.personUncertain}
                persons={persons
                  .filter((person) => person.active || person.id === document.personId)
                  .map(({ id: personId, name }) => ({ id: personId, name }))}
                categories={categories
                  .filter((category) => category.active || category.id === document.categoryId)
                  .map(({ id: categoryId, name }) => ({ id: categoryId, name }))}
              />
            }
            text={
              <div className="flex flex-col gap-4">
                {document.pages.every((page) => !page.text) ? (
                  <p className="text-text-muted text-sm">
                    Für dieses Dokument liegt noch kein erkannter Text vor.
                  </p>
                ) : (
                  document.pages.map((page) => (
                    <section key={page.id} className="flex flex-col gap-1.5">
                      <h3 className="text-text-muted flex items-center gap-2 text-xs font-semibold tracking-wider uppercase">
                        Seite {page.pageNumber}
                        {page.ocrConfidence !== null && (
                          <span className="normal-case">
                            (Erkennung {page.ocrConfidence}%)
                          </span>
                        )}
                        {page.textSource === 'PDF_TEXT' && (
                          <span className="normal-case">(Text aus dem PDF)</span>
                        )}
                      </h3>
                      <pre className="border-border bg-surface overflow-x-auto rounded-xl border p-3 text-xs leading-relaxed whitespace-pre-wrap">
                        {page.text ?? '— kein Text erkannt —'}
                      </pre>
                    </section>
                  ))
                )}
              </div>
            }
          />

          <section className="flex flex-col gap-2 border-t border-border pt-5">
            <h2 className="text-text-muted text-xs font-semibold tracking-wider uppercase">
              Dokument
            </h2>

            <div className="flex flex-wrap gap-2">
              <form action={setLifecycleAction}>
                <input type="hidden" name="documentId" value={document.id} />
                <input
                  type="hidden"
                  name="lifecycle"
                  value={document.lifecycle === 'DONE' ? 'ACTIVE' : 'DONE'}
                />
                <Button type="submit" variant="secondary">
                  {document.lifecycle === 'DONE' ? 'Als offen markieren' : 'Als erledigt markieren'}
                </Button>
              </form>

              <form action={setLifecycleAction}>
                <input type="hidden" name="documentId" value={document.id} />
                <input
                  type="hidden"
                  name="lifecycle"
                  value={document.lifecycle === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED'}
                />
                <Button type="submit" variant="secondary">
                  {document.lifecycle === 'ARCHIVED' ? 'Aus dem Archiv holen' : 'Archivieren'}
                </Button>
              </form>

              <form action={reprocessAction}>
                <input type="hidden" name="documentId" value={document.id} />
                <Button type="submit" variant="secondary">
                  Erneut verarbeiten
                </Button>
              </form>

              <form action={deleteDocumentAction}>
                <input type="hidden" name="documentId" value={document.id} />
                <Button type="submit" variant="ghost">
                  Ausblenden
                </Button>
              </form>
            </div>

            <p className="text-text-muted text-xs">
              Ausblenden löscht nichts: Das Dokument und seine Originaldateien bleiben erhalten.
            </p>
          </section>
        </div>
      </PageBody>
    </>
  );
}

function asDay(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : '';
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(date);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
