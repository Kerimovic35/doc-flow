'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { loginAction, type LoginState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" fullWidth disabled={pending}>
      {pending ? 'Anmelden ...' : 'Anmelden'}
    </Button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="E-Mail-Adresse">
        {(props) => (
          <Input
            {...props}
            name="email"
            type="email"
            // Blendet auf dem iPhone die Tastatur mit @-Taste ein und laesst
            // das Passwort-Verwaltungsprogramm das Feld erkennen.
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            required
            invalid={Boolean(state.error)}
          />
        )}
      </Field>

      <Field label="Passwort">
        {(props) => (
          <Input
            {...props}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            invalid={Boolean(state.error)}
          />
        )}
      </Field>

      {state.error && (
        <p
          className="bg-negative/10 text-negative rounded-xl px-3.5 py-3 text-sm"
          role="alert"
          aria-live="polite"
        >
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
