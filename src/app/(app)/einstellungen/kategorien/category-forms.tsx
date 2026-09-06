'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { createCategoryAction, renameCategoryAction, type CategoryFormState } from './actions';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Speichern ...' : label}
    </Button>
  );
}

export function NewCategoryForm() {
  const [state, formAction] = useActionState<CategoryFormState, FormData>(createCategoryAction, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" fullWidth onClick={() => setOpen(true)}>
        Kategorie hinzufügen
      </Button>
    );
  }

  return (
    <form
      action={formAction}
      className="border-border bg-surface flex flex-col gap-4 rounded-2xl border p-4"
    >
      <Field label="Name" error={state.fieldErrors?.name}>
        {(props) => (
          <Input {...props} name="name" defaultValue={state.values?.name ?? ''} required autoFocus />
        )}
      </Field>
      <div className="flex gap-2">
        <SubmitButton label="Anlegen" />
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Abbrechen
        </Button>
      </div>
      {state.error && (
        <p className="bg-negative/10 text-negative rounded-xl px-3.5 py-3 text-sm" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function RenameCategoryForm({ category }: { category: { id: string; name: string } }) {
  const [state, formAction] = useActionState<CategoryFormState, FormData>(renameCategoryAction, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Umbenennen
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex items-end gap-2">
      <input type="hidden" name="categoryId" value={category.id} />
      <Field label="Name" error={state.fieldErrors?.name}>
        {(props) => <Input {...props} name="name" defaultValue={category.name} required autoFocus />}
      </Field>
      <SubmitButton label="Speichern" />
      <Button variant="ghost" onClick={() => setOpen(false)}>
        Abbrechen
      </Button>
    </form>
  );
}
