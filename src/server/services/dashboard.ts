import type { SessionUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { listPayments, openPaymentTotals, type PaymentView } from './payments';
import { dueReminders, ensureReminders, type ReminderView } from './reminders';
import { listTasks, type TaskView } from './tasks';

/**
 * Der Startbildschirm.
 *
 * Die Reihenfolge folgt der Frage, mit der jemand die App oeffnet: Was muss
 * ich tun? Deshalb steht der Handlungsbedarf oben, nicht die Statistik.
 *
 * Alles wird in einem Durchgang geholt. Sechs einzelne Abfragen von der
 * Seite aus waeren auf dem Telefon spuerbar langsamer.
 */

export interface DashboardData {
  greeting: string;
  reminders: ReminderView[];
  /** Ueberfaellig oder in den naechsten sieben Tagen faellig. */
  urgentTasks: TaskView[];
  urgentPayments: PaymentView[];
  openTaskCount: number;
  proposalCount: number;
  payments: { outgoingCents: number; incomingCents: number; count: number };
  recentDocuments: Array<{
    id: string;
    title: string | null;
    sender: string | null;
    createdAt: Date;
    documentDate: Date | null;
    processingStatus: string;
    reviewState: string;
    thumbPageId: string | null;
  }>;
  reviewCount: number;
  persons: Array<{ id: string; name: string; documentCount: number }>;
  categories: Array<{ id: string; name: string; documentCount: number }>;
  documentCount: number;
}

export async function getDashboard(actor: SessionUser): Promise<DashboardData> {
  // Erst die Erinnerungen nachziehen, dann lesen - sonst faehlte die
  // Erinnerung, die genau heute faellig geworden ist.
  await ensureReminders(actor).catch(() => 0);

  const horizon = new Date();
  horizon.setUTCHours(23, 59, 59, 999);
  horizon.setUTCDate(horizon.getUTCDate() + 7);

  const [
    reminders,
    urgentTasks,
    urgentPayments,
    openTasks,
    proposedTasks,
    proposedPayments,
    payments,
    recentDocuments,
    reviewCount,
    persons,
    categories,
    documentCount,
  ] = await Promise.all([
    dueReminders(actor),
    listTasks(actor, { dueBefore: horizon }),
    listPayments(actor, { dueBefore: horizon }),
    db.task.count({ where: { userId: actor.id, status: { in: ['OPEN', 'POSTPONED'] } } }),
    db.task.count({ where: { userId: actor.id, status: 'PROPOSED' } }),
    db.payment.count({ where: { userId: actor.id, status: 'PROPOSED' } }),
    openPaymentTotals(actor),
    db.document.findMany({
      where: { userId: actor.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        title: true,
        sender: true,
        createdAt: true,
        documentDate: true,
        processingStatus: true,
        reviewState: true,
        pages: {
          where: { thumbKey: { not: null } },
          orderBy: { pageNumber: 'asc' },
          take: 1,
          select: { id: true },
        },
      },
    }),
    db.document.count({ where: { userId: actor.id, deletedAt: null, reviewState: 'NEEDED' } }),
    db.person.findMany({
      where: { userId: actor.id, active: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        _count: { select: { documents: { where: { deletedAt: null } } } },
      },
    }),
    db.category.findMany({
      where: { userId: actor.id, active: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        _count: { select: { documents: { where: { deletedAt: null } } } },
      },
    }),
    db.document.count({ where: { userId: actor.id, deletedAt: null } }),
  ]);

  return {
    greeting: greetingFor(new Date()),
    reminders,
    urgentTasks,
    urgentPayments,
    openTaskCount: openTasks,
    proposalCount: proposedTasks + proposedPayments,
    payments,
    recentDocuments: recentDocuments.map((document) => ({
      id: document.id,
      title: document.title,
      sender: document.sender,
      createdAt: document.createdAt,
      documentDate: document.documentDate,
      processingStatus: document.processingStatus,
      reviewState: document.reviewState,
      thumbPageId: document.pages[0]?.id ?? null,
    })),
    reviewCount,
    // Kategorien ohne Dokumente wuerden die Uebersicht nur fuellen.
    persons: persons.map(({ _count, ...person }) => ({
      ...person,
      documentCount: _count.documents,
    })),
    categories: categories
      .map(({ _count, ...category }) => ({ ...category, documentCount: _count.documents }))
      .filter((category) => category.documentCount > 0),
    documentCount,
  };
}

function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour < 11) return 'Guten Morgen';
  if (hour < 18) return 'Guten Tag';
  return 'Guten Abend';
}
