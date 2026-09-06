'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { statusLabel } from '@/components/documents/status-badge';
import { WarningIcon } from '@/components/ui/icons';
import type { ProcessingStatus, ReviewState } from '@/generated/prisma/enums';

interface StatusResponse {
  processingStatus: ProcessingStatus;
  processingStep: string | null;
  progressDone: number;
  progressTotal: number;
  reviewState: ReviewState;
  pageCount: number;
  lastError: string | null;
}

const RUNNING: ProcessingStatus[] = ['UPLOADED', 'PREPARING', 'OCR', 'ANALYZING'];

/**
 * Fortschrittsanzeige der Verarbeitung.
 *
 * Fragt im Sekundentakt nach, solange die Kette laeuft, und laedt die Seite
 * neu, sobald sie fertig ist. Ein dauerhaft offener Kanal waere hier
 * unverhaeltnismaessig: Es geht um wenige Minuten je Dokument.
 */
export function ProcessingBanner({
  documentId,
  initial,
}: {
  documentId: string;
  initial: StatusResponse;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);

  useEffect(() => {
    if (!RUNNING.includes(status.processingStatus)) return;

    let active = true;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/dokumente/${documentId}/status`, {
          cache: 'no-store',
        });
        if (!response.ok || !active) return;

        const next = (await response.json()) as StatusResponse;
        setStatus(next);

        // Fertig oder gescheitert: Die Seite braucht die neuen Daten vom
        // Server, nicht nur einen neuen Status.
        if (!RUNNING.includes(next.processingStatus)) {
          router.refresh();
        }
      } catch {
        // Netz kurz weg - beim naechsten Durchlauf erneut versuchen.
      }
    }, 2000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [documentId, status.processingStatus, router]);

  if (status.processingStatus === 'FAILED') {
    return (
      <div className="bg-negative/10 flex flex-col gap-2 rounded-2xl px-4 py-3">
        <p className="text-negative flex items-center gap-2 text-sm font-medium">
          <WarningIcon className="h-4 w-4" />
          Die Verarbeitung ist gescheitert
        </p>
        <p className="text-text-muted text-sm">
          {status.lastError ?? 'Unbekannter Fehler.'} Das Dokument und seine Originaldateien sind
          erhalten geblieben.
        </p>
      </div>
    );
  }

  if (!RUNNING.includes(status.processingStatus)) return null;

  const percent =
    status.progressTotal > 0
      ? Math.min(100, Math.round((status.progressDone / status.progressTotal) * 100))
      : null;

  return (
    <div className="bg-surface-muted flex flex-col gap-2 rounded-2xl px-4 py-3">
      <p className="text-sm font-medium">
        {statusLabel(
          status.processingStatus,
          status.processingStep,
          status.progressDone,
          status.progressTotal,
        )}
      </p>

      <div className="bg-border h-1.5 overflow-hidden rounded-full">
        <div
          className="bg-accent h-full rounded-full transition-[width] duration-300"
          style={{ width: percent === null ? '25%' : `${percent}%` }}
        />
      </div>

      <p className="text-text-muted text-xs">
        Du kannst die App schließen — die Verarbeitung läuft auf dem Server weiter.
      </p>
    </div>
  );
}

/** Umschalter zwischen Seiten, Angaben, Text und Nachfrage. */
export function DocumentTabs({
  pages,
  meta,
  text,
  chat,
}: {
  pages: React.ReactNode;
  meta: React.ReactNode;
  text: React.ReactNode;
  chat: React.ReactNode;
}) {
  const [tab, setTab] = useState<'seiten' | 'angaben' | 'text' | 'fragen'>('seiten');

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Ansicht"
        className="bg-surface-muted flex gap-1 rounded-xl p-1"
      >
        <TabButton active={tab === 'seiten'} onClick={() => setTab('seiten')}>
          Seiten
        </TabButton>
        <TabButton active={tab === 'angaben'} onClick={() => setTab('angaben')}>
          Angaben
        </TabButton>
        <TabButton active={tab === 'text'} onClick={() => setTab('text')}>
          Text
        </TabButton>
        <TabButton active={tab === 'fragen'} onClick={() => setTab('fragen')}>
          Fragen
        </TabButton>
      </div>

      <div hidden={tab !== 'seiten'}>{pages}</div>
      <div hidden={tab !== 'angaben'}>{meta}</div>
      <div hidden={tab !== 'text'}>{text}</div>
      {/* Der Chat wird erst beim Oeffnen gerendert - sonst liefe die
          Verlaufsabfrage bei jedem Seitenaufruf mit. */}
      {tab === 'fragen' && <div>{chat}</div>}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        active
          ? 'bg-surface text-text min-h-10 flex-1 rounded-lg text-sm font-medium shadow-sm'
          : 'text-text-muted min-h-10 flex-1 rounded-lg text-sm font-medium'
      }
    >
      {children}
    </button>
  );
}

/**
 * Seitenbild in voller Groesse.
 *
 * Oeffnet sich auch von aussen: Ein Verweis mit `?seite=2` - etwa aus einer
 * Fussnote des Assistenten - springt direkt auf die Seite. Ohne diesen Weg
 * bliebe die Fundstelle eine Behauptung, die niemand nachschlaegt.
 */
export function PageViewer({
  documentId,
  pages,
}: {
  documentId: string;
  pages: Array<{ id: string; pageNumber: number }>;
}) {
  const params = useSearchParams();
  const wanted = Number(params.get('seite') ?? '');

  const [open, setOpen] = useState<number | null>(() => {
    if (!Number.isInteger(wanted)) return null;
    const index = pages.findIndex((page) => page.pageNumber === wanted);
    return index >= 0 ? index : null;
  });

  if (pages.length === 0) {
    return <p className="text-text-muted text-sm">Noch keine Seiten aufbereitet.</p>;
  }

  const current = open === null ? null : pages[open];

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {pages.map((page, index) => (
          <li key={page.id}>
            <button
              type="button"
              onClick={() => setOpen(index)}
              className="border-border bg-surface block w-full overflow-hidden rounded-xl border"
              aria-label={`Seite ${page.pageNumber} groß anzeigen`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/dokumente/${documentId}/seite/${page.id}?vorschau=1`}
                alt={`Seite ${page.pageNumber}`}
                className="aspect-3/4 w-full object-cover"
                loading="lazy"
              />
              <span className="text-text-muted block py-1.5 text-center text-xs">
                Seite {page.pageNumber}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {current && (
        <div
          className="bg-canvas/95 fixed inset-0 z-50 flex flex-col overflow-auto backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Seite ${current.pageNumber}`}
        >
          <div className="pt-safe bg-canvas/95 sticky top-0 flex items-center justify-between px-4 py-3">
            <span className="text-sm font-medium">
              Seite {current.pageNumber} von {pages.length}
            </span>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              Schließen
            </Button>
          </div>

          <div className="flex-1 px-2 pb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/dokumente/${documentId}/seite/${current.id}`}
              alt={`Seite ${current.pageNumber}`}
              className="mx-auto max-w-3xl rounded-xl"
            />
          </div>

          <div className="pb-safe bg-canvas/95 sticky bottom-0 flex items-center justify-between gap-2 px-4 py-3">
            <Button
              variant="secondary"
              disabled={open === 0}
              onClick={() => setOpen((value) => Math.max(0, (value ?? 0) - 1))}
            >
              Zurück
            </Button>
            <Button
              variant="secondary"
              disabled={open === pages.length - 1}
              onClick={() => setOpen((value) => Math.min(pages.length - 1, (value ?? 0) + 1))}
            >
              Weiter
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
