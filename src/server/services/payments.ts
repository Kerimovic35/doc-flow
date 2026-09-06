import type { PaymentDirection, PaymentStatus, Verification } from '@/generated/prisma/enums';
import type { SessionUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { log } from '@/server/log';

/**
 * Zahlungen aus Dokumenten.
 *
 * Wie bei Aufgaben gilt: Was die KI erkannt hat, ist ein Vorschlag. Eine
 * Zahlungsuebersicht, in der ein erfundener Betrag steht, waere schlimmer
 * als gar keine - man wuerde ihr nicht mehr trauen und muesste doch wieder
 * jeden Brief selbst durchsehen.
 *
 * Die Anwendung fuehrt kein Konto. Sie zeigt, was in den Dokumenten steht,
 * und merkt sich, was der Benutzer als erledigt markiert hat.
 */

export interface PaymentView {
  id: string;
  status: PaymentStatus;
  direction: PaymentDirection;
  /** Betrag in Cent - Rechnen mit Fliesskomma waere hier fahrlaessig. */
  amountCents: number;
  currency: string;
  dueDate: Date | null;
  dueUncertain: boolean;
  dueRule: string | null;
  purpose: string | null;
  iban: string | null;
  recipient: string | null;
  page: number | null;
  quote: string | null;
  verification: Verification;
  confidence: number | null;
  source: string;
  paidAt: Date | null;
  documentId: string | null;
  documentTitle: string | null;
  personName: string | null;
}

export interface PaymentFilter {
  status?: PaymentStatus[];
  documentId?: string;
  dueBefore?: Date;
}

export async function listPayments(
  actor: SessionUser,
  filter: PaymentFilter = {},
): Promise<PaymentView[]> {
  const payments = await db.payment.findMany({
    where: {
      userId: actor.id,
      status: { in: filter.status ?? ['OPEN'] },
      ...(filter.documentId ? { documentId: filter.documentId } : {}),
      ...(filter.dueBefore ? { dueDate: { lte: filter.dueBefore } } : {}),
      OR: [{ documentId: null }, { document: { deletedAt: null } }],
    },
    orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    select: {
      id: true,
      status: true,
      direction: true,
      amount: true,
      currency: true,
      dueDate: true,
      dueUncertain: true,
      dueRule: true,
      purpose: true,
      iban: true,
      recipient: true,
      page: true,
      quote: true,
      verification: true,
      confidence: true,
      source: true,
      paidAt: true,
      documentId: true,
      document: { select: { title: true, sender: true, person: { select: { name: true } } } },
    },
  });

  return payments.map((payment) => ({
    id: payment.id,
    status: payment.status,
    direction: payment.direction,
    // Prisma liefert Decimal; die Umrechnung geht ueber die Zeichenkette,
    // damit unterwegs kein Fliesskomma entsteht.
    amountCents: Math.round(Number(payment.amount.toString()) * 100),
    currency: payment.currency,
    dueDate: payment.dueDate,
    dueUncertain: payment.dueUncertain,
    dueRule: payment.dueRule,
    purpose: payment.purpose,
    iban: payment.iban,
    recipient: payment.recipient,
    page: payment.page,
    quote: payment.quote,
    verification: payment.verification,
    confidence: payment.confidence,
    source: payment.source,
    paidAt: payment.paidAt,
    documentId: payment.documentId,
    documentTitle: payment.document?.title ?? payment.document?.sender ?? null,
    personName: payment.document?.person?.name ?? null,
  }));
}

export type PaymentResult = { ok: true; id: string } | { ok: false; error: string };

export async function confirmPayment(
  actor: SessionUser,
  paymentId: string,
): Promise<PaymentResult> {
  const updated = await db.payment.updateMany({
    where: { id: paymentId, userId: actor.id, status: 'PROPOSED' },
    data: { status: 'OPEN', verification: 'USER' },
  });

  if (updated.count === 0) return { ok: false, error: 'Vorschlag nicht gefunden.' };

  await maybeClearReview(actor, paymentId);
  log.info('payment.confirmed', { paymentId });
  return { ok: true, id: paymentId };
}

export async function setPaymentStatus(
  actor: SessionUser,
  paymentId: string,
  status: PaymentStatus,
): Promise<PaymentResult> {
  const updated = await db.payment.updateMany({
    where: { id: paymentId, userId: actor.id },
    data: { status, paidAt: status === 'PAID' ? new Date() : null },
  });

  if (updated.count === 0) return { ok: false, error: 'Zahlung nicht gefunden.' };

  await maybeClearReview(actor, paymentId);
  return { ok: true, id: paymentId };
}

/** Summe der offenen Zahlungen je Richtung, fuer das Dashboard. */
export async function openPaymentTotals(
  actor: SessionUser,
): Promise<{ outgoingCents: number; incomingCents: number; count: number }> {
  const payments = await db.payment.findMany({
    where: {
      userId: actor.id,
      status: 'OPEN',
      OR: [{ documentId: null }, { document: { deletedAt: null } }],
    },
    select: { amount: true, direction: true },
  });

  let outgoingCents = 0;
  let incomingCents = 0;

  for (const payment of payments) {
    const cents = Math.round(Number(payment.amount.toString()) * 100);
    if (payment.direction === 'OUTGOING') outgoingCents += cents;
    else incomingCents += cents;
  }

  return { outgoingCents, incomingCents, count: payments.length };
}

async function maybeClearReview(actor: SessionUser, paymentId: string): Promise<void> {
  const payment = await db.payment.findFirst({
    where: { id: paymentId, userId: actor.id },
    select: { documentId: true },
  });
  if (!payment?.documentId) return;

  const [openTasks, openPayments] = await Promise.all([
    db.task.count({ where: { documentId: payment.documentId, status: 'PROPOSED' } }),
    db.payment.count({ where: { documentId: payment.documentId, status: 'PROPOSED' } }),
  ]);

  if (openTasks === 0 && openPayments === 0) {
    await db.document.updateMany({
      where: { id: payment.documentId, userId: actor.id, reviewState: 'NEEDED' },
      data: { reviewState: 'REVIEWED' },
    });
  }
}
