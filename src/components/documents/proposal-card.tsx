import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { WarningIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import type { PaymentView } from '@/server/services/payments';
import type { TaskView } from '@/server/services/tasks';
import {
  confirmPaymentAction,
  confirmTaskAction,
  paymentStatusAction,
  postponeTaskAction,
  taskStatusAction,
} from '@/app/(app)/aufgaben/actions';

/**
 * Eine Aufgabe oder Zahlung als Karte.
 *
 * Der wichtigste Unterschied in der Darstellung ist der zwischen Vorschlag
 * und bestaetigter Aufgabe. Ein Vorschlag zeigt seine Fundstelle und fragt;
 * eine bestaetigte Aufgabe zeigt nur noch, was zu tun ist. Wer den
 * Unterschied nicht sieht, kann sich auf die Liste nicht verlassen.
 */

export function TaskCard({ task, showDocument = true }: { task: TaskView; showDocument?: boolean }) {
  const proposed = task.status === 'PROPOSED';

  return (
    <li className={cn('border-border bg-surface rounded-2xl border p-4', proposed && 'border-dashed')}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{task.title}</p>
            {task.description && (
              <p className="text-text-muted mt-0.5 text-sm">{task.description}</p>
            )}
            <DueLine
              dueDate={task.dueDate}
              uncertain={task.dueUncertain}
              rule={task.dueRule}
              status={task.status}
            />
          </div>

          {proposed && <span className="text-text-muted shrink-0 text-[11px]">Vorschlag</span>}
        </div>

        <Evidence
          page={task.page}
          quote={task.quote}
          documentId={task.documentId}
          documentTitle={showDocument ? task.documentTitle : null}
          personName={task.personName}
        />

        <div className="flex flex-wrap gap-2">
          {proposed ? (
            <>
              <form action={confirmTaskAction}>
                <Hidden name="taskId" value={task.id} />
                <Hidden name="documentId" value={task.documentId} />
                <Button type="submit">Übernehmen</Button>
              </form>

              <form action={taskStatusAction}>
                <Hidden name="taskId" value={task.id} />
                <Hidden name="documentId" value={task.documentId} />
                <input type="hidden" name="status" value="IGNORED" />
                <Button type="submit" variant="ghost">
                  Verwerfen
                </Button>
              </form>
            </>
          ) : (
            <>
              <form action={taskStatusAction}>
                <Hidden name="taskId" value={task.id} />
                <Hidden name="documentId" value={task.documentId} />
                <input type="hidden" name="status" value="DONE" />
                <Button type="submit">Erledigt</Button>
              </form>

              <form action={postponeTaskAction}>
                <Hidden name="taskId" value={task.id} />
                <Hidden name="documentId" value={task.documentId} />
                <input type="hidden" name="days" value="7" />
                <Button type="submit" variant="secondary">
                  Eine Woche später
                </Button>
              </form>

              <form action={taskStatusAction}>
                <Hidden name="taskId" value={task.id} />
                <Hidden name="documentId" value={task.documentId} />
                <input type="hidden" name="status" value="IGNORED" />
                <Button type="submit" variant="ghost">
                  Ignorieren
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

export function PaymentCard({
  payment,
  showDocument = true,
}: {
  payment: PaymentView;
  showDocument?: boolean;
}) {
  const proposed = payment.status === 'PROPOSED';

  return (
    <li className={cn('border-border bg-surface rounded-2xl border p-4', proposed && 'border-dashed')}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="tabular font-medium">
              {formatAmount(payment.amountCents, payment.currency)}
              <span className="text-text-muted ml-2 text-sm font-normal">
                {payment.direction === 'OUTGOING' ? 'zu zahlen' : 'Erstattung'}
              </span>
            </p>
            {payment.purpose && <p className="text-text-muted mt-0.5 text-sm">{payment.purpose}</p>}
            <DueLine
              dueDate={payment.dueDate}
              uncertain={payment.dueUncertain}
              rule={payment.dueRule}
              status={payment.status}
            />
            {payment.iban && (
              <p className="text-text-muted tabular mt-0.5 text-xs">{payment.iban}</p>
            )}
          </div>

          {proposed && <span className="text-text-muted shrink-0 text-[11px]">Vorschlag</span>}
        </div>

        <Evidence
          page={payment.page}
          quote={payment.quote}
          documentId={payment.documentId}
          documentTitle={showDocument ? payment.documentTitle : null}
          personName={payment.personName}
        />

        <div className="flex flex-wrap gap-2">
          {proposed ? (
            <>
              <form action={confirmPaymentAction}>
                <Hidden name="paymentId" value={payment.id} />
                <Hidden name="documentId" value={payment.documentId} />
                <Button type="submit">Übernehmen</Button>
              </form>

              <form action={paymentStatusAction}>
                <Hidden name="paymentId" value={payment.id} />
                <Hidden name="documentId" value={payment.documentId} />
                <input type="hidden" name="status" value="IGNORED" />
                <Button type="submit" variant="ghost">
                  Verwerfen
                </Button>
              </form>
            </>
          ) : (
            <form action={paymentStatusAction}>
              <Hidden name="paymentId" value={payment.id} />
              <Hidden name="documentId" value={payment.documentId} />
              <input type="hidden" name="status" value="PAID" />
              <Button type="submit">Bezahlt</Button>
            </form>
          )}
        </div>
      </div>
    </li>
  );
}

function Hidden({ name, value }: { name: string; value: string | null }) {
  return <input type="hidden" name={name} value={value ?? ''} />;
}

function DueLine({
  dueDate,
  uncertain,
  rule,
  status,
}: {
  dueDate: Date | null;
  uncertain: boolean;
  rule: string | null;
  status: string;
}) {
  if (!dueDate) {
    return <p className="text-text-muted mt-1 text-sm">Ohne Frist</p>;
  }

  const days = daysUntil(dueDate);
  const overdue = days < 0;
  const soon = days >= 0 && days <= 3;

  return (
    <p
      className={cn(
        'mt-1 flex items-center gap-1.5 text-sm',
        overdue ? 'text-negative' : soon ? 'text-warning' : 'text-text-muted',
      )}
    >
      {(overdue || soon) && status !== 'PROPOSED' && <WarningIcon className="h-4 w-4 shrink-0" />}
      <span className="tabular">
        {overdue ? 'Fällig war' : 'Fällig'} {formatDate(dueDate)}
        {overdue && ` (${Math.abs(days)} Tage her)`}
        {!overdue && days === 0 && ' — heute'}
      </span>
      {uncertain && (
        // Eine berechnete Frist ist eine Annahme. Das muss dranstehen.
        <span
          className="text-text-muted text-xs"
          title={rule ?? 'Aus einer relativen Angabe berechnet'}
        >
          (berechnet)
        </span>
      )}
    </p>
  );
}

/**
 * Die Fundstelle.
 *
 * Sie steht bei jedem Vorschlag - ohne sie waere die Angabe eine Behauptung.
 * Der Verweis fuehrt zur Seite im Dokument, auf der sie steht.
 */
function Evidence({
  page,
  quote,
  documentId,
  documentTitle,
  personName,
}: {
  page: number | null;
  quote: string | null;
  documentId: string | null;
  documentTitle: string | null;
  personName: string | null;
}) {
  if (!quote && !documentTitle) return null;

  return (
    <div className="bg-surface-muted flex flex-col gap-1 rounded-xl px-3 py-2">
      {quote && <p className="text-text-muted text-xs italic">&bdquo;{quote}&ldquo;</p>}

      <p className="text-text-muted text-xs">
        {/*
          "Selbst eingetragen" darf nur dastehen, wenn es wirklich kein
          Dokument gibt. In der Dokumentansicht ist der Titel nur
          ausgeblendet, weil er ueber der Seite steht - dort waere der
          Hinweis schlicht falsch.
        */}
        {documentId ? (
          documentTitle ? (
            <Link
              href={page !== null ? `/dokumente/${documentId}?seite=${page}` : `/dokumente/${documentId}`}
              className="text-accent font-medium"
            >
              {documentTitle}
            </Link>
          ) : null
        ) : (
          <span>Selbst eingetragen</span>
        )}
        {page !== null && `${documentId && documentTitle ? ' · ' : ''}Seite ${page}`}
        {personName && ` · ${personName}`}
      </p>
    </div>
  );
}

function daysUntil(date: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(date);
}

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(cents / 100);
}
