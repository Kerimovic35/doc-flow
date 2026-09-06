'use server';

import { revalidatePath } from 'next/cache';
import { reminderSettingsSchema } from '@/lib/validation/settings';
import { toFieldErrors, type FormState } from '@/lib/form-state';
import { requireUser } from '@/server/auth/context';
import { updateReminderSettings } from '@/server/services/settings';

export interface ReminderSettingsState extends FormState {
  saved?: boolean;
}

export async function saveReminderSettingsAction(
  _prev: ReminderSettingsState,
  formData: FormData,
): Promise<ReminderSettingsState> {
  const actor = await requireUser();

  const parsed = reminderSettingsSchema.safeParse({
    reminderDays: String(formData.get('reminderDays') ?? ''),
  });

  if (!parsed.success) {
    return { fieldErrors: toFieldErrors(parsed.error.issues) };
  }

  await updateReminderSettings(actor, parsed.data);
  revalidatePath('/einstellungen/erinnerungen');
  return { saved: true };
}
