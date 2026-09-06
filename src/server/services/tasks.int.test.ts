import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actorFor, resetTestDb, seedBasics, testDb } from '@/test/integration-db';

vi.mock('@/server/db', async () => {
  const { testDb: client } = await import('@/test/integration-db');
  return { db: client };
});

const { listTasks, confirmTask, setTaskStatus, postponeTask, createTask } = await import('./tasks');
const { listPayments, confirmPayment, setPaymentStatus, openPaymentTotals } = await import(
  './payments'
);

let userId: string;
let documentId: string;

beforeEach(async () => {
  await resetTestDb();
  ({ userId } = await seedBasics());

  const document = await testDb.document.create({
    data: { userId, title: 'AOK Bescheid', reviewState: 'NEEDED', processingStatus: 'DONE' },
    select: { id: true },
  });
  documentId = document.id;
});

async function proposeTask(overrides: Record<string, unknown> = {}) {
  return testDb.task.create({
    data: {
      userId,
      documentId,
      kind: 'TASK',
      status: 'PROPOSED',
      title: 'Einkommensnachweise einreichen',
      dueDate: new Date('2026-09-15T00:00:00.000Z'),
      verification: 'QUOTE_ONLY',
      confidence: 91,
      source: 'AI',
      page: 2,
      quote: 'Reichen Sie die Einkommensnachweise bis zum 15.09.2026 ein.',
      ...overrides,
    },
    select: { id: true },
  });
}

async function proposePayment(overrides: Record<string, unknown> = {}) {
  return testDb.payment.create({
    data: {
      userId,
      documentId,
      status: 'PROPOSED',
      direction: 'OUTGOING',
      amount: '127.50',
      currency: 'EUR',
      dueDate: new Date('2026-09-12T00:00:00.000Z'),
      verification: 'VERIFIED',
      confidence: 94,
      source: 'AI',
      ...overrides,
    },
    select: { id: true },
  });
}

describe('Aufgaben', () => {
  it('zeigt Vorschläge nicht unter den offenen Aufgaben', async () => {
    await proposeTask();

    // Ein Vorschlag ist keine Aufgabe. Zählte er mit, stünde in der
    // Übersicht etwas, das niemand geprüft hat.
    expect(await listTasks(actorFor(userId))).toHaveLength(0);
    expect(await listTasks(actorFor(userId), { status: ['PROPOSED'] })).toHaveLength(1);
  });

  it('macht aus einem bestätigten Vorschlag eine Aufgabe', async () => {
    const task = await proposeTask();

    const result = await confirmTask(actorFor(userId), task.id);
    expect(result.ok).toBe(true);

    const open = await listTasks(actorFor(userId));
    expect(open).toHaveLength(1);
    expect(open[0]!.status).toBe('OPEN');
    // Ab jetzt steht der Mensch dahinter.
    expect(open[0]!.verification).toBe('USER');
    // Der Beleg bleibt erhalten.
    expect(open[0]!.quote).toContain('Einkommensnachweise');
  });

  it('nimmt die Prüfmarkierung vom Dokument, wenn nichts mehr offen ist', async () => {
    const task = await proposeTask();
    const payment = await proposePayment();

    await confirmTask(actorFor(userId), task.id);
    // Solange die Zahlung noch als Vorschlag dasteht, bleibt die Markierung.
    let document = await testDb.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.reviewState).toBe('NEEDED');

    await confirmPayment(actorFor(userId), payment.id);
    document = await testDb.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.reviewState).toBe('REVIEWED');
  });

  it('erledigt, verschiebt und ignoriert Aufgaben', async () => {
    const task = await proposeTask();
    await confirmTask(actorFor(userId), task.id);

    await setTaskStatus(actorFor(userId), task.id, 'DONE');
    let stored = await testDb.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(stored.status).toBe('DONE');
    expect(stored.completedAt).not.toBeNull();

    await postponeTask(actorFor(userId), task.id, new Date('2026-10-01T00:00:00.000Z'));
    stored = await testDb.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(stored.status).toBe('POSTPONED');
    expect(stored.dueDate?.toISOString().slice(0, 10)).toBe('2026-10-01');
    // Ein selbst gesetztes Datum ist nicht mehr unsicher.
    expect(stored.dueUncertain).toBe(false);

    await setTaskStatus(actorFor(userId), task.id, 'IGNORED');
    expect(await listTasks(actorFor(userId))).toHaveLength(0);
  });

  it('legt eine selbst geschriebene Aufgabe ohne Beleg an', async () => {
    const result = await createTask(actorFor(userId), {
      title: 'Bei der Behörde anrufen',
      dueDate: new Date('2026-09-20T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    const tasks = await listTasks(actorFor(userId));
    expect(tasks[0]!.source).toBe('USER');
    expect(tasks[0]!.verification).toBe('USER');
    expect(tasks[0]!.status).toBe('OPEN');
  });

  it('blendet Aufgaben ausgeblendeter Dokumente aus', async () => {
    const task = await proposeTask();
    await confirmTask(actorFor(userId), task.id);

    await testDb.document.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });

    expect(await listTasks(actorFor(userId))).toHaveLength(0);
  });

  it('rührt keine fremde Aufgabe an', async () => {
    const fremd = await seedBasics({ email: 'fremd@docflow.local', name: 'Fremd' });
    const fremdeAufgabe = await testDb.task.create({
      data: { userId: fremd.userId, title: 'Fremde Aufgabe', status: 'OPEN', source: 'USER' },
      select: { id: true },
    });

    expect(await listTasks(actorFor(userId))).toHaveLength(0);
    expect((await setTaskStatus(actorFor(userId), fremdeAufgabe.id, 'DONE')).ok).toBe(false);

    const unveraendert = await testDb.task.findUniqueOrThrow({ where: { id: fremdeAufgabe.id } });
    expect(unveraendert.status).toBe('OPEN');
  });

  it('sortiert nach Fälligkeit, Aufgaben ohne Datum zuletzt', async () => {
    await createTask(actorFor(userId), { title: 'Ohne Frist' });
    await createTask(actorFor(userId), {
      title: 'Später',
      dueDate: new Date('2026-10-01T00:00:00.000Z'),
    });
    await createTask(actorFor(userId), {
      title: 'Bald',
      dueDate: new Date('2026-09-10T00:00:00.000Z'),
    });

    const tasks = await listTasks(actorFor(userId));
    expect(tasks.map((task) => task.title)).toEqual(['Bald', 'Später', 'Ohne Frist']);
  });
});

describe('Zahlungen', () => {
  it('zeigt Vorschläge nicht unter den offenen Zahlungen', async () => {
    await proposePayment();

    expect(await listPayments(actorFor(userId))).toHaveLength(0);
    expect(await listPayments(actorFor(userId), { status: ['PROPOSED'] })).toHaveLength(1);
  });

  it('rechnet Beträge ohne Fließkomma', async () => {
    await proposePayment({ amount: '1234.56', status: 'OPEN' });
    await proposePayment({ amount: '0.10', status: 'OPEN', dedupeKey: 'zweite' });
    await proposePayment({ amount: '0.20', status: 'OPEN', dedupeKey: 'dritte' });

    const totals = await openPaymentTotals(actorFor(userId));
    // 0,10 + 0,20 wäre mit Fließkomma 0,30000000000000004.
    expect(totals.outgoingCents).toBe(123456 + 10 + 20);
    expect(totals.count).toBe(3);
  });

  it('trennt eingehende von ausgehenden Zahlungen', async () => {
    await proposePayment({ status: 'OPEN', amount: '127.50' });
    await proposePayment({
      status: 'OPEN',
      direction: 'INCOMING',
      amount: '45.00',
      dedupeKey: 'erstattung',
    });

    const totals = await openPaymentTotals(actorFor(userId));
    expect(totals.outgoingCents).toBe(12750);
    expect(totals.incomingCents).toBe(4500);
  });

  it('markiert eine Zahlung als bezahlt', async () => {
    const payment = await proposePayment();
    await confirmPayment(actorFor(userId), payment.id);

    await setPaymentStatus(actorFor(userId), payment.id, 'PAID');

    const stored = await testDb.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(stored.status).toBe('PAID');
    expect(stored.paidAt).not.toBeNull();
    expect(await listPayments(actorFor(userId))).toHaveLength(0);
  });

  it('rührt keine fremde Zahlung an', async () => {
    const fremd = await seedBasics({ email: 'fremd@docflow.local', name: 'Fremd' });
    const fremdeZahlung = await testDb.payment.create({
      data: { userId: fremd.userId, status: 'OPEN', amount: '10.00', source: 'USER' },
      select: { id: true },
    });

    expect((await setPaymentStatus(actorFor(userId), fremdeZahlung.id, 'PAID')).ok).toBe(false);
  });
});
