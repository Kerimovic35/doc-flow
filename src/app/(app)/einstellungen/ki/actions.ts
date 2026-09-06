'use server';

import { revalidatePath } from 'next/cache';
import { aiSettingsSchema } from '@/lib/validation/settings';
import { toFieldErrors, type FormState } from '@/lib/form-state';
import { requireUser } from '@/server/auth/context';
import { updateAiSettings } from '@/server/services/settings';

export interface AiSettingsState extends FormState {
  saved?: boolean;
}

export async function saveAiSettingsAction(
  _prev: AiSettingsState,
  formData: FormData,
): Promise<AiSettingsState> {
  const actor = await requireUser();

  const parsed = aiSettingsSchema.safeParse({
    aiEnabled: formData.get('aiEnabled') === 'on',
    aiProvider: String(formData.get('aiProvider') ?? 'ANTHROPIC'),
    aiModel: String(formData.get('aiModel') ?? ''),
    aiEffort: String(formData.get('aiEffort') ?? 'high'),
    analysisUseImages: formData.get('analysisUseImages') === 'on',
    visionOcrEnabled: formData.get('visionOcrEnabled') === 'on',
    autoAnalyze: formData.get('autoAnalyze') === 'on',
    ocrThreshold: String(formData.get('ocrThreshold') ?? '70'),
  });

  if (!parsed.success) {
    return { fieldErrors: toFieldErrors(parsed.error.issues) };
  }

  await updateAiSettings(actor, parsed.data);
  revalidatePath('/einstellungen/ki');
  return { saved: true };
}
