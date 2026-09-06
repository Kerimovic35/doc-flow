'use server';

import { revalidatePath } from 'next/cache';
import { personSchema } from '@/lib/validation/person';
import { toFieldErrors, type FormState } from '@/lib/form-state';
import { requireUser } from '@/server/auth/context';
import {
  activatePerson,
  createPerson,
  deactivatePerson,
  updatePerson,
} from '@/server/services/persons';

/**
 * Duenne Adapter: Formulardaten pruefen, Dienst rufen, Ergebnis
 * zurueckgeben. Die Regeln stehen im Dienst, damit sie auch dann gelten,
 * wenn der Aufruf nicht aus diesem Formular kommt.
 */

export interface PersonFormState extends FormState {
  values?: { name?: string; kind?: string; birthDate?: string; notes?: string };
}

function readForm(formData: FormData) {
  return {
    name: String(formData.get('name') ?? ''),
    kind: String(formData.get('kind') ?? 'FAMILY'),
    birthDate: String(formData.get('birthDate') ?? ''),
    notes: String(formData.get('notes') ?? ''),
  };
}

export async function createPersonAction(
  _prev: PersonFormState,
  formData: FormData,
): Promise<PersonFormState> {
  const actor = await requireUser();
  const raw = readForm(formData);

  const parsed = personSchema.safeParse(raw);
  if (!parsed.success) {
    // React 19 leert das Formular nach jeder Aktion. Ohne die Rueckgabe
    // muesste der Benutzer nach einem Tippfehler alles neu eintippen.
    return { fieldErrors: toFieldErrors(parsed.error.issues), values: raw };
  }

  const result = await createPerson(actor, parsed.data);
  if (!result.ok) {
    return { error: result.error, values: raw };
  }

  revalidatePath('/einstellungen/personen');
  return {};
}

export async function updatePersonAction(
  _prev: PersonFormState,
  formData: FormData,
): Promise<PersonFormState> {
  const actor = await requireUser();
  const personId = String(formData.get('personId') ?? '');
  const raw = readForm(formData);

  const parsed = personSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: toFieldErrors(parsed.error.issues), values: raw };
  }

  const result = await updatePerson(actor, personId, parsed.data);
  if (!result.ok) {
    return { error: result.error, values: raw };
  }

  revalidatePath('/einstellungen/personen');
  return {};
}

export async function togglePersonAction(formData: FormData): Promise<void> {
  const actor = await requireUser();
  const personId = String(formData.get('personId') ?? '');
  const activate = String(formData.get('activate') ?? '') === '1';

  if (activate) {
    await activatePerson(actor, personId);
  } else {
    await deactivatePerson(actor, personId);
  }

  revalidatePath('/einstellungen/personen');
}
