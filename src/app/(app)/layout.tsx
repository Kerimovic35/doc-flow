import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/context';
import { AddDocumentButton, BottomNav } from '@/components/nav/bottom-nav';
import { Sidebar } from '@/components/nav/sidebar';

/**
 * Huelle aller geschuetzten Seiten.
 *
 * Die Anmeldepruefung steht hier und zusaetzlich in jeder Server Action.
 * Diese Schicht verhindert, dass eine Seite ueberhaupt gerendert wird; die
 * Pruefung in den Aktionen verhindert, dass ein direkt abgesetzter Request
 * etwas veraendert. Beides ist noetig - die erste allein waere umgehbar.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="flex min-h-dvh">
      <Sidebar userName={user.name} isAdmin={user.role === 'ADMIN'} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          Unterer Abstand haelt den Inhalt frei von der mobilen
          Navigationsleiste und der Home-Indicator-Zone des iPhones.
        */}
        <main className="flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:pb-0">
          {children}
        </main>
      </div>

      <BottomNav />
      <AddDocumentButton />
    </div>
  );
}
