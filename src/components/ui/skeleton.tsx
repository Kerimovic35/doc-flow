import { cn } from '@/lib/cn';

/**
 * Platzhalter waehrend des Ladens.
 *
 * Bewusst in der Form des spaeteren Inhalts: Ein Balken an der Stelle, an
 * der gleich eine Kachel steht, laesst die Seite ruhig aufbauen. Ein
 * zentrierter Ladekreis wuerde dagegen jedes Mal einen Sprung im Layout
 * erzeugen.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('bg-surface-muted animate-pulse rounded-xl', className)}
      aria-hidden="true"
    />
  );
}

/** Ladeansicht fuer eine Liste aus Karten. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Wird geladen">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-20" />
      ))}
    </div>
  );
}

/** Ladeansicht fuer eine Reihe von Kennzahlen. */
export function MetricsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      role="status"
      aria-label="Wird geladen"
    >
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-24" />
      ))}
    </div>
  );
}

/** Kopfbereich als Platzhalter, damit der Titel nicht springt. */
export function HeaderSkeleton() {
  return (
    <header className="bg-canvas/95 border-border pt-safe sticky top-0 z-30 border-b">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3.5 md:px-6 md:py-5">
        <Skeleton className="h-7 w-40" />
      </div>
    </header>
  );
}
