import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actorFor, resetTestDb, seedBasics, testDb } from '@/test/integration-db';

vi.mock('@/server/db', async () => {
  const { testDb: client } = await import('@/test/integration-db');
  return { db: client };
});

const { ensureReminders, dueReminders, markRemindersSeen, relatedReminderIds } = await import(
  './reminders'
);
const { getDashboard } = await import('./dashboard');

let userId: string;

/** Ein Datum, das eine feste Zahl von Tagen in der Zukunft liegt. */
function inDays(days: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

beforeEach(async () => {
  await resetTestDb();
  ({ userId } = await seedBasics());
});

async function openTask(dueInDays: number, title = 'Unterlagen einreichen') {
  return testDb.task.create({
    data: {
      userId,
      title,
      status: 'OPEN',
      source: 'USER',
      verification: 'USER',
      dueDate: inDays(dueInDays),
    },
    select: { id: true },
  });
}

describe('Erinnerungen', () => {
  it('legt für jeden Vorlauftag eine Erinnerung an', async () => {
    await openTask(5);

    const created = await ensureReminders(actorFor(userId));

    // Voreinstellung ist 7, 3, 1, 0 - für eine Frist in fünf Tagen liegen
    // alle vier innerhalb des Horizonts.
    expect(created).toBe(4);
    const reminders = await testDb.reminder.findMany({ where: { userId } });
    expect(reminders.map((reminder) => reminder.daysBefore).sort((a, b) => b - a)).toEqual([
      7, 3, 1, 0,
    ]);
  });

  it('erzeugt bei einem zweiten Aufruf nichts doppelt', async () => {
    await openTask(5);

    await ensureReminders(actorFor(userId));
    const zweiter = await ensureReminders(actorFor(userId));

    expect(zweiter).toBe(0);
    expect(await testDb.reminder.count({ where: { userId } })).toBe(4);
  });

  it('erinnert nicht an eine noch weit entfernte Frist', async () => {
    await openTask(60);

    await ensureReminders(actorFor(userId));
    expect(await testDb.reminder.count({ where: { userId } })).toBe(0);
  });

  it('erinnert nicht an einen unbestätigten Vorschlag', async () => {
    // Ein Vorschlag, den niemand geprüft hat, soll nicht an eine Frist
    // erinnern, die es vielleicht gar nicht gibt.
    await testDb.task.create({
      data: {
        userId,
        title: 'Vorschlag',
        status: 'PROPOSED',
        source: 'AI',
        dueDate: inDays(2),
      },
    });

    await ensureReminders(actorFor(userId));
    expect(await testDb.reminder.count({ where: { userId } })).toBe(0);
  });

  it('zeigt je Aufgabe nur die dringendste fällige Erinnerung', async () => {
    // Frist in drei Tagen: Die Erinnerungen für 7 und 3 Tage Vorlauf sind
    // fällig. Angezeigt wird nur eine - vier Zeilen zur selben Frist sagten
    // weniger statt mehr.
    await openTask(3);
    await ensureReminders(actorFor(userId));

    const due = await dueReminders(actorFor(userId));
    expect(due).toHaveLength(1);
    expect(due[0]!.daysBefore).toBe(3);
    expect(due[0]!.title).toBe('Unterlagen einreichen');
  });

  it('lässt die übrigen Erinnerungen desselben Postens nicht nachrücken', async () => {
    await openTask(3);
    await ensureReminders(actorFor(userId));

    const due = await dueReminders(actorFor(userId));
    const all = await relatedReminderIds(
      actorFor(userId),
      due.map((reminder) => reminder.id),
    );

    await markRemindersSeen(actorFor(userId), all);

    // Ohne diesen Schritt tauchte die 7-Tage-Erinnerung sofort wieder auf.
    expect(await dueReminders(actorFor(userId))).toHaveLength(0);
  });

  it('erinnert nicht mehr an eine erledigte Aufgabe', async () => {
    const task = await openTask(1);
    await ensureReminders(actorFor(userId));
    expect((await dueReminders(actorFor(userId))).length).toBeGreaterThan(0);

    await testDb.task.update({ where: { id: task.id }, data: { status: 'DONE' } });

    expect(await dueReminders(actorFor(userId))).toHaveLength(0);
  });

  it('merkt sich, was gesehen wurde', async () => {
    await openTask(2);
    await ensureReminders(actorFor(userId));

    const due = await dueReminders(actorFor(userId));
    const ids = await relatedReminderIds(
      actorFor(userId),
      due.map((reminder) => reminder.id),
    );
    const count = await markRemindersSeen(actorFor(userId), ids);

    expect(count).toBeGreaterThan(0);
    expect(await dueReminders(actorFor(userId))).toHaveLength(0);
    // Die Zeilen bleiben - so ist nachvollziehbar, dass erinnert wurde.
    expect(await testDb.reminder.count({ where: { userId } })).toBeGreaterThan(0);
  });

  it('folgt geänderten Vorlaufzeiten', async () => {
    await testDb.userSettings.update({
      where: { userId },
      data: { reminderDays: [1] },
    });

    // Bei nur einem Tag Vorlauf ist eine Frist in fünf Tagen noch kein
    // Thema - die Erinnerung entsteht erst, wenn sie naeher rueckt.
    await openTask(5, 'Noch weit weg');
    expect(await ensureReminders(actorFor(userId))).toBe(0);

    await openTask(1, 'Morgen fällig');
    expect(await ensureReminders(actorFor(userId))).toBe(1);

    const reminders = await testDb.reminder.findMany({ where: { userId } });
    expect(reminders.map((reminder) => reminder.daysBefore)).toEqual([1]);
  });

  it('erinnert auch an offene Zahlungen', async () => {
    await testDb.payment.create({
      data: {
        userId,
        status: 'OPEN',
        direction: 'OUTGOING',
        amount: '127.50',
        currency: 'EUR',
        dueDate: inDays(2),
        purpose: 'Beitrag',
        source: 'USER',
      },
    });

    await ensureReminders(actorFor(userId));
    const due = await dueReminders(actorFor(userId));

    expect(due.length).toBeGreaterThan(0);
    expect(due[0]!.kind).toBe('PAYMENT');
    expect(due[0]!.title).toContain('127,50');
  });

  it('rührt fremde Erinnerungen nicht an', async () => {
    const fremd = await seedBasics({ email: 'fremd@docflow.local', name: 'Fremd' });
    await testDb.task.create({
      data: {
        userId: fremd.userId,
        title: 'Fremde Aufgabe',
        status: 'OPEN',
        source: 'USER',
        dueDate: inDays(1),
      },
    });
    await ensureReminders(actorFor(fremd.userId));

    expect(await dueReminders(actorFor(userId))).toHaveLength(0);

    const fremdeErinnerung = await testDb.reminder.findFirstOrThrow({
      where: { userId: fremd.userId },
    });
    expect(await markRemindersSeen(actorFor(userId), [fremdeErinnerung.id])).toBe(0);
  });
});

describe('Startbildschirm', () => {
  it('zeigt Handlungsbedarf, Zahlungen und zuletzt Hinzugefügtes', async () => {
    await openTask(2, 'Diese Woche fällig');
    await openTask(40, 'Später');

    await testDb.payment.create({
      data: {
        userId,
        status: 'OPEN',
        direction: 'OUTGOING',
        amount: '127.50',
        currency: 'EUR',
        dueDate: inDays(3),
        source: 'USER',
      },
    });

    await testDb.document.create({
      data: { userId, title: 'AOK Bescheid', processingStatus: 'DONE', reviewState: 'NEEDED' },
    });

    const data = await getDashboard(actorFor(userId));

    // "Diese Woche" heißt: überfällig oder in den nächsten sieben Tagen.
    expect(data.urgentTasks.map((task) => task.title)).toEqual(['Diese Woche fällig']);
    expect(data.urgentPayments).toHaveLength(1);
    expect(data.payments.outgoingCents).toBe(12750);
    expect(data.openTaskCount).toBe(2);
    expect(data.reviewCount).toBe(1);
    expect(data.recentDocuments[0]!.title).toBe('AOK Bescheid');
    expect(data.documentCount).toBe(1);
  });

  it('zieht die Erinnerungen beim Lesen nach', async () => {
    await openTask(1);

    // Ohne eigenen Aufruf von ensureReminders.
    const data = await getDashboard(actorFor(userId));

    expect(data.reminders.length).toBeGreaterThan(0);
  });

  it('zählt Vorschläge getrennt von bestätigten Aufgaben', async () => {
    await testDb.task.create({
      data: { userId, title: 'Vorschlag', status: 'PROPOSED', source: 'AI' },
    });
    await openTask(3);

    const data = await getDashboard(actorFor(userId));

    expect(data.proposalCount).toBe(1);
    expect(data.openTaskCount).toBe(1);
    // Der Vorschlag steht nicht unter "Diese Woche".
    expect(data.urgentTasks.every((task) => task.status !== 'PROPOSED')).toBe(true);
  });

  it('zeigt nichts aus einem fremden Konto', async () => {
    const fremd = await seedBasics({ email: 'fremd@docflow.local', name: 'Fremd' });
    await testDb.document.create({
      data: { userId: fremd.userId, title: 'Fremdes Dokument', processingStatus: 'DONE' },
    });

    const data = await getDashboard(actorFor(userId));
    expect(data.recentDocuments).toHaveLength(0);
    expect(data.documentCount).toBe(0);
  });
});
