import type { AnalysisOutput } from '@/lib/ai/analysis-schema';
import type { AiProvider, ExtractRequest, ExtractResult } from '@/server/ai/provider';

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

  constructor(
    private readonly respond: (call: number) => AnalysisOutput | Error,
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
