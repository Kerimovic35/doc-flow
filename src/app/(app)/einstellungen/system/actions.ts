'use server';

import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state';
import { requireRole } from '@/server/auth/context';
import { createBackup, deleteBackup } from '@/server/services/backup';

export interface BackupState extends FormState {
  created?: string[];
}

export async function createBackupAction(
  _prev: BackupState,
  _formData: FormData,
): Promise<BackupState> {
  const actor = await requireRole('ADMIN');

  const result = await createBackup(actor);
  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath('/einstellungen/system');
  return { created: result.names };
}

export async function deleteBackupAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN');
  const name = String(formData.get('name') ?? '');

  await deleteBackup(actor, name);
  revalidatePath('/einstellungen/system');
}
