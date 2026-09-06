import Link from 'next/link';
import { PageBody, PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/server/auth/context';
import { getSettings } from '@/server/services/settings';
import { ReminderForm } from './reminder-form';

export const metadata = { title: 'Erinnerungen | Doc-Flow' };

export default async function ReminderSettingsPage() {
  const actor = await requireUser();
  const settings = await getSettings(actor);

  return (
    <>
      <PageHeader
        title="Erinnerungen"
        subtitle="Wie früh vor einer Frist erinnert wird"
        action={<Link href="/einstellungen">Zurück</Link>}
      />
      <PageBody>
        <div className="flex flex-col gap-5">
          <p className="text-text-muted text-sm">
            Erinnerungen erscheinen in der Anwendung auf dem Startbildschirm. Benachrichtigungen per
            E-Mail oder Push gibt es noch nicht.
          </p>
          <ReminderForm reminderDays={settings.reminderDays} />
        </div>
      </PageBody>
    </>
  );
}
