import type { AnalysisOutput } from '@/lib/ai/analysis-schema';
import type { ChatAnswer } from '@/lib/ai/chat-schema';
import type {
  AiProvider,
  ChatRequest,
  ChatResult,
  ExtractRequest,
  ExtractResult,
} from '@/server/ai/provider';

/**
 * Ein KI-Anbieter, dessen Antwort der Test vorgibt.
 *
 * Nur so lassen sich die Faelle pruefen, auf die es ankommt: eine erfundene
 * Frist, ein Betrag, der nicht im Zitat steht, eine Ablehnung. Mit einem
 * echten Modell waeren diese Faelle weder herstellbar noch reproduzierbar -
 * und jeder Testlauf kostete Geld.
 */
export class FakeAiProvider implements AiProvider {
  readonly kind = 'FAKE' as const;
  readonly name = 'fake';

  calls = 0;
  lastRequest: ExtractRequest<unknown> | null = null;

  /**
   * Der Ablauf eines vorgetaeuschten Gespraechs.
   *
   * `toolPlan` sagt, welche Werkzeuge das Modell in welcher Reihenfolge
   * aufruft - nur so laesst sich pruefen, dass die Quellenpruefung nur
   * gelesene Seiten gelten laesst.
   */
  toolPlan: Array<{ name: string; input: unknown }> = [];
  chatAnswer: ChatAnswer | Error | null = null;
  chatCalls = 0;

  constructor(
    private readonly respond: (call: number) => AnalysisOutput | Error = () => emptyAnalysis(),
    private readonly isAvailable = true,
  ) {}

  available(): boolean {
    return this.isAvailable;
  }

  async extract<T>(request: ExtractRequest<T>): Promise<ExtractResult<T>> {
    this.calls += 1;
    this.lastRequest = request as ExtractRequest<unknown>;

    const answer = this.respond(this.calls);
    if (answer instanceof Error) throw answer;

    return {
      data: answer as T,
      usage: { inputTokens: 1200, outputTokens: 300, costCents: 2 },
    };
  }

  async chat<T>(request: ChatRequest<T>): Promise<ChatResult<T>> {
    this.chatCalls += 1;

    const toolCalls: string[] = [];
    for (const step of this.toolPlan) {
      const tool = request.tools.find((entry) => entry.name === step.name);
      if (!tool) continue;

      toolCalls.push(step.name);
      // Wirklich ausfuehren: Nur so landen die gelesenen Seiten im
      // Zusammenhang, gegen den die Quellenpruefung spaeter prueft.
      await tool.run(step.input);
    }

    if (this.chatAnswer instanceof Error) throw this.chatAnswer;

    return {
      data: (this.chatAnswer ?? {
        facts: [],
        interpretation: null,
        notFound: [],
        answer: 'Keine Antwort hinterlegt.',
      }) as T,
      usage: { inputTokens: 800, outputTokens: 200, costCents: 1 },
      toolCalls,
    };
  }
}

/** Eine leere, gueltige Antwort - Grundlage fuer jeden Testfall. */
export function emptyAnalysis(): AnalysisOutput {
  const field = { value: null, confidence: 0, evidence: null };

  return {
    title: { ...field },
    documentType: { ...field },
    sender: { ...field },
    recipient: { ...field },
    subject: { ...field },
    documentDate: { ...field },
    receivedDate: { ...field },
    person: { personId: null, confidence: 0, uncertain: true, reasoning: '' },
    category: { slug: null, confidence: 0 },
    identifiers: [],
    payments: [],
    deadlines: [],
    tasks: [],
    summary: '',
  };
}
