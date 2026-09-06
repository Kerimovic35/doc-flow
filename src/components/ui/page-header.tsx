/**
 * Kopfbereich einer Seite.
 *
 * Auf dem Smartphone klebt der Titel oben fest, damit beim Scrollen durch
 * lange Listen jederzeit erkennbar bleibt, wo man sich befindet.
 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="bg-canvas/95 border-border pt-safe sticky top-0 z-30 border-b backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3.5 md:px-6 md:py-5">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
          {subtitle && <p className="text-text-muted truncate text-sm">{subtitle}</p>}
        </div>

        {/*
          Erzwingt die Mindest-Trefferflaeche fuer alle Links im Aktionsbereich.
          Zentral hier statt an jeder einzelnen Seite: Ein blosser Textlink
          waere nur so hoch wie seine Zeile - auf dem iPhone rund 20 Pixel und
          damit deutlich unter den empfohlenen 44 Punkten.
        */}
        {action && (
          <div className="shrink-0 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center">
            {action}
          </div>
        )}
      </div>
    </header>
  );
}

/** Einheitlicher Inhaltsbereich unterhalb des Kopfbereichs. */
export function PageBody({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-5xl px-4 py-4 md:px-6 md:py-6">{children}</div>;
}
