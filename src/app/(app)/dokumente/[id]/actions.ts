'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { DocumentLifecycle } from '@/generated/prisma/enums';
import { documentMetaSchema } from '@/lib/validation/document';
import { toFieldErrors, type FormState } from '@/lib/form-state';
import { requireUser } from '@/server/auth/context';
import {
  reprocessDocument,
  setLifecycle,
  softDeleteDocument,
} from '@/server/services/documents';
import { updateDocumentMeta } from '@/server/services/document-meta';

export interface MetaFormState extends FormState {
  saved?: boolean;
}

export async function saveMetaAction(
  _prev: MetaFormState,
  formData: FormData,
): Promise<MetaFormState> {
  const actor = await requireUser();
  const documentId = String(formData.get('documentId') ?? '');

  const parsed = documentMetaSchema.safeParse({
    title: formData.get('title'),
    documentType: formData.get('documentType'),
    sender: formData.get('sender'),
    recipient: formData.get('recipient'),
    subject: formData.get('subject'),
    documentDate: formData.get('documentDate'),
    receivedDate: formData.get('receivedDate'),
    personId: formData.get('personId'),
    categoryId: formData.get('categoryId'),
  });

  if (!parsed.success) {
    return { fieldErrors: toFieldErrors(parsed.error.issues) };
  }

  const result = await updateDocumentMeta(actor, documentId, parsed.data);
  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath(`/dokumente/${documentId}`);
  return { saved: true };
}

export async function setLifecycleAction(formData: FormData): Promise<void> {
  const actor = await requireUser();
  const documentId = String(formData.get('documentId') ?? '');
  const lifecycle = String(formData.get('lifecycle') ?? 'ACTIVE') as DocumentLifecycle;

  await setLifecycle(actor, documentId, lifecycle);
  revalidatePath(`/dokumente/${documentId}`);
}

export async function reprocessAction(formData: FormData): Promise<void> {
  const actor = await requireUser();
  const documentId = String(formData.get('documentId') ?? '');

  await reprocessDocument(actor, documentId);
  revalidatePath(`/dokumente/${documentId}`);
}

export async function deleteDocumentAction(formData: FormData): Promise<void> {
  const actor = await requireUser();
  const documentId = String(formData.get('documentId') ?? '');

  await softDeleteDocument(actor, documentId);

  // `redirect` wirft intern eine Kontrollausnahme und steht deshalb
  // ausserhalb jeder Fehlerbehandlung.
  redirect('/dokumente');
}
