'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { PlusIcon } from '@/components/ui/icons';
import { PRIMARY_NAV, SECONDARY_NAV, isActive, type NavItem } from './nav-items';

/**
 * Seitenleiste fuer breite Bildschirme.
 *
 * Zeigt dieselben Ziele wie die mobile Leiste, ergaenzt um die Bereiche, die
 * dort ueber die Einstellungen erreichbar sind. Die Anwendung bleibt eine
 * einzige Codebasis - es wechselt nur die Anordnung, nie die Funktion.
 */
export function Sidebar({ userName, isAdmin }: { userName: string; isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <aside className="border-border bg-surface hidden w-60 shrink-0 flex-col border-r md:flex">
      <div className="border-border flex h-16 items-center border-b px-5">
        <span className="text-lg font-semibold tracking-tight">Doc-Flow</span>
      </div>

      <div className="px-3 pt-3">
        <Link
          href="/dokumente/neu"
          className="bg-accent text-accent-fg flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium active:brightness-90"
        >
          <PlusIcon className="h-5 w-5" />
          Dokument hinzufügen
        </Link>
      </div>

      <nav aria-label="Hauptnavigation" className="flex-1 overflow-y-auto p-3">
        <ul className="flex flex-col gap-0.5">
          {PRIMARY_NAV.map((item) => (
            <SidebarLink key={item.href} item={item} pathname={pathname} />
          ))}
        </ul>

        <p className="text-text-muted px-3 pt-5 pb-2 text-[11px] font-semibold tracking-wider uppercase">
          Verwaltung
        </p>
        <ul className="flex flex-col gap-0.5">
          {SECONDARY_NAV.map((item) => (
            <SidebarLink key={item.href} item={item} pathname={pathname} />
          ))}
        </ul>
      </nav>

      <div className="border-border border-t p-3">
        <Link
          href="/einstellungen"
          className="hover:bg-surface-muted flex flex-col rounded-lg px-3 py-2 text-sm"
        >
          <span className="font-medium">{userName}</span>
          <span className="text-text-muted text-xs">{isAdmin ? 'Systemzugang' : 'Konto'}</span>
        </Link>
      </div>
    </aside>
  );
}

function SidebarLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);

  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
          active ? 'bg-accent/10 text-accent' : 'text-text-muted hover:bg-surface-muted',
        )}
      >
        <item.Icon className="h-5 w-5" />
        {item.label}
      </Link>
    </li>
  );
}
