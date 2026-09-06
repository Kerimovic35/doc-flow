import Link from 'next/link';
import { PageBody, PageHeader } from '@/components/ui/page-header';
import { Chat } from '@/components/ai/chat';
import { requireUser } from '@/server/auth/context';
import { listConversations } from '@/server/services/conversations';
import { getSettings } from '@/server/services/settings';

export const metadata = { title: 'KI-Assistent | Doc-Flow' };
export const dynamic = 'force-dynamic';

const SUGGESTIONS = [
  'Was muss ich diese Woche erledigen?',
  'Welche Zahlungen sind noch offen?',
  'Welche Dokumente habe ich von der Krankenkasse?',
];

export default async function AssistantPage() {
  const actor = await requireUser();
  const [conversations, settings] = await Promise.all([
    listConversations(actor, { scope: 'GLOBAL', limit: 10 }),
    getSettings(actor),
  ]);

  const ready = settings.aiEnabled && settings.anthropicKeyPresent;

  return (
    <>
      <PageHeader title="KI-Assistent" subtitle="Fragen zu deinen Dokumenten" />
      <PageBody>
        <div className="flex flex-col gap-5">
          {!ready && (
            <p className="bg-warning/10 text-warning rounded-xl px-3.5 py-3 text-sm">
              {settings.aiEnabled
                ? 'Es ist kein Schlüssel für die KI hinterlegt. Der Assistent kann noch nicht antworten.'
                : 'Die KI ist in den Einstellungen abgeschaltet.'}{' '}
              <Link href="/einstellungen/ki" className="font-medium underline">
                Einstellungen
              </Link>
            </p>
          )}

          <Chat conversationId={null} initialMessages={[]} suggestions={SUGGESTIONS} />

          {conversations.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-text-muted text-xs font-semibold tracking-wider uppercase">
                Frühere Gespräche
              </h2>
              <ul className="border-border bg-surface divide-border divide-y overflow-hidden rounded-2xl border">
                {conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <Link
                      href={`/ki/${conversation.id}`}
                      className="active:bg-surface-muted flex min-h-14 items-center justify-between gap-3 px-4 py-3"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {conversation.title ?? 'Ohne Titel'}
                        </span>
                        <span className="text-text-muted block text-xs">
                          {formatDate(conversation.updatedAt)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </PageBody>
    </>
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
