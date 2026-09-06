'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { CameraIcon, CloseIcon, DocumentIcon, PlusIcon } from '@/components/ui/icons';
import { ACCEPT_ATTRIBUTE, MAX_FILES_PER_DOCUMENT, formatBytes } from '@/lib/validation/upload';

/**
 * Erfassen eines Dokuments.
 *
 * Der Ablauf ist auf den Regelfall zugeschnitten: Brief aufschlagen, Seiten
 * fotografieren, fertig. Alles andere - Galerie, PDF, Person, Kategorie -
 * steht daneben, drängt sich aber nicht auf.
 *
 * Jede Seite wird einzeln hochgeladen, sobald sie aufgenommen ist. Damit ist
 * die Wartezeit am Ende kurz, und ein Wechsel in eine andere App kostet
 * hoechstens die gerade laufende Datei.
 */

interface Option {
  id: string;
  name: string;
}

type PageState = 'wartet' | 'laedt' | 'fertig' | 'fehler';

interface CapturedPage {
  key: string;
  file: File;
  previewUrl: string;
  state: PageState;
  error?: string;
}

export function CaptureForm({
  persons,
  categories,
}: {
  persons: Option[];
  categories: Option[];
}) {
  const router = useRouter();

  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [personId, setPersonId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [duplicateHint, setDuplicateHint] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  // Die Dokument-ID entsteht beim ersten Upload und gilt danach fuer alle
  // weiteren Seiten. In einer Ref, weil mehrere Uploads gleichzeitig laufen
  // koennen und der Zustand dafuer zu traege waere.
  const documentIdRef = useRef<string | null>(null);

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    const accepted = Array.from(files).slice(0, MAX_FILES_PER_DOCUMENT - pages.length);
    if (accepted.length < files.length) {
      setError(`Es sind höchstens ${MAX_FILES_PER_DOCUMENT} Dateien je Dokument möglich.`);
    }

    const added: CapturedPage[] = accepted.map((file, index) => ({
      key: `${Date.now()}-${index}-${file.name}`,
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      state: 'wartet',
    }));

    setPages((current) => [...current, ...added]);

    // Nacheinander hochladen: Das erste Ergebnis liefert die Dokument-ID, die
    // alle weiteren brauchen.
    for (const page of added) {
      await uploadPage(page);
    }
  }

  async function uploadPage(page: CapturedPage) {
    setPages((current) =>
      current.map((entry) => (entry.key === page.key ? { ...entry, state: 'laedt' } : entry)),
    );

    const form = new FormData();
    form.append('datei', page.file);
    if (documentIdRef.current) {
      form.append('documentId', documentIdRef.current);
    } else {
      if (personId) form.append('personId', personId);
      if (categoryId) form.append('categoryId', categoryId);
    }

    try {
      const response = await fetch('/api/dokumente/upload', { method: 'POST', body: form });
      const data = (await response.json()) as {
        documentId?: string;
        duplicateOf?: string | null;
        error?: string;
      };

      if (!response.ok) {
        setPages((current) =>
          current.map((entry) =>
            entry.key === page.key
              ? { ...entry, state: 'fehler', error: data.error ?? 'Fehlgeschlagen' }
              : entry,
          ),
        );
        return;
      }

      if (data.documentId && !documentIdRef.current) {
        documentIdRef.current = data.documentId;
        setDocumentId(data.documentId);
      }

      if (data.duplicateOf) {
        setDuplicateHint(
          'Diese Datei gibt es bereits in einem anderen Dokument. Du kannst trotzdem fortfahren.',
        );
      }

      setPages((current) =>
        current.map((entry) => (entry.key === page.key ? { ...entry, state: 'fertig' } : entry)),
      );
    } catch {
      setPages((current) =>
        current.map((entry) =>
          entry.key === page.key
            ? { ...entry, state: 'fehler', error: 'Keine Verbindung' }
            : entry,
        ),
      );
    }
  }

  async function finish() {
    if (!documentIdRef.current) return;
    setFinishing(true);
    setError(null);

    try {
      const response = await fetch(`/api/dokumente/${documentIdRef.current}/abschliessen`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setError(data.error ?? 'Das Dokument konnte nicht abgeschlossen werden.');
        setFinishing(false);
        return;
      }

      // Auf die Detailseite: Dort läuft die Fortschrittsanzeige weiter.
      router.push(`/dokumente/${documentIdRef.current}`);
    } catch {
      setError('Keine Verbindung. Bitte erneut versuchen.');
      setFinishing(false);
    }
  }

  const uploaded = pages.filter((page) => page.state === 'fertig').length;
  const busy = pages.some((page) => page.state === 'laedt');
  const canFinish = Boolean(documentId) && uploaded > 0 && !busy && !finishing;

  return (
    <div className="flex flex-col gap-5">
      {pages.length === 0 && (
        <div className="flex flex-col gap-3">
          <Field label="Person" hint="Kann später geändert werden.">
            {(props) => (
              <Select
                {...props}
                value={personId}
                onChange={(event) => setPersonId(event.target.value)}
                placeholder="Von der KI erkennen lassen"
                options={persons.map((person) => ({ value: person.id, label: person.name }))}
              />
            )}
          </Field>

          <Field label="Kategorie" hint="Kann später geändert werden.">
            {(props) => (
              <Select
                {...props}
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                placeholder="Von der KI erkennen lassen"
                options={categories.map((category) => ({
                  value: category.id,
                  label: category.name,
                }))}
              />
            )}
          </Field>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Button size="lg" fullWidth onClick={() => cameraInput.current?.click()}>
          <CameraIcon className="h-5 w-5" />
          {pages.length === 0 ? 'Seite fotografieren' : 'Weitere Seite'}
        </Button>

        <Button variant="secondary" fullWidth onClick={() => galleryInput.current?.click()}>
          <PlusIcon className="h-5 w-5" />
          Aus Dateien oder Galerie
        </Button>
      </div>

      {/* Zwei getrennte Felder: `capture` oeffnet direkt die Kamera, ohne
          landet man in der Dateiauswahl. Ein Feld kann nicht beides. */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          void addFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={galleryInput}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        hidden
        onChange={(event) => {
          void addFiles(event.target.files);
          event.target.value = '';
        }}
      />

      {duplicateHint && (
        <p className="bg-warning/10 text-warning rounded-xl px-3.5 py-3 text-sm">{duplicateHint}</p>
      )}
      {error && (
        <p className="bg-negative/10 text-negative rounded-xl px-3.5 py-3 text-sm" role="alert">
          {error}
        </p>
      )}

      {pages.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {pages.map((page, index) => (
            <li
              key={page.key}
              className="border-border bg-surface relative overflow-hidden rounded-xl border"
            >
              <div className="bg-surface-muted flex aspect-3/4 items-center justify-center">
                {page.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={page.previewUrl}
                    alt={`Seite ${index + 1}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <DocumentIcon className="text-text-muted h-8 w-8" />
                )}
              </div>

              <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                <span className="text-text-muted text-[11px]">
                  {page.state === 'laedt' && 'lädt ...'}
                  {page.state === 'fertig' && `Seite ${index + 1}`}
                  {page.state === 'wartet' && 'wartet'}
                  {page.state === 'fehler' && (
                    <span className="text-negative">{page.error ?? 'Fehler'}</span>
                  )}
                </span>
                <span className="text-text-muted text-[10px]">{formatBytes(page.file.size)}</span>
              </div>

              {page.state === 'fehler' && (
                <button
                  type="button"
                  onClick={() => void uploadPage(page)}
                  className="bg-accent text-accent-fg absolute top-1 right-1 rounded-full px-2 py-1 text-[10px]"
                >
                  erneut
                </button>
              )}
              {page.state === 'wartet' && (
                <button
                  type="button"
                  aria-label={`Seite ${index + 1} entfernen`}
                  onClick={() =>
                    setPages((current) => current.filter((entry) => entry.key !== page.key))
                  }
                  className="bg-surface/90 absolute top-1 right-1 rounded-full p-1"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {pages.length > 0 && (
        <Button size="lg" fullWidth disabled={!canFinish} onClick={() => void finish()}>
          {finishing
            ? 'Wird verarbeitet ...'
            : busy
              ? 'Seiten werden übertragen ...'
              : `Fertig (${uploaded} ${uploaded === 1 ? 'Seite' : 'Seiten'})`}
        </Button>
      )}

      <p className="text-text-muted text-sm">
        Nach dem Abschließen läuft die Verarbeitung im Hintergrund weiter. Du kannst die App
        währenddessen schließen.
      </p>
    </div>
  );
}
