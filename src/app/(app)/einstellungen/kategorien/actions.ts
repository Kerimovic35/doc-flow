'use server';

import { revalidatePath } from 'next/cache';
import { categorySchema } from '@/lib/validation/category';
import { toFieldErrors, type FormState } from '@/lib/form-state';
import { requireUser } from '@/server/auth/context';
import {
  activateCategory,
  createCategory,
  deactivateCategory,
  renameCategory,
} from '@/server/services/categories';

export interface CategoryFormState extends FormState {
  values?: { name?: string };
}

export async function createCategoryAction(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const actor = await requireUser();
  const raw = { name: String(formData.get('name') ?? '') };

  const parsed = categorySchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: toFieldErrors(parsed.error.issues), values: raw };
  }

  const result = await createCategory(actor, parsed.data);
  if (!result.ok) {
    return { error: result.error, values: raw };
  }

  revalidatePath('/einstellungen/kategorien');
  return {};
}

export async function renameCategoryAction(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const actor = await requireUser();
  const categoryId = String(formData.get('categoryId') ?? '');
  const raw = { name: String(formData.get('name') ?? '') };

  const parsed = categorySchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: toFieldErrors(parsed.error.issues), values: raw };
  }

  const result = await renameCategory(actor, categoryId, parsed.data);
  if (!result.ok) {
    return { error: result.error, values: raw };
  }

  revalidatePath('/einstellungen/kategorien');
  return {};
}

export async function toggleCategoryAction(formData: FormData): Promise<void> {
  const actor = await requireUser();
  const categoryId = String(formData.get('categoryId') ?? '');
  const activate = String(formData.get('activate') ?? '') === '1';

  if (activate) {
    await activateCategory(actor, categoryId);
  } else {
    await deactivateCategory(actor, categoryId);
  }

  revalidatePath('/einstellungen/kategorien');
}
