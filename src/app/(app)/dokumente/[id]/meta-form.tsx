'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import type { FieldMeta } from '@/lib/validation/document';
import { saveMetaAction, type MetaFormState } from './actions';

interface Option {
  id: string;
  name: string;
}

export interface MetaValues {
  documentId: string;
  title: string;
  documentType: string;
  sender: string;
  recipient: string;
  subject: string;
  documentDate: string;
  receivedDate: string;
  personId: string;
  categoryId: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" fullWidth disabled={pending}>
      {pending ? 'Speichern ...' : 'Angaben speichern'}
    </Button>
  );
}

/**
 * Die erkannten Angaben - jede einzelne bearbeitbar.
 *
 * Neben jedem Feld steht, woher der Wert stammt und wie sicher er ist. Eine
 * Angabe ohne pruefbaren Beleg wird ausdruecklich als unbestaetigt
 * gekennzeichnet: Der Benutzer soll auf einen Blick sehen, wo er hinschauen
 * muss.
 */
export function MetaForm({
  values,
  meta,
  persons,
  categories,
  personUncertain,
}: {
  values: MetaValues;
  meta: FieldMeta;
  persons: Option[];
  categories: Option[];
  personUncertain: boolean;
}) {
  const [state, formAction] = useActionState<MetaFormState, FormData>(saveMetaAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="documentId" value={values.documentId} />

      <MetaField label="Titel" entry={meta.title} error={state.fieldErrors?.title}>
        {(props) => <Input {...props} name="title" defaultValue={values.title} maxLength={200} />}
      </MetaField>

      <MetaField label="Absender" entry={meta.sender} error={state.fieldErrors?.sender}>
        {(props) => <Input {...props} name="sender" defaultValue={values.sender} maxLength={160} />}
      </MetaField>

      <MetaField label="Dokumentart" entry={meta.documentType}>
        {(props) => (
          <Input {...props} name="documentType" defaultValue={values.documentType} maxLength={80} />
        )}
      </MetaField>

      <MetaField label="Betreff" entry={meta.subject}>
        {(props) => <Input {...props} name="subject" defaultValue={values.subject} maxLength={300} />}
      </MetaField>

      <MetaField
        label="Person"
        entry={meta.person}
        hint={personUncertain ? 'Die Zuordnung war nicht eindeutig — bitte prüfen.' : undefined}
      >
        {(props) => (
          <Select
            {...props}
            name="personId"
            defaultValue={values.personId}
            placeholder="Keine Zuordnung"
            options={persons.map((person) => ({ value: person.id, label: person.name }))}
            invalid={personUncertain}
          />
        )}
      </MetaField>

      <MetaField label="Kategorie" entry={meta.category}>
        {(props) => (
          <Select
            {...props}
            name="categoryId"
            defaultValue={values.categoryId}
            placeholder="Keine Kategorie"
            options={categories.map((category) => ({ value: category.id, label: category.name }))}
          />
        )}
      </MetaField>

      <div className="grid gap-4 sm:grid-cols-2">
        <MetaField
          label="Datum des Schreibens"
          entry={meta.documentDate}
          error={state.fieldErrors?.documentDate}
        >
          {(props) => (
            <Input {...props} name="documentDate" type="date" defaultValue={values.documentDate} />
          )}
        </MetaField>

        <MetaField label="Eingang" entry={meta.receivedDate}>
          {(props) => (
            <Input {...props} name="receivedDate" type="date" defaultValue={values.receivedDate} />
          )}
        </MetaField>
      </div>

      <MetaField label="Empfänger" entry={meta.recipient}>
        {(props) => (
          <Input {...props} name="recipient" defaultValue={values.recipient} maxLength={160} />
        )}
      </MetaField>

      {state.error && (
        <p className="bg-negative/10 text-negative rounded-xl px-3.5 py-3 text-sm" role="alert">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p className="bg-positive/10 text-positive rounded-xl px-3.5 py-3 text-sm" role="status">
          Gespeichert. Eine erneute Analyse lässt deine Angaben unangetastet.
        </p>
      )}

      <SubmitButton />
    </form>
  );
}

/** Ein Feld mit dem Hinweis, woher sein Wert stammt. */
function MetaField({
  label,
  entry,
  hint,
  error,
  children,
}: {
  label: string;
  entry?: FieldMeta[string];
  hint?: string;
  error?: string;
  children: (props: { id: string; 'aria-describedby': string | undefined }) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-text-muted text-sm font-medium">{label}</span>
        <SourceChip entry={entry} />
      </div>

      <Field label="" error={error} hint={hint}>
        {children}
      </Field>
    </div>
  );
}

function SourceChip({ entry }: { entry?: FieldMeta[string] }) {
  if (!entry?.source) return null;

  if (entry.source === 'USER') {
    return <Chip tone="neutral">von dir</Chip>;
  }

  if (entry.verification === 'UNVERIFIED') {
    return <Chip tone="warning">unbestätigt</Chip>;
  }

  const confidence = entry.confidence ?? 0;
  return (
    <Chip tone={confidence >= 80 ? 'positive' : 'warning'} title={entry.quote}>
      KI {confidence}%{entry.page ? ` · S. ${entry.page}` : ''}
    </Chip>
  );
}

function Chip({
  tone,
  title,
  children,
}: {
  tone: 'neutral' | 'positive' | 'warning';
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        tone === 'neutral' && 'bg-surface-muted text-text-muted',
        tone === 'positive' && 'bg-positive/15 text-positive',
        tone === 'warning' && 'bg-warning/15 text-warning',
      )}
    >
      {children}
    </span>
  );
}
