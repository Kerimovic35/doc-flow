import Link from 'next/link';
import { PageBody, PageHeader } from '@/components/ui/page-header';
import { PaymentCard, TaskCard } from '@/components/documents/proposal-card';
import { StatusBadge } from '@/components/documents/status-badge';
import {
  BellIcon,
  CameraIcon,
  CheckIcon,
  ChevronRightIcon,
  SparkIcon,
  WarningIcon,
} from '@/components/ui/icons';
import { requireUser } from '@/server/auth/context';
import { getDashboard } from '@/server/services/dashboard';
import { dismissRemindersAction } from './actions';

export const metadata = { title: 'Start | Doc-Flow' };
export const dynamic = 'force-dynamic';

/**
 * Der Startbildschirm.
 *
 * Beantwortet die Frage, mit der jemand die App oeffnet: Was muss ich tun?
 * Deshalb steht der Handlungsbedarf oben und die Statistik unten - oder gar
 * nicht.
 */
export default async function StartPage() {
  const user = await requireUser();
  const data = await getDashboard(user);

  const nothingToDo =
    data.reminders.length === 0 &&
    data.urgentTasks.length === 0 &&
    data.urgentPayments.length === 0 &&
    data.proposalCount === 0;

  return (
    <>
      <PageHeader title={data.greeting} subtitle={user.name} />
      <PageBody>
        <div className="flex flex-col gap-6">
          {data.documentCount === 0 ? (
            <Onboarding />
          ) : (
            <>
              {data.reminders.length > 0 && (
                <section className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-warning flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
                      <BellIcon className="h-4 w-4" />
                      Erinnerungen
                    </h2>
                    <form action={dismissRemindersAction}>
                      {data.reminders.map((reminder) => (
                        <input key={reminder.id} type="hidden" name="reminderId" value={reminder.id} />
                      ))}
                      <button type="submit" className="text-text-muted min-h-11 text-sm">
                        Gesehen
                      </button>
                    </form>
                  </div>

                  <ul className="border-warning/30 bg-warning/5 divide-warning/20 divide-y overflow-hidden rounded-2xl border">
                    {data.reminders.map((reminder) => (
                      <li key={reminder.id} className="px-4 py-3">
                        <p className="text-sm font-medium">{reminder.title}</p>
                        <p className="text-text-muted tabular text-xs">
                          Fällig {formatDate(reminder.dueDate)}
                          {reminder.daysBefore === 0
                            ? ' — heute'
                            : ` — in ${reminder.daysBefore} ${reminder.daysBefore === 1 ? 'Tag' : 'Tagen'}`}
                          {reminder.documentId && (
                            <>
                              {' · '}
                              <Link
                                href={`/dokumente/${reminder.documentId}`}
                                className="text-accent font-medium"
                              >
                                Dokument
                              </Link>
                            </>
                          )}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {nothingToDo && (
                <div className="border-border flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-8 text-center">
                  <CheckIcon className="text-positive h-8 w-8" />
                  <p className="text-text-muted text-sm">
                    Nichts liegt an. {data.openTaskCount > 0 && 'Alles Weitere hat noch Zeit.'}
                  </p>
                </div>
              )}

              {(data.urgentPayments.length > 0 || data.urgentTasks.length > 0) && (
                <section className="flex flex-col gap-2">
                  <h2 className="text-text-muted text-xs font-semibold tracking-wider uppercase">
                    Diese Woche
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {data.urgentPayments.map((payment) => (
                      <PaymentCard key={payment.id} payment={payment} />
                    ))}
                    {data.urgentTasks.map((task) => (
                      <TaskCard key={task.id} task={task} />
                    ))}
                  </ul>
                </section>
              )}

              {(data.proposalCount > 0 || data.reviewCount > 0) && (
                <section className="flex flex-col gap-2">
                  <h2 className="text-text-muted text-xs font-semibold tracking-wider uppercase">
                    Zu prüfen
                  </h2>
                  <ul className="border-border bg-surface divide-border divide-y overflow-hidden rounded-2xl border">
                    {data.proposalCount > 0 && (
                      <li>
                        <Link
                          href="/aufgaben?tab=vorschlaege"
                          className="active:bg-surface-muted flex min-h-14 items-center gap-3 px-4 py-3"
                        >
                          <WarningIcon className="text-warning h-5 w-5 shrink-0" />
                          <span className="flex-1 text-sm">
                            {data.proposalCount === 1
                              ? '1 Vorschlag der KI wartet auf Bestätigung'
                              : `${data.proposalCount} Vorschläge der KI warten auf Bestätigung`}
                          </span>
                          <ChevronRightIcon className="text-text-muted h-5 w-5 shrink-0" />
                        </Link>
                      </li>
                    )}
                    {data.reviewCount > 0 && (
                      <li>
                        <Link
                          href="/dokumente"
                          className="active:bg-surface-muted flex min-h-14 items-center gap-3 px-4 py-3"
                        >
                          <WarningIcon className="text-warning h-5 w-5 shrink-0" />
                          <span className="flex-1 text-sm">
                            {data.reviewCount === 1
                              ? '1 Dokument sollte geprüft werden'
                              : `${data.reviewCount} Dokumente sollten geprüft werden`}
                          </span>
                          <ChevronRightIcon className="text-text-muted h-5 w-5 shrink-0" />
                        </Link>
                      </li>
                    )}
                  </ul>
                </section>
              )}

              {data.payments.count > 0 && (
                <section className="flex flex-col gap-2">
                  <h2 className="text-text-muted text-xs font-semibold tracking-wider uppercase">
                    Offene Zahlungen
                  </h2>
                  <Link
                    href="/aufgaben?tab=zahlungen"
                    className="border-border bg-surface active:bg-surface-muted flex items-center justify-between gap-3 rounded-2xl border px-4 py-3"
                  >
                    <span>
                      <span className="tabular block text-lg font-semibold">
                        {formatAmount(data.payments.outgoingCents)}
                      </span>
                      <span className="text-text-muted block text-xs">
                        {data.payments.count === 1 ? '1 Zahlung' : `${data.payments.count} Zahlungen`}
                        {data.payments.incomingCents > 0 &&
                          ` · ${formatAmount(data.payments.incomingCents)} Erstattung`}
                      </span>
                    </span>
                    <ChevronRightIcon className="text-text-muted h-5 w-5 shrink-0" />
                  </Link>
                </section>
              )}

              {data.recentDocuments.length > 0 && (
                <section className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-text-muted text-xs font-semibold tracking-wider uppercase">
                      Zuletzt hinzugefügt
                    </h2>
                    <Link href="/dokumente" className="text-accent text-sm font-medium">
                      Alle
                    </Link>
                  </div>

                  <ul className="flex flex-col gap-2">
                    {data.recentDocuments.map((document) => (
                      <li key={document.id}>
                        <Link
                          href={`/dokumente/${document.id}`}
                          className="border-border bg-surface active:bg-surface-muted flex items-center gap-3 rounded-2xl border p-3"
                        >
                          <div className="bg-surface-muted h-12 w-9 shrink-0 overflow-hidden rounded-md">
                            {document.thumbPageId && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={`/api/dokumente/${document.id}/seite/${document.thumbPageId}?vorschau=1`}
                                alt=""
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {document.title ?? document.sender ?? 'Ohne Titel'}
                            </p>
                            <p className="text-text-muted tabular text-xs">
                              {formatDate(document.documentDate ?? document.createdAt)}
                            </p>
                          </div>

                          <StatusBadge
                            status={document.processingStatus as never}
                            reviewState={document.reviewState as never}
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {data.persons.length > 1 && (
                <section className="flex flex-col gap-2">
                  <h2 className="text-text-muted text-xs font-semibold tracking-wider uppercase">
                    Personen
                  </h2>
                  <ul className="flex flex-wrap gap-2">
                    {data.persons.map((person) => (
                      <li key={person.id}>
                        <Link
                          href={`/dokumente?person=${person.id}`}
                          className="border-border bg-surface active:bg-surface-muted inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm"
                        >
                          {person.name}
                          <span className="text-text-muted tabular text-xs">
                            {person.documentCount}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {data.categories.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h2 className="text-text-muted text-xs font-semibold tracking-wider uppercase">
                    Kategorien
                  </h2>
                  <ul className="flex flex-wrap gap-2">
                    {data.categories.map((category) => (
                      <li key={category.id}>
                        <Link
                          href={`/dokumente?kategorie=${category.id}`}
                          className="border-border bg-surface active:bg-surface-muted inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm"
                        >
                          {category.name}
                          <span className="text-text-muted tabular text-xs">
                            {category.documentCount}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          <div className="flex flex-col gap-2 md:flex-row">
            <Link
              href="/dokumente/neu"
              className="bg-accent text-accent-fg flex min-h-13 flex-1 items-center justify-center gap-2 rounded-xl px-5 font-medium active:brightness-90"
            >
              <CameraIcon className="h-5 w-5" />
              Dokument hinzufügen
            </Link>
            <Link
              href="/ki"
              className="border-border bg-surface text-text active:bg-surface-muted flex min-h-13 flex-1 items-center justify-center gap-2 rounded-xl border px-5 font-medium"
            >
              <SparkIcon className="h-5 w-5" />
              KI-Assistent
            </Link>
          </div>
        </div>
      </PageBody>
    </>
  );
}

function Onboarding() {
  return (
    <div className="border-border flex flex-col gap-3 rounded-2xl border border-dashed px-6 py-8">
      <h2 className="font-medium">Noch keine Dokumente</h2>
      <p className="text-text-muted text-sm leading-relaxed">
        Fotografiere einen Brief Seite für Seite oder lade eine PDF hoch. Die Anwendung erkennt den
        Text, liest Absender, Person, Fristen und Beträge heraus und legt daraus Aufgaben an — jede
        mit der Fundstelle im Dokument.
      </p>
    </div>
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(date);
}

function formatAmount(cents: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}
