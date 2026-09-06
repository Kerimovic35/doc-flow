import type { SessionUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { parseReminderDays } from './settings';

/**
 * Erinnerungen an Fristen.
 *
 * Bewusst kein Zeitgeber, der jede Nacht Zeilen anlegt: Die Erinnerungen
 * werden beim Lesen des Dashboards nachgezogen. Bei einem Benutzer ist das
 * einfacher, genauso zuverlaessig und hat einen Vorteil - eine Aenderung an
 * den Vorlauftagen wirkt sofort und nicht erst am naechsten Morgen.
 *
 * Die Eindeutigkeit ueber (Aufgabe, Vorlauftage) macht den Aufruf
 * wiederholbar: Zweimal aufgerufen entsteht nichts doppelt.
 */

export interface ReminderView {
  id: string;
  daysBefore: number;
  remindAt: Date;
  seenAt: Date | null;
  taskId: string | null;
  paymentId: string | null;
  title: string;
  dueDate: Date;
  documentId: string | null;
  kind: 'TASK' | 'PAYMENT';
}

/**
 * Legt fehlende Erinnerungen an.
 *
 * Nur fuer bestaetigte Aufgaben und Zahlungen - ein Vorschlag, den niemand
 * geprueft hat, soll nicht an eine Frist erinnern, die es vielleicht gar
 * nicht gibt.
 */
export async function ensureReminders(actor: SessionUser): Promise<number> {
  const settings = await db.userSettings.findUnique({
    where: { userId: actor.id },
    select: { reminderDays: true },
  });

  const days = parseReminderDays(settings?.reminderDays);
  if (days.length === 0) return 0;

  const horizon = new Date();
  horizon.setUTCHours(0, 0, 0, 0);
  horizon.setUTCDate(horizon.getUTCDate() + Math.max(...days));

  const [tasks, payments] = await Promise.all([
    db.task.findMany({
      where: {
        userId: actor.id,
        status: { in: ['OPEN', 'POSTPONED'] },
        dueDate: { not: null, lte: horizon },
      },
      select: { id: true, dueDate: true, reminders: { select: { daysBefore: true } } },
    }),
    db.payment.findMany({
      where: {
        userId: actor.id,
        status: 'OPEN',
        dueDate: { not: null, lte: horizon },
      },
      select: { id: true, dueDate: true, reminders: { select: { daysBefore: true } } },
    }),
  ]);

  let created = 0;

  for (const task of tasks) {
    const existing = new Set(task.reminders.map((reminder) => reminder.daysBefore));

    for (const daysBefore of days) {
      if (existing.has(daysBefore)) continue;

      await db.reminder.create({
        data: {
          userId: actor.id,
          taskId: task.id,
          daysBefore,
          remindAt: minusDays(task.dueDate!, daysBefore),
        },
      });
      created += 1;
    }
  }

  for (const payment of payments) {
    const existing = new Set(payment.reminders.map((reminder) => reminder.daysBefore));

    for (const daysBefore of days) {
      if (existing.has(daysBefore)) continue;

      await db.reminder.create({
        data: {
          userId: actor.id,
          paymentId: payment.id,
          daysBefore,
          remindAt: minusDays(payment.dueDate!, daysBefore),
        },
      });
      created += 1;
    }
  }

  return created;
}

/**
 * Die faelligen, noch nicht gesehenen Erinnerungen.
 *
 * Je Aufgabe und Zahlung hoechstens eine: Bei vier Vorlaufzeiten waeren
 * sonst vier Zeilen fuer dieselbe Frist zu sehen, und die Liste sagte weniger
 * statt mehr. Gezeigt wird die zuletzt faellig gewordene - also die mit dem
 * kleinsten Vorlauf.
 */
export async function dueReminders(actor: SessionUser): Promise<ReminderView[]> {
  const now = new Date();

  const reminders = await db.reminder.findMany({
    where: {
      userId: actor.id,
      seenAt: null,
      remindAt: { lte: now },
      // Erledigte Aufgaben erinnern an nichts mehr.
      OR: [
        { task: { status: { in: ['OPEN', 'POSTPONED'] } } },
        { payment: { status: 'OPEN' } },
      ],
    },
    orderBy: { remindAt: 'asc' },
    select: {
      id: true,
      daysBefore: true,
      remindAt: true,
      seenAt: true,
      taskId: true,
      paymentId: true,
      task: { select: { title: true, dueDate: true, documentId: true } },
      payment: {
        select: { amount: true, currency: true, dueDate: true, documentId: true, purpose: true },
      },
    },
  });

  const views: ReminderView[] = [];

  for (const reminder of reminders) {
    if (reminder.task?.dueDate) {
      views.push({
        id: reminder.id,
        daysBefore: reminder.daysBefore,
        remindAt: reminder.remindAt,
        seenAt: reminder.seenAt,
        taskId: reminder.taskId,
        paymentId: null,
        title: reminder.task.title,
        dueDate: reminder.task.dueDate,
        documentId: reminder.task.documentId,
        kind: 'TASK',
      });
      continue;
    }

    if (reminder.payment?.dueDate) {
      const amount = new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: reminder.payment.currency,
      }).format(Number(reminder.payment.amount.toString()));

      views.push({
        id: reminder.id,
        daysBefore: reminder.daysBefore,
        remindAt: reminder.remindAt,
        seenAt: reminder.seenAt,
        taskId: null,
        paymentId: reminder.paymentId,
        title: reminder.payment.purpose ? `${amount} — ${reminder.payment.purpose}` : amount,
        dueDate: reminder.payment.dueDate,
        documentId: reminder.payment.documentId,
        kind: 'PAYMENT',
      });
    }
  }

  return collapse(views);
}

/**
 * Behaelt je Posten die dringendste Erinnerung.
 *
 * Die uebrigen bleiben in der Datenbank - sie werden nur nicht angezeigt.
 * Beim Wegklicken werden trotzdem alle als gesehen vermerkt (siehe
 * dismissRemindersAction), sonst taeuchte die naechste sofort wieder auf.
 */
function collapse(views: ReminderView[]): ReminderView[] {
  const best = new Map<string, ReminderView>();

  for (const view of views) {
    const key = view.taskId ?? view.paymentId ?? view.id;
    const current = best.get(key);
    if (!current || view.daysBefore < current.daysBefore) best.set(key, view);
  }

  return [...best.values()].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

/** Alle Erinnerungs-IDs zu denselben Posten - fuers Wegklicken. */
export async function relatedReminderIds(
  actor: SessionUser,
  reminderIds: string[],
): Promise<string[]> {
  if (reminderIds.length === 0) return [];

  const shown = await db.reminder.findMany({
    where: { id: { in: reminderIds }, userId: actor.id },
    select: { taskId: true, paymentId: true },
  });

  const taskIds = shown.map((entry) => entry.taskId).filter((id): id is string => Boolean(id));
  const paymentIds = shown
    .map((entry) => entry.paymentId)
    .filter((id): id is string => Boolean(id));

  const all = await db.reminder.findMany({
    where: {
      userId: actor.id,
      seenAt: null,
      OR: [
        { id: { in: reminderIds } },
        ...(taskIds.length > 0 ? [{ taskId: { in: taskIds } }] : []),
        ...(paymentIds.length > 0 ? [{ paymentId: { in: paymentIds } }] : []),
      ],
    },
    select: { id: true },
  });

  return all.map((entry) => entry.id);
}

/** Markiert Erinnerungen als gesehen. */
export async function markRemindersSeen(
  actor: SessionUser,
  reminderIds: string[],
): Promise<number> {
  if (reminderIds.length === 0) return 0;

  const updated = await db.reminder.updateMany({
    where: { id: { in: reminderIds }, userId: actor.id, seenAt: null },
    data: { seenAt: new Date() },
  });

  return updated.count;
}

function minusDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() - days);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}
