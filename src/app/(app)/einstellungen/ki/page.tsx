import Link from 'next/link';
import { PageBody, PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/server/auth/context';
import { getSettings } from '@/server/services/settings';
import { AiSettingsForm } from './ai-form';

export const metadata = { title: 'KI | Doc-Flow' };

export default async function AiSettingsPage() {
  const actor = await requireUser();
  const settings = await getSettings(actor);

  return (
    <>
      <PageHeader
        title="Künstliche Intelligenz"
        subtitle="Anbieter, Modell, automatische Analyse"
        action={<Link href="/einstellungen">Zurück</Link>}
      />
      <PageBody>
        <div className="flex flex-col gap-5">
          <p className="text-text-muted text-sm">
            Zur Analyse werden der erkannte Text und auf Wunsch die Seitenbilder an den gewählten
            Anbieter übertragen. Jede erkannte Angabe trägt eine Fundstelle; was sich im Text nicht
            wiederfindet, wird verworfen oder als unbestätigt gekennzeichnet.
          </p>
          <AiSettingsForm settings={settings} />
        </div>
      </PageBody>
    </>
  );
}
