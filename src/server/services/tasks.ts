import type { TaskKind, TaskStatus, Verification } from '@/generated/prisma/enums';
import type { SessionUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { log } from '@/server/log';

/**
 * Aufgaben und Fristen.
 *
 * Der Unterschied zwischen `PROPOSED` und `OPEN` traegt die Glaubwuerdigkeit
 * der ganzen Anwendung: Eine von der KI erkannte Aufgabe ist ein Vorschlag.
 * Sie erscheint als solcher, zaehlt in keiner Uebersicht mit und wird erst
 * durch eine ausdrueckliche Bestaetigung zur Aufgabe.
 *
 * Der Grund ist einfach: Wer sich auf Fristen verlaesst, muss wissen,
 * welche davon er selbst geprueft hat.
 */

export interface TaskView {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  title: string;
  description: string | null;
  dueDate: Date | null;
  dueUncertain: boolean;
  dueRule: string | null;
  page: number | null;
  quote: string | null;
  verification: Verification;
  confidence: number | null;
  source: string;
  documentId: string | null;
  documentTitle: string | null;
  personName: string | null;
}

const OPEN_STATES: TaskStatus[] = ['OPEN', 'POSTPONED'];

export interface TaskFilter {
  status?: TaskStatus[];
  documentId?: string;
  personId?: string;
  /** Nur Aufgaben, die bis zu diesem Tag faellig sind. */
  dueBefore?: Date;
}

export async function listTasks(actor: SessionUser, filter: TaskFilter = {}): Promise<TaskView[]> {
  const tasks = await db.task.findMany({
    where: {
      userId: actor.id,
      status: { in: filter.status ?? OPEN_STATES },
      ...(filter.documentId ? { documentId: filter.documentId } : {}),
      ...(filter.personId ? { document: { personId: filter.personId } } : {}),
      ...(filter.dueBefore ? { dueDate: { lte: filter.dueBefore } } : {}),
      // Dokumente im Papierkorb bringen keine Aufgaben mit.
      OR: [{ documentId: null }, { document: { deletedAt: null } }],
    },
    orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    select: {
      id: true,
      kind: true,
      status: true,
      title: true,
      description: true,
      dueDate: true,
      dueUncertain: true,
      dueRule: true,
      page: true,
      quote: true,
      verification: true,
      confidence: true,
      source: true,
      documentId: true,
      document: {
        select: { title: true, sender: true, person: { select: { name: true } } },
      },
    },
  });

  return tasks.map((task) => ({
    id: task.id,
    kind: task.kind,
    status: task.status,
    title: task.title,
    description: task.description,
    dueDate: task.dueDate,
    dueUncertain: task.dueUncertain,
    dueRule: task.dueRule,
    page: task.page,
    quote: task.quote,
    verification: task.verification,
    confidence: task.confidence,
    source: task.source,
    documentId: task.documentId,
    documentTitle: task.document?.title ?? task.document?.sender ?? null,
    personName: task.document?.person?.name ?? null,
  }));
}

export type TaskResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Bestaetigt einen Vorschlag.
 *
 * Erst hier wird aus einer Vermutung der KI eine Aufgabe, auf die sich der
 * Benutzer verlassen kann. Der Beleg bleibt erhalten, aber die Herkunft
 * wechselt: Ab jetzt steht der Mensch dahinter.
 */
export async function confirmTask(actor: SessionUser, taskId: string): Promise<TaskResult> {
  const updated = await db.task.updateMany({
    where: { id: taskId, userId: actor.id, status: 'PROPOSED' },
    data: { status: 'OPEN', verification: 'USER' },
  });

  if (updated.count === 0) return { ok: false, error: 'Vorschlag nicht gefunden.' };

  await maybeClearReview(actor, taskId);
  log.info('task.confirmed', { taskId });
  return { ok: true, id: taskId };
}

export async function setTaskStatus(
  actor: SessionUser,
  taskId: string,
  status: TaskStatus,
): Promise<TaskResult> {
  const updated = await db.task.updateMany({
    where: { id: taskId, userId: actor.id },
    data: {
      status,
      completedAt: status === 'DONE' ? new Date() : null,
      ...(status === 'OPEN' ? { postponedTo: null } : {}),
    },
  });

  if (updated.count === 0) return { ok: false, error: 'Aufgabe nicht gefunden.' };

  await maybeClearReview(actor, taskId);
  return { ok: true, id: taskId };
}

/** Verschiebt eine Aufgabe auf ein spaeteres Datum. */
export async function postponeTask(
  actor: SessionUser,
  taskId: string,
  until: Date,
): Promise<TaskResult> {
  const updated = await db.task.updateMany({
    where: { id: taskId, userId: actor.id },
    data: { status: 'POSTPONED', postponedTo: until, dueDate: until, dueUncertain: false },
  });

  if (updated.count === 0) return { ok: false, error: 'Aufgabe nicht gefunden.' };
  return { ok: true, id: taskId };
}

export interface ManualTaskInput {
  title: string;
  description?: string | null;
  dueDate?: Date | null;
  documentId?: string | null;
  kind?: TaskKind;
}

/** Eine selbst angelegte Aufgabe - ohne Beleg, aber mit klarer Herkunft. */
export async function createTask(
  actor: SessionUser,
  input: ManualTaskInput,
): Promise<TaskResult> {
  const documentId = input.documentId
    ? ((
        await db.document.findFirst({
          where: { id: input.documentId, userId: actor.id, deletedAt: null },
          select: { id: true },
        })
      )?.id ?? null)
    : null;

  const task = await db.task.create({
    data: {
      userId: actor.id,
      documentId,
      kind: input.kind ?? 'TASK',
      status: 'OPEN',
      title: input.title,
      description: input.description ?? null,
      dueDate: input.dueDate ?? null,
      verification: 'USER',
      confidence: 100,
      source: 'USER',
    },
    select: { id: true },
  });

  return { ok: true, id: task.id };
}

/**
 * Nimmt die Pruefmarkierung vom Dokument, sobald kein Vorschlag mehr offen
 * ist.
 *
 * Sonst bliebe „Prüfung nötig" stehen, obwohl der Benutzer alles
 * durchgesehen hat - und der Hinweis verlöre seine Bedeutung.
 */
async function maybeClearReview(actor: SessionUser, taskId: string): Promise<void> {
  const task = await db.task.findFirst({
    where: { id: taskId, userId: actor.id },
    select: { documentId: true },
  });
  if (!task?.documentId) return;

  const [openTasks, openPayments] = await Promise.all([
    db.task.count({ where: { documentId: task.documentId, status: 'PROPOSED' } }),
    db.payment.count({ where: { documentId: task.documentId, status: 'PROPOSED' } }),
  ]);

  if (openTasks === 0 && openPayments === 0) {
    await db.document.updateMany({
      where: { id: task.documentId, userId: actor.id, reviewState: 'NEEDED' },
      data: { reviewState: 'REVIEWED' },
    });
  }
}
