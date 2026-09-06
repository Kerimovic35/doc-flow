import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import type { ConversationScope } from '@/generated/prisma/enums';
import { chatAnswerSchema, type ChatAnswer } from '@/lib/ai/chat-schema';
import type { SessionUser } from '@/server/auth/session';
import { buildChatSystemPrompt } from '@/server/ai/prompts/chat';
import { AiUnavailableError, type ToolSpec } from '@/server/ai/provider';
import { aiProvider } from '@/server/ai/registry';
import { verifyAnswer, type ReadPage, type VerifiedAnswer } from '@/server/ai/guard/verify-claims';
import { CHAT_TOOLS, DOCUMENT_TOOLS, type ToolContext } from '@/server/ai/tools';
import { db } from '@/server/db';
import { errorMessage, log } from '@/server/log';

/**
 * Der Assistent.
 *
 * Hier laeuft alles zusammen: Werkzeuge, Modell, Quellenpruefung und
 * Speicherung. Der Ablauf ist immer derselbe, und die Reihenfolge ist
 * wesentlich.
 *
 *   1. Frage speichern - auch wenn die Antwort scheitert, soll der Verlauf
 *      zeigen, was gefragt wurde.
 *   2. Modell arbeiten lassen. Dabei wird mitgeschrieben, welche Seiten es
 *      wirklich gelesen hat.
 *   3. Antwort pruefen. Belege auf ungelesene Seiten fallen heraus, ebenso
 *      erfundene Zitate.
 *   4. Nur die geprueften Belege werden als Quellen gespeichert.
 *
 * Was in der Datenbank landet, ist damit immer belegt. Eine Behauptung ohne
 * Quelle kann es in einer gespeicherten Antwort nicht geben.
 */

export interface ConversationSummary {
  id: string;
  scope: ConversationScope;
  documentId: string | null;
  title: string | null;
  updatedAt: Date;
  messageCount: number;
}

export interface MessageSource {
  id: string;
  documentId: string;
  documentTitle: string | null;
  page: number;
  quote: string;
  claimIndex: number;
}

export interface MessageView {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  /** Die geprueften Belege, in der Reihenfolge der Fussnoten. */
  sources: MessageSource[];
  interpretation: string | null;
  notFound: string[];
  createdAt: Date;
}

export async function listConversations(
  actor: SessionUser,
  options: { scope?: ConversationScope; documentId?: string; limit?: number } = {},
): Promise<ConversationSummary[]> {
  const conversations = await db.aiConversation.findMany({
    where: {
      userId: actor.id,
      ...(options.scope ? { scope: options.scope } : {}),
      ...(options.documentId ? { documentId: options.documentId } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: options.limit ?? 20,
    select: {
      id: true,
      scope: true,
      documentId: true,
      title: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });

  return conversations.map(({ _count, ...conversation }) => ({
    ...conversation,
    messageCount: _count.messages,
  }));
}

export async function getConversation(
  actor: SessionUser,
  conversationId: string,
): Promise<{ id: string; title: string | null; documentId: string | null; messages: MessageView[] } | null> {
  const conversation = await db.aiConversation.findFirst({
    where: { id: conversationId, userId: actor.id },
    select: {
      id: true,
      title: true,
      documentId: true,
      messages: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          content: true,
          structured: true,
          createdAt: true,
          sources: {
            orderBy: { claimIndex: 'asc' },
            select: {
              id: true,
              documentId: true,
              page: true,
              quote: true,
              claimIndex: true,
              document: { select: { title: true, sender: true } },
            },
          },
        },
      },
    },
  });

  if (!conversation) return null;

  return {
    id: conversation.id,
    title: conversation.title,
    documentId: conversation.documentId,
    messages: conversation.messages.map((message) => {
      const structured = message.structured as {
        interpretation?: string | null;
        notFound?: string[];
      } | null;

      return {
        id: message.id,
        role: message.role,
        content: message.content,
        interpretation: structured?.interpretation ?? null,
        notFound: structured?.notFound ?? [],
        createdAt: message.createdAt,
        sources: message.sources.map((source) => ({
          id: source.id,
          documentId: source.documentId,
          documentTitle: source.document?.title ?? source.document?.sender ?? null,
          page: source.page,
          quote: source.quote,
          claimIndex: source.claimIndex,
        })),
      };
    }),
  };
}

export type AskResult =
  | { ok: true; conversationId: string; message: MessageView }
  | { ok: false; error: string };

export interface AskInput {
  question: string;
  conversationId?: string | null;
  /** Fuer den Chat zu einem einzelnen Dokument. */
  documentId?: string | null;
}

export async function ask(actor: SessionUser, input: AskInput): Promise<AskResult> {
  const question = input.question.trim();
  if (!question) return { ok: false, error: 'Keine Frage gestellt.' };

  const settings = await db.userSettings.findUnique({
    where: { userId: actor.id },
    select: { aiEnabled: true, aiProvider: true, aiModel: true, aiEffort: true },
  });

  if (settings && !settings.aiEnabled) {
    return {
      ok: false,
      error: 'Die KI ist in den Einstellungen abgeschaltet.',
    };
  }

  // Dokument-Chat: Das Dokument muss dem Benutzer gehoeren.
  let document: { id: string; title: string | null; sender: string | null } | null = null;
  if (input.documentId) {
    document = await db.document.findFirst({
      where: { id: input.documentId, userId: actor.id, deletedAt: null },
      select: { id: true, title: true, sender: true },
    });
    if (!document) return { ok: false, error: 'Dokument nicht gefunden.' };
  }

  const conversation = await findOrCreateConversation(actor, {
    conversationId: input.conversationId ?? null,
    documentId: document?.id ?? null,
    question,
  });

  // Die Frage wird sofort gespeichert - auch eine gescheiterte Antwort soll
  // im Verlauf nachvollziehbar bleiben.
  await db.aiMessage.create({
    data: {
      conversationId: conversation.id,
      userId: actor.id,
      role: 'USER',
      content: question,
    },
  });

  let provider;
  try {
    provider = aiProvider(settings?.aiProvider ?? 'ANTHROPIC');
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }

  if (!provider.available()) {
    return {
      ok: false,
      error: 'Für die KI ist kein Schlüssel hinterlegt. Der Assistent steht deshalb nicht bereit.',
    };
  }

  const readPages: ReadPage[] = [];
  const context: ToolContext = {
    actor,
    readPages,
    ...(document ? { documentId: document.id } : {}),
  };

  // Beim Dokument-Chat stehen alle Seiten von vornherein zur Verfuegung -
  // dort ist die Frage ja bereits auf ein Dokument bezogen.
  if (document) {
    const pages = await db.documentPage.findMany({
      where: { documentId: document.id, userId: actor.id },
      orderBy: { pageNumber: 'asc' },
      select: { pageNumber: true, text: true },
    });

    for (const page of pages) {
      if (page.text) {
        readPages.push({ documentId: document.id, page: page.pageNumber, text: page.text });
      }
    }
  }

  const persons = await db.person.findMany({
    where: { userId: actor.id, active: true },
    select: { id: true, name: true },
    orderBy: { sortOrder: 'asc' },
  });

  const history = await db.aiMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'asc' },
    // Genug Zusammenhang fuer ein Gespraech, ohne den Verlauf unbegrenzt
    // mitzuschleppen.
    take: 12,
    select: { role: true, content: true },
  });

  const tools = buildToolSpecs(document ? DOCUMENT_TOOLS : CHAT_TOOLS, context);

  try {
    const result = await provider.chat<ChatAnswer>({
      system: buildChatSystemPrompt({
        userName: actor.name,
        persons,
        today: new Date().toISOString().slice(0, 10),
        ...(document ? { documentTitle: document.title ?? document.sender ?? 'ohne Titel' } : {}),
      }),
      messages: history.map((message) => ({
        role: message.role === 'USER' ? ('user' as const) : ('assistant' as const),
        content: message.content,
      })),
      tools,
      schema: chatAnswerSchema,
      model: settings?.aiModel ?? 'claude-opus-5',
      effort: settings?.aiEffort ?? 'high',
    });

    // Die Pruefung: Nur Belege auf tatsaechlich gelesene Seiten zaehlen.
    const verified = verifyAnswer(result.data, readPages);

    const message = await saveAnswer({
      actor,
      conversationId: conversation.id,
      verified,
      provider: provider.name,
      model: settings?.aiModel ?? 'claude-opus-5',
      usage: result.usage,
    });

    log.info('chat.answered', {
      conversationId: conversation.id,
      toolCalls: result.toolCalls.length,
      facts: verified.facts.length,
      removed: verified.removed,
      pagesRead: readPages.length,
    });

    return { ok: true, conversationId: conversation.id, message };
  } catch (error) {
    log.error('chat.failed', {
      conversationId: conversation.id,
      error: errorMessage(error),
    });

    return {
      ok: false,
      error:
        'Die Frage konnte nicht beantwortet werden. Deine Dokumente sind davon nicht betroffen — bitte später erneut versuchen.',
    };
  }
}

async function findOrCreateConversation(
  actor: SessionUser,
  options: { conversationId: string | null; documentId: string | null; question: string },
): Promise<{ id: string }> {
  if (options.conversationId) {
    const existing = await db.aiConversation.findFirst({
      where: { id: options.conversationId, userId: actor.id },
      select: { id: true },
    });
    if (existing) return existing;
  }

  return db.aiConversation.create({
    data: {
      userId: actor.id,
      scope: options.documentId ? 'DOCUMENT' : 'GLOBAL',
      documentId: options.documentId,
      // Die erste Frage als Titel - besser als "Neues Gespräch" und ohne
      // einen weiteren Modellaufruf.
      title: options.question.slice(0, 80),
    },
    select: { id: true },
  });
}

async function saveAnswer(input: {
  actor: SessionUser;
  conversationId: string;
  verified: VerifiedAnswer;
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}): Promise<MessageView> {
  const { verified } = input;

  const message = await db.$transaction(async (tx) => {
    const created = await tx.aiMessage.create({
      data: {
        conversationId: input.conversationId,
        userId: input.actor.id,
        role: 'ASSISTANT',
        content: verified.answer,
        structured: {
          interpretation: verified.interpretation,
          notFound: verified.notFound,
          removed: verified.removed,
        } as Prisma.InputJsonValue,
        provider: input.provider,
        model: input.model,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
      },
      select: { id: true, createdAt: true },
    });

    for (const [index, fact] of verified.facts.entries()) {
      const page = await tx.documentPage.findFirst({
        where: { documentId: fact.documentId, pageNumber: fact.page, userId: input.actor.id },
        select: { id: true },
      });

      await tx.aiSource.create({
        data: {
          messageId: created.id,
          userId: input.actor.id,
          documentId: fact.documentId,
          pageId: page?.id ?? null,
          page: fact.page,
          // Das Zitat so, wie es im Text steht - nicht wie das Modell es
          // geschrieben hat.
          quote: fact.excerpt,
          verification: 'VERIFIED',
          claimIndex: index + 1,
        },
      });
    }

    await tx.aiConversation.update({
      where: { id: input.conversationId },
      data: { updatedAt: new Date() },
    });

    return created;
  });

  const sources = await db.aiSource.findMany({
    where: { messageId: message.id },
    orderBy: { claimIndex: 'asc' },
    select: {
      id: true,
      documentId: true,
      page: true,
      quote: true,
      claimIndex: true,
      document: { select: { title: true, sender: true } },
    },
  });

  return {
    id: message.id,
    role: 'ASSISTANT',
    content: verified.answer,
    interpretation: verified.interpretation,
    notFound: verified.notFound,
    createdAt: message.createdAt,
    sources: sources.map((source) => ({
      id: source.id,
      documentId: source.documentId,
      documentTitle: source.document?.title ?? source.document?.sender ?? null,
      page: source.page,
      quote: source.quote,
      claimIndex: source.claimIndex,
    })),
  };
}

/**
 * Uebersetzt die Werkzeuge in die Form, die der Anbieter erwartet.
 *
 * Das JSON-Schema entsteht aus dem Zod-Schema, damit es nur eine Quelle der
 * Wahrheit gibt: Eine von Hand gepflegte zweite Fassung liefe frueher oder
 * spaeter auseinander.
 */
function buildToolSpecs(
  tools: Array<{
    name: string;
    description: string;
    schema: { parse: (value: unknown) => unknown };
    run: (input: never, context: ToolContext) => Promise<string>;
  }>,
  context: ToolContext,
): ToolSpec[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: toJsonSchema(tool.schema),
    run: async (input: unknown) => {
      // Die Eingabe des Modells wird geprueft, bevor sie in eine Abfrage
      // geht - ein Werkzeug ist ein vom Modell gesteuerter Weg in die
      // Datenbank.
      const parsed = tool.schema.parse(input);
      return tool.run(parsed as never, context);
    },
  }));
}

function toJsonSchema(schema: unknown): Record<string, unknown> {
  // Zod 4 bringt die Umwandlung mit. `io: 'input'` beschreibt, was das
  // Modell schicken darf - nicht, was nach der Pruefung herauskommt.
  return z.toJSONSchema(schema as never, { io: 'input' }) as Record<string, unknown>;
}

/** Loescht ein Gespraech samt Nachrichten und Quellen. */
export async function deleteConversation(
  actor: SessionUser,
  conversationId: string,
): Promise<{ ok: boolean }> {
  const deleted = await db.aiConversation.deleteMany({
    where: { id: conversationId, userId: actor.id },
  });
  return { ok: deleted.count > 0 };
}

export { AiUnavailableError };
