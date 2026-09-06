import Link from 'next/link';
import { PageBody, PageHeader } from '@/components/ui/page-header';
import { PaymentCard, TaskCard } from '@/components/documents/proposal-card';
import { CheckIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { requireUser } from '@/server/auth/context';
import { listPayments } from '@/server/services/payments';
import { listTasks } from '@/server/services/tasks';

export const metadata = { title: 'Aufgaben | Doc-Flow' };
export const dynamic = 'force-dynamic';

type Tab = 'aufgaben' | 'zahlungen' | 'vorschlaege';

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const actor = await requireUser();
  const params = await searchParams;
  const tab: Tab =
    params.tab === 'zahlungen' ? 'zahlungen' : params.tab === 'vorschlaege' ? 'vorschlaege' : 'aufgaben';

  const [tasks, payments, proposedTasks, proposedPayments] = await Promise.all([
    listTasks(actor),
    listPayments(actor),
    listTasks(actor, { status: ['PROPOSED'] }),
    listPayments(actor, { status: ['PROPOSED'] }),
  ]);

  const proposals = proposedTasks.length + proposedPayments.length;

  return (
    <>
      <PageHeader title="Aufgaben" subtitle="Was noch zu erledigen ist" />
      <PageBody>
        <div className="flex flex-col gap-4">
          <nav className="bg-surface-muted flex gap-1 rounded-xl p-1" aria-label="Bereich">
            <TabLink current={tab} target="aufgaben" label="Aufgaben" count={tasks.length} />
            <TabLink current={tab} target="zahlungen" label="Zahlungen" count={payments.length} />
            <TabLink current={tab} target="vorschlaege" label="Vorschläge" count={proposals} />
          </nav>

          {tab === 'aufgaben' &&
            (tasks.length === 0 ? (
              <Empty text="Nichts zu erledigen." />
            ) : (
              <ul className="flex flex-col gap-2">
                {tasks.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </ul>
            ))}

          {tab === 'zahlungen' &&
            (payments.length === 0 ? (
              <Empty text="Keine offenen Zahlungen." />
            ) : (
              <ul className="flex flex-col gap-2">
                {payments.map((payment) => (
                  <PaymentCard key={payment.id} payment={payment} />
                ))}
              </ul>
            ))}

          {tab === 'vorschlaege' && (
            <>
              <p className="text-text-muted text-sm">
                Von der KI aus Dokumenten gelesen. Jeder Vorschlag zeigt seine Fundstelle. Erst mit
                deiner Bestätigung zählt er in den Übersichten mit.
              </p>

              {proposals === 0 ? (
                <Empty text="Keine offenen Vorschläge." />
              ) : (
                <ul className="flex flex-col gap-2">
                  {proposedPayments.map((payment) => (
                    <PaymentCard key={payment.id} payment={payment} />
                  ))}
                  {proposedTasks.map((task) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </PageBody>
    </>
  );
}

function TabLink({
  current,
  target,
  label,
  count,
}: {
  current: Tab;
  target: Tab;
  label: string;
  count: number;
}) {
  const active = current === target;

  return (
    <Link
      href={`/aufgaben?tab=${target}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-medium',
        active ? 'bg-surface text-text shadow-sm' : 'text-text-muted',
      )}
    >
      {label}
      {count > 0 && (
        <span className="bg-accent/15 text-accent tabular rounded-full px-1.5 text-[11px]">
          {count}
        </span>
      )}
    </Link>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="border-border flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
      <CheckIcon className="text-positive h-8 w-8" />
      <p className="text-text-muted text-sm">{text}</p>
    </div>
  );
}
