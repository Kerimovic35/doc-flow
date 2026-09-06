'use client';

/**
 * Auffangnetz fuer unerwartete Fehler in den geschuetzten Seiten.
 *
 * Zeigt bewusst keine technische Meldung: Sie waere fuer den Benutzer
 * wertlos und koennte Interna preisgeben. Die Einzelheiten stehen im
 * Serverprotokoll.
 */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-4 px-4 py-16">
      <h1 className="text-xl font-semibold">Da ist etwas schiefgelaufen</h1>
      <p className="text-text-muted text-sm">
        Die Seite konnte nicht geladen werden. Deine Dokumente sind davon nicht betroffen.
      </p>
      <button
        type="button"
        onClick={reset}
        className="bg-accent text-accent-fg inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-medium"
      >
        Erneut versuchen
      </button>
    </div>
  );
}
