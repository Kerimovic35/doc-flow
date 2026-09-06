'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { saveReminderSettingsAction, type ReminderSettingsState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" fullWidth disabled={pending}>
      {pending ? 'Speichern ...' : 'Speichern'}
    </Button>
  );
}

export function ReminderForm({ reminderDays }: { reminderDays: number[] }) {
  const [state, formAction] = useActionState<ReminderSettingsState, FormData>(
    saveReminderSettingsAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field
        label="Vorlauf in Tagen"
        hint="Durch Komma getrennt. 0 bedeutet am Fälligkeitstag selbst."
        error={state.fieldErrors?.reminderDays}
      >
        {(props) => (
          <Input
            {...props}
            name="reminderDays"
            defaultValue={reminderDays.join(', ')}
            inputMode="numeric"
            autoComplete="off"
          />
        )}
      </Field>

      {state.saved && (
        <p className="bg-positive/10 text-positive rounded-xl px-3.5 py-3 text-sm" role="status">
          Gespeichert.
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
