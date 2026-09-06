import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/ui/page-header';
import { Chat } from '@/components/ai/chat';
import { requireUser } from '@/server/auth/context';
import { getConversation } from '@/server/services/conversations';

export const dynamic = 'force-dynamic';

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const actor = await requireUser();
  const { conversationId } = await params;

  const conversation = await getConversation(actor, conversationId);
  if (!conversation) notFound();

  return (
    <>
      <PageHeader
        title={conversation.title ?? 'Gespräch'}
        subtitle="KI-Assistent"
        action={<Link href="/ki">Neues Gespräch</Link>}
      />
      <PageBody>
        <Chat
          conversationId={conversation.id}
          initialMessages={conversation.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            sources: message.sources,
            interpretation: message.interpretation,
            notFound: message.notFound,
          }))}
        />
      </PageBody>
    </>
  );
}
