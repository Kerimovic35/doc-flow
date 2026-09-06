'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { createPersonAction, updatePersonAction, type PersonFormState } from './actions';

const KIND_LABELS: Record<string, string> = {
  SELF: 'Ich selbst',
  FAMILY: 'Angehörige',
  OTHER: 'Sonstige',
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Speichern ...' : label}
    </Button>
  );
}

export function NewPersonForm() {
  const [state, formAction] = useActionState<PersonFormState, FormData>(createPersonAction, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" fullWidth onClick={() => setOpen(true)}>
        Person hinzufügen
      </Button>
    );
  }

  return (
    <form action={formAction} className="border-border bg-surface flex flex-col gap-4 rounded-2xl border p-4">
      <PersonFields state={state} />
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

export function EditPersonForm({
  person,
}: {
  person: {
    id: string;
    name: string;
    kind: string;
    birthDate: string;
    notes: string;
  };
}) {
  const [state, formAction] = useActionState<PersonFormState, FormData>(updatePersonAction, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="ghost" size="md" onClick={() => setOpen(true)}>
        Bearbeiten
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4 pt-3">
      {/* Feste Werte gehoeren in ein verborgenes Feld, nicht in eine
          Closure: Sonst waere die Aktion an eine Client-Funktion gebunden
          und bliebe vor der Hydration wirkungslos. */}
      <input type="hidden" name="personId" value={person.id} />
      <PersonFields state={state} person={person} />
      <div className="flex gap-2">
        <SubmitButton label="Speichern" />
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

function PersonFields({
  state,
  person,
}: {
  state: PersonFormState;
  person?: { name: string; kind: string; birthDate: string; notes: string };
}) {
  const values = state.values;

  return (
    <>
      <Field label="Name" error={state.fieldErrors?.name}>
        {(props) => (
          <Input
            {...props}
            name="name"
            defaultValue={values?.name ?? person?.name ?? ''}
            required
            maxLength={80}
            autoComplete="off"
          />
        )}
      </Field>

      <Field label="Verhältnis" hint="Hilft der KI bei der Zuordnung eines Briefes.">
        {(props) => (
          <Select
            {...props}
            name="kind"
            defaultValue={values?.kind ?? person?.kind ?? 'FAMILY'}
            options={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))}
          />
        )}
      </Field>

      <Field label="Geburtsdatum" hint="Freiwillig" error={state.fieldErrors?.birthDate}>
        {(props) => (
          <Input
            {...props}
            name="birthDate"
            type="date"
            defaultValue={values?.birthDate ?? person?.birthDate ?? ''}
          />
        )}
      </Field>

      <Field label="Notiz" hint="Freiwillig" error={state.fieldErrors?.notes}>
        {(props) => (
          <Textarea
            {...props}
            name="notes"
            rows={2}
            defaultValue={values?.notes ?? person?.notes ?? ''}
          />
        )}
      </Field>
    </>
  );
}
