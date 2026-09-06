'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { createBackupAction, type BackupState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? 'Backup läuft ...' : 'Backup jetzt erstellen'}
    </Button>
  );
}

export function BackupButton() {
  const [state, formAction] = useActionState<BackupState, FormData>(createBackupAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <SubmitButton />

      {state.error && (
        <p className="bg-negative/10 text-negative rounded-xl px-3.5 py-3 text-sm" role="alert">
          {state.error}
        </p>
      )}
      {state.created && (
        <p className="bg-positive/10 text-positive rounded-xl px-3.5 py-3 text-sm" role="status">
          {state.created.length === 1
            ? 'Ein Abzug erstellt.'
            : `${state.created.length} Abzüge erstellt.`}
        </p>
      )}
    </form>
  );
}
