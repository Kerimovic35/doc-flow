'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { CameraIcon } from '@/components/ui/icons';
import { PRIMARY_NAV, isActive } from './nav-items';

/**
 * Mobile Hauptnavigation am unteren Bildschirmrand.
 *
 * Unten statt oben, weil der Daumen beim einhaendigen Halten dort hinreicht -
 * die obere Bildschirmhaelfte eines heutigen iPhones ist es nicht.
 *
 * Ab dem Desktop-Umbruch ausgeblendet; dort uebernimmt die Seitenleiste.
 * Die Umschaltung erfolgt allein ueber CSS, damit kein Unterschied zwischen
 * Server- und Browser-Darstellung entstehen kann.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      // Eigenes Label, weil die Seitenleiste dieselbe Rolle traegt: Zwei
      // gleich benannte Navigationsbereiche waeren mit einem Screenreader
      // nicht auseinanderzuhalten.
      aria-label="Hauptnavigation (mobil)"
      className={cn(
        'bg-surface/95 border-border fixed inset-x-0 bottom-0 z-40 border-t',
        'pb-safe backdrop-blur-md md:hidden',
      )}
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-around">
        {PRIMARY_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2',
                  active ? 'text-accent' : 'text-text-muted',
                )}
              >
                <item.Icon className="h-6 w-6" />
                <span className="text-[11px] leading-none font-medium">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Schwebende Schaltflaeche fuer den haeufigsten Vorgang: einen Brief
 * erfassen. Sitzt oberhalb der Navigationsleiste in Daumenreichweite - vom
 * Aufschlagen des Briefumschlags bis zur ersten Aufnahme soll ein einziges
 * Antippen liegen.
 */
export function AddDocumentButton() {
  const pathname = usePathname();

  // Auf der Erfassungsseite selbst waere die Schaltflaeche sinnlos.
  if (pathname.startsWith('/dokumente/neu')) return null;

  return (
    <Link
      href="/dokumente/neu"
      className={cn(
        'bg-accent text-accent-fg fixed right-4 z-40 flex h-14 w-14 items-center justify-center',
        'rounded-full shadow-lg active:brightness-90 md:hidden',
        // Abstand zur Navigationsleiste plus Home-Indicator-Zone.
        'bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]',
      )}
      aria-label="Dokument hinzufügen"
    >
      <CameraIcon className="h-7 w-7" />
    </Link>
  );
}
