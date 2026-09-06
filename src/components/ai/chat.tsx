'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { SparkIcon, WarningIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

/**
 * Der Gespraechsverlauf.
 *
 * Die Darstellung folgt der Regel der Anwendung: Was im Dokument steht, und
 * was die KI daraus macht, sind zwei verschiedene Dinge und sehen auch so
 * aus. Fakten tragen Fussnoten mit Zitat und Seite, die Deutung steht
 * abgesetzt darunter, und was nicht gefunden wurde, wird ausdruecklich
 * genannt.
 */

export interface ChatSource {
  id: string;
  documentId: string;
  documentTitle: string | null;
  page: number;
  quote: string;
  claimIndex: number;
}

export interface ChatMessage {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  sources: ChatSource[];
  interpretation: string | null;
  notFound: string[];
}

export function Chat({
  conversationId,
  documentId,
  initialMessages,
  suggestions = [],
}: {
  conversationId: string | null;
  documentId?: string;
  initialMessages: ChatMessage[];
  suggestions?: string[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState(conversationId);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, pending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    setError(null);
    setPending(true);
    setQuestion('');

    // Die Frage sofort anzeigen: Der Assistent braucht eine Weile, und eine
    // leere Seite waehrend des Wartens wirkt wie ein Fehler.
    setMessages((current) => [
      ...current,
      {
        id: `lokal-${Date.now()}`,
        role: 'USER',
        content: trimmed,
        sources: [],
        interpretation: null,
        notFound: [],
      },
    ]);

    try {
      const response = await fetch('/api/ki/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: trimmed, conversationId: currentId, documentId }),
      });

      const data = (await response.json()) as {
        conversationId?: string;
        message?: ChatMessage;
        error?: string;
      };

      if (!response.ok || !data.message) {
        setError(data.error ?? 'Die Frage konnte nicht beantwortet werden.');
        return;
      }

      setMessages((current) => [...current, data.message!]);

      if (data.conversationId && data.conversationId !== currentId) {
        setCurrentId(data.conversationId);
        // Die Adresse nachziehen, damit das Gespräch später auffindbar ist.
        if (!documentId) {
          window.history.replaceState(null, '', `/ki/${data.conversationId}`);
          router.refresh();
        }
      }
    } catch {
      setError('Keine Verbindung. Bitte erneut versuchen.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 && (
        <div className="flex flex-col gap-3">
          <div className="border-border flex flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-8 text-center">
            <SparkIcon className="text-text-muted h-8 w-8" />
            <p className="text-text-muted text-sm">
              Der Assistent antwortet ausschließlich anhand deiner Dokumente und nennt zu jeder
              Aussage die Fundstelle. Was er nicht findet, sagt er.
            </p>
          </div>

          {suggestions.length > 0 && (
            <ul className="flex flex-col gap-2">
              {suggestions.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => void send(suggestion)}
                    className="border-border bg-surface active:bg-surface-muted w-full rounded-xl border px-4 py-3 text-left text-sm"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-4">
        {messages.map((message) => (
          <li key={message.id}>
            {message.role === 'USER' ? (
              <div className="flex justify-end">
                <p className="bg-accent text-accent-fg max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm">
                  {message.content}
                </p>
              </div>
            ) : (
              <AssistantMessage message={message} />
            )}
          </li>
        ))}
      </ul>

      {pending && (
        <div className="text-text-muted flex items-center gap-2 text-sm">
          <span className="bg-accent h-2 w-2 animate-pulse rounded-full" />
          Sucht in deinen Dokumenten ...
        </div>
      )}

      {error && (
        <p className="bg-negative/10 text-negative rounded-xl px-3.5 py-3 text-sm" role="alert">
          {error}
        </p>
      )}

      <div ref={endRef} />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(question);
        }}
        className="bg-canvas sticky bottom-0 flex items-end gap-2 pt-2 pb-1"
      >
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            // Auf dem Desktop mit Eingabetaste senden, mit Umschalt eine
            // neue Zeile. Auf dem Telefon bleibt die Eingabetaste ein
            // Zeilenumbruch - dort gibt es den Knopf daneben.
            if (event.key === 'Enter' && !event.shiftKey && !('ontouchstart' in window)) {
              event.preventDefault();
              void send(question);
            }
          }}
          rows={2}
          placeholder="Was muss ich diese Woche erledigen?"
          className="flex-1 resize-none"
          disabled={pending}
          aria-label="Frage"
        />
        <Button type="submit" size="lg" disabled={pending || !question.trim()}>
          Fragen
        </Button>
      </form>
    </div>
  );
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="border-border bg-surface rounded-2xl rounded-bl-md border p-4">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {renderWithFootnotes(message.content)}
        </p>
      </div>

      {message.sources.length > 0 && (
        <ol className="flex flex-col gap-2">
          {message.sources.map((source) => (
            <li key={source.id} className="bg-surface-muted rounded-xl px-3 py-2">
              <p className="text-text-muted text-xs">
                <span className="text-accent font-medium">[F{source.claimIndex}]</span>{' '}
                &bdquo;{source.quote}&ldquo;
              </p>
              <p className="text-text-muted mt-1 text-xs">
                {/*
                  Der Verweis fuehrt auf die Seite, nicht nur auf das
                  Dokument. Sonst muesste man die Fundstelle selbst suchen -
                  und genau das nimmt einem die Anwendung ab.
                */}
                <Link
                  href={`/dokumente/${source.documentId}?seite=${source.page}`}
                  className="text-accent font-medium"
                >
                  {source.documentTitle ?? 'Dokument'}
                </Link>
                {` · Seite ${source.page}`}
              </p>
            </li>
          ))}
        </ol>
      )}

      {message.interpretation && (
        <div className="border-warning/40 bg-warning/5 rounded-xl border border-dashed px-3 py-2.5">
          <p className="text-warning flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
            <WarningIcon className="h-3.5 w-3.5" />
            Einordnung, nicht aus dem Dokument
          </p>
          <p className="text-text-muted mt-1 text-sm leading-relaxed">{message.interpretation}</p>
        </div>
      )}

      {message.notFound.length > 0 && (
        <p className="text-text-muted text-xs">
          Nicht gefunden: {message.notFound.join(', ')}
        </p>
      )}
    </div>
  );
}

/**
 * Hebt die Fussnotenverweise im Text hervor.
 *
 * Ohne sie liesse sich nicht erkennen, welcher Satz durch welchen Beleg
 * gedeckt ist - und genau das ist der Unterschied zu einem Chatbot, der
 * einfach etwas behauptet.
 */
function renderWithFootnotes(text: string): React.ReactNode[] {
  const parts = text.split(/(\[F\d+\]|\(nicht belegt\))/g);

  return parts.map((part, index) => {
    if (/^\[F\d+\]$/.test(part)) {
      return (
        <sup key={index} className="text-accent font-semibold">
          {part}
        </sup>
      );
    }

    if (part === '(nicht belegt)') {
      return (
        <span key={index} className={cn('text-negative text-xs')}>
          {' '}
          (nicht belegt){' '}
        </span>
      );
    }

    return <span key={index}>{part}</span>;
  });
}
