'use server';

import { revalidatePath } from 'next/cache';
import type { PaymentStatus, TaskStatus } from '@/generated/prisma/enums';
import { requireUser } from '@/server/auth/context';
import { confirmPayment, setPaymentStatus } from '@/server/services/payments';
import { confirmTask, postponeTask, setTaskStatus } from '@/server/services/tasks';

/**
 * Duenne Adapter fuer die Aufgaben- und Zahlungsliste.
 *
 * Jede Aktion nimmt ihre Werte aus verborgenen Feldern, nicht aus einer
 * Closure: Sonst waere sie an eine Client-Funktion gebunden und bliebe vor
 * der Hydration wirkungslos.
 */

export async function confirmTaskAction(formData: FormData): Promise<void> {
  const actor = await requireUser();
  await confirmTask(actor, String(formData.get('taskId') ?? ''));
  revalidateAll(formData);
}

export async function taskStatusAction(formData: FormData): Promise<void> {
  const actor = await requireUser();
  const status = String(formData.get('status') ?? 'OPEN') as TaskStatus;

  await setTaskStatus(actor, String(formData.get('taskId') ?? ''), status);
  revalidateAll(formData);
}

export async function postponeTaskAction(formData: FormData): Promise<void> {
  const actor = await requireUser();
  const days = Number(formData.get('days') ?? '7');
  const until = new Date();
  until.setUTCHours(0, 0, 0, 0);
  until.setUTCDate(until.getUTCDate() + (Number.isFinite(days) ? days : 7));

  await postponeTask(actor, String(formData.get('taskId') ?? ''), until);
  revalidateAll(formData);
}

export async function confirmPaymentAction(formData: FormData): Promise<void> {
  const actor = await requireUser();
  await confirmPayment(actor, String(formData.get('paymentId') ?? ''));
  revalidateAll(formData);
}

export async function paymentStatusAction(formData: FormData): Promise<void> {
  const actor = await requireUser();
  const status = String(formData.get('status') ?? 'OPEN') as PaymentStatus;

  await setPaymentStatus(actor, String(formData.get('paymentId') ?? ''), status);
  revalidateAll(formData);
}

/**
 * Aufgaben und Zahlungen erscheinen an mehreren Stellen. Eine Bestaetigung
 * im Dokument muss auch die Liste und das Dashboard erneuern.
 */
function revalidateAll(formData: FormData): void {
  revalidatePath('/aufgaben');
  revalidatePath('/start');

  const documentId = formData.get('documentId');
  if (typeof documentId === 'string' && documentId) {
    revalidatePath(`/dokumente/${documentId}`);
  }
}
