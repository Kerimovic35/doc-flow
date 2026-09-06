'use client';

import { useId } from 'react';
import { cn } from '@/lib/cn';

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: (props: { id: string; 'aria-describedby': string | undefined }) => React.ReactNode;
}

/**
 * Beschriftung, Hinweis und Fehlermeldung um ein Eingabefeld.
 *
 * Der Fehler wird ueber `aria-describedby` mit dem Feld verknuepft, damit ihn
 * ein Screenreader beim Fokussieren mitliest - eine rot gefaerbte Zeile
 * daneben allein waere fuer diese Nutzer unsichtbar.
 */
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-text-muted text-sm font-medium">
        {label}
      </label>

      {children({ id, 'aria-describedby': describedBy })}

      {hint && !error && (
        <p id={`${id}-hint`} className="text-text-muted text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-negative text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ invalid, className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        'bg-surface border-border text-text min-h-12 rounded-xl border px-3.5',
        'placeholder:text-text-muted/60',
        'focus:border-accent focus:outline-none',
        invalid && 'border-negative',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Zahlenfeld fuer Mengen und Betraege.
 *
 * `inputMode="decimal"` blendet auf dem iPhone den grossen Ziffernblock ein
 * statt der vollen Tastatur - der wesentliche Unterschied beim schnellen
 * Erfassen unterwegs. `type="text"` statt `type="number"`, weil letzteres
 * das Komma je nach Gebietsschema verschluckt und ein versehentliches
 * Scrollen den Wert veraendern kann.
 */
export function NumberInput({ className, ...props }: InputProps) {
  return (
    <Input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={cn('tabular', className)}
      {...props}
    />
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  options: ReadonlyArray<{ value: string; label: string }>;
  placeholder?: string;
}

export function Select({ invalid, options, placeholder, className, ...props }: SelectProps) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn(
        'bg-surface border-border text-text min-h-12 rounded-xl border px-3',
        'focus:border-accent focus:outline-none',
        invalid && 'border-negative',
        className,
      )}
      {...props}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={3}
      className={cn(
        'bg-surface border-border text-text rounded-xl border px-3.5 py-2.5',
        'focus:border-accent focus:outline-none',
        className,
      )}
      {...props}
    />
  );
}

/** Ankreuzfeld mit grosszuegiger Trefferflaeche fuer die Bedienung per Finger. */
export function Checkbox({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="bg-surface border-border flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3">
      <input type="checkbox" className="accent-accent h-5 w-5 shrink-0" {...props} />
      <span className="flex flex-col">
        <span className="text-[15px]">{label}</span>
        {hint && <span className="text-text-muted text-xs">{hint}</span>}
      </span>
    </label>
  );
}
