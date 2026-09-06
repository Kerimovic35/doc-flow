'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { AI_EFFORTS, ANTHROPIC_MODELS } from '@/lib/validation/settings';
import type { UserSettingsView } from '@/server/services/settings';
import { saveAiSettingsAction, type AiSettingsState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" fullWidth disabled={pending}>
      {pending ? 'Speichern ...' : 'Speichern'}
    </Button>
  );
}

export function AiSettingsForm({ settings }: { settings: UserSettingsView }) {
  const [state, formAction] = useActionState<AiSettingsState, FormData>(saveAiSettingsAction, {});

  const providerOptions = [
    { value: 'ANTHROPIC', label: 'Anthropic (Claude)' },
    {
      value: 'OLLAMA',
      label: settings.ollamaConfigured ? 'Ollama (lokal)' : 'Ollama (nicht eingerichtet)',
    },
  ];

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Checkbox
        name="aiEnabled"
        defaultChecked={settings.aiEnabled}
        label="Künstliche Intelligenz verwenden"
        hint="Ohne KI werden Dokumente weiterhin erfasst und durchsucht, aber nicht analysiert."
      />

      <Field
        label="Anbieter"
        hint={
          settings.anthropicKeyPresent
            ? 'Ein Anthropic-Schlüssel ist hinterlegt.'
            : 'Kein Anthropic-Schlüssel hinterlegt (ANTHROPIC_API_KEY in der Umgebung setzen).'
        }
      >
        {(props) => (
          <Select
            {...props}
            name="aiProvider"
            defaultValue={settings.aiProvider}
            options={providerOptions}
          />
        )}
      </Field>

      <Field label="Modell">
        {(props) => (
          <Select
            {...props}
            name="aiModel"
            defaultValue={settings.aiModel}
            options={ANTHROPIC_MODELS.map((model) => ({ value: model.id, label: model.label }))}
          />
        )}
      </Field>

      <Field
        label="Gründlichkeit"
        hint="Höhere Stufen denken länger nach und kosten mehr Tokens."
      >
        {(props) => (
          <Select
            {...props}
            name="aiEffort"
            defaultValue={settings.aiEffort}
            options={AI_EFFORTS.map((effort) => ({ value: effort.id, label: effort.label }))}
          />
        )}
      </Field>

      <Checkbox
        name="autoAnalyze"
        defaultChecked={settings.autoAnalyze}
        label="Nach der Texterkennung automatisch analysieren"
        hint="Sonst wird die Analyse pro Dokument von Hand gestartet."
      />

      <Checkbox
        name="analysisUseImages"
        defaultChecked={settings.analysisUseImages}
        label="Seitenbilder mitschicken"
        hint="Briefköpfe und Tabellen werden im Bild besser erkannt. Belege prüft die Anwendung weiterhin nur gegen den erkannten Text."
      />

      <Checkbox
        name="visionOcrEnabled"
        defaultChecked={settings.visionOcrEnabled}
        label="Schlecht lesbare Seiten von der KI nachlesen lassen"
        hint="Nur für Seiten unterhalb der Schwelle. Das Ergebnis ist Modellausgabe und wird entsprechend niedriger bewertet."
      />

      <Field
        label="Schwelle für gute Texterkennung"
        hint="Unterhalb dieses Werts gilt eine Seite als unsicher (0 bis 100)."
        error={state.fieldErrors?.ocrThreshold}
      >
        {(props) => (
          <Input
            {...props}
            name="ocrThreshold"
            type="number"
            min={0}
            max={100}
            defaultValue={settings.ocrThreshold}
          />
        )}
      </Field>

      {state.error && (
        <p className="bg-negative/10 text-negative rounded-xl px-3.5 py-3 text-sm" role="alert">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p className="bg-positive/10 text-positive rounded-xl px-3.5 py-3 text-sm" role="status">
          Gespeichert.
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
