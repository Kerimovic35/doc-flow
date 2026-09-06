'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { changePasswordAction, type PasswordState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" fullWidth disabled={pending}>
      {pending ? 'Ändern ...' : 'Passwort ändern'}
    </Button>
  );
}

export function PasswordForm() {
  const [state, formAction] = useActionState<PasswordState, FormData>(changePasswordAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="Aktuelles Passwort" error={state.fieldErrors?.currentPassword}>
        {(props) => (
          <Input {...props} name="currentPassword" type="password" autoComplete="current-password" required />
        )}
      </Field>

      <Field
        label="Neues Passwort"
        hint="Mindestens zwölf Zeichen."
        error={state.fieldErrors?.newPassword}
      >
        {(props) => (
          <Input {...props} name="newPassword" type="password" autoComplete="new-password" required />
        )}
      </Field>

      <Field label="Neues Passwort wiederholen" error={state.fieldErrors?.confirmPassword}>
        {(props) => (
          <Input {...props} name="confirmPassword" type="password" autoComplete="new-password" required />
        )}
      </Field>

      {state.error && (
        <p className="bg-negative/10 text-negative rounded-xl px-3.5 py-3 text-sm" role="alert">
          {state.error}
        </p>
      )}

      <p className="text-text-muted text-sm">
        Nach der Änderung wirst du auf allen Geräten abgemeldet.
      </p>

      <SubmitButton />
    </form>
  );
}
