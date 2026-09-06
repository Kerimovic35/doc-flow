import Link from 'next/link';
import { PageBody, PageHeader } from '@/components/ui/page-header';
import { ChevronRightIcon } from '@/components/ui/icons';
import { requireUser } from '@/server/auth/context';

export const metadata = { title: 'Einstellungen | Doc-Flow' };

interface Entry {
  href: string;
  title: string;
  description: string;
  adminOnly?: boolean;
}

const ENTRIES: Entry[] = [
  { href: '/einstellungen/konto', title: 'Konto', description: 'Name, Passwort, Abmelden' },
  {
    href: '/einstellungen/personen',
    title: 'Personen',
    description: 'Wessen Post hier verwaltet wird',
  },
  {
    href: '/einstellungen/kategorien',
    title: 'Kategorien',
    description: 'Einordnung der Dokumente',
  },
  {
    href: '/einstellungen/ki',
    title: 'Künstliche Intelligenz',
    description: 'Anbieter, Modell, automatische Analyse',
  },
  {
    href: '/einstellungen/erinnerungen',
    title: 'Erinnerungen',
    description: 'Wie früh vor einer Frist erinnert wird',
  },
  {
    href: '/einstellungen/system',
    title: 'System',
    description: 'Verarbeitung, Backups, Zustand',
    adminOnly: true,
  },
];

export default async function SettingsPage() {
  const user = await requireUser();
  const entries = ENTRIES.filter((entry) => !entry.adminOnly || user.role === 'ADMIN');

  return (
    <>
      <PageHeader title="Einstellungen" subtitle={user.email} />
      <PageBody>
        <ul className="border-border bg-surface divide-border divide-y overflow-hidden rounded-2xl border">
          {entries.map((entry) => (
            <li key={entry.href}>
              <Link
                href={entry.href}
                className="active:bg-surface-muted flex min-h-16 items-center gap-3 px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{entry.title}</span>
                  <span className="text-text-muted block text-sm">{entry.description}</span>
                </span>
                <ChevronRightIcon className="text-text-muted h-5 w-5 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      </PageBody>
    </>
  );
}
