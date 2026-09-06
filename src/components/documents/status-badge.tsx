import type { ProcessingStatus, ReviewState } from '@/generated/prisma/enums';
import { cn } from '@/lib/cn';

/**
 * Der Verarbeitungsstand in einem Wort.
 *
 * Zwei Zustaende, nicht einer: Ein Dokument kann fertig verarbeitet sein UND
 * trotzdem Prüfung brauchen. Waeren beide in einem Feld, muesste sich einer
 * dem anderen unterordnen - und die Prüfung ginge unter.
 */
export function statusLabel(
  status: ProcessingStatus,
  step: string | null,
  done: number,
  total: number,
): string {
  switch (status) {
    case 'UPLOADED':
      return 'Wird hochgeladen';
    case 'PREPARING':
      return step ?? 'Seiten werden vorbereitet';
    case 'OCR':
      return total > 0 ? `Texterkennung (${done}/${total})` : 'Texterkennung läuft';
    case 'ANALYZING':
      return 'Analyse läuft';
    case 'DONE':
      return 'Fertig';
    case 'FAILED':
      return 'Fehler';
  }
}

export function StatusBadge({
  status,
  reviewState,
  step,
  done = 0,
  total = 0,
}: {
  status: ProcessingStatus;
  reviewState?: ReviewState;
  step?: string | null;
  done?: number;
  total?: number;
}) {
  // Prüfung schlaegt "Fertig": Wer die Liste ueberfliegt, soll sehen, wo noch
  // etwas von ihm erwartet wird.
  if (status === 'DONE' && reviewState === 'NEEDED') {
    return <Badge tone="warning">Prüfung nötig</Badge>;
  }

  if (status === 'DONE') return null;

  const tone = status === 'FAILED' ? 'negative' : 'neutral';
  return <Badge tone={tone}>{statusLabel(status, step ?? null, done, total)}</Badge>;
}

function Badge({
  tone,
  children,
}: {
  tone: 'neutral' | 'warning' | 'negative';
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        tone === 'neutral' && 'bg-surface-muted text-text-muted',
        tone === 'warning' && 'bg-warning/15 text-warning',
        tone === 'negative' && 'bg-negative/15 text-negative',
      )}
    >
      {children}
    </span>
  );
}
