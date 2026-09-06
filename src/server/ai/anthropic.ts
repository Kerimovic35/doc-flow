import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { runChat } from './anthropic-chat';
import {
  AiRefusalError,
  AiSchemaError,
  AiUnavailableError,
  type AiProvider,
  type ChatRequest,
  type ChatResult,
  type ContentPart,
  type ExtractRequest,
  type ExtractResult,
} from './provider';

/**
 * Anbindung an Claude.
 *
 * Zwei Dinge sind hier wichtiger als der Rest:
 *
 * 1. Strukturierte Ausgabe. Das Zod-Schema wird als Ausgabeformat
 *    mitgegeben, damit die Antwort nicht geparst, sondern garantiert
 *    passend geliefert wird. Ein Modell, das freien Text zurueckgibt, waere
 *    fuer eine Belegpruefung wertlos.
 *
 * 2. Ablehnungen. `stop_reason: 'refusal'` kommt als HTTP 200 zurueck. Wer
 *    das nicht prueft, liest eine leere Antwort als "nichts gefunden" -
 *    und das Dokument gilt als analysiert, obwohl es nie angesehen wurde.
 */

/** Preise je Million Token, fuer die Kostenanzeige. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
};

export class AnthropicProvider implements AiProvider {
  readonly kind = 'ANTHROPIC' as const;
  readonly name = 'anthropic';

  private client: Anthropic | null = null;

  available(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  private getClient(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new AiUnavailableError(
        'Kein Schlüssel für die KI hinterlegt. ANTHROPIC_API_KEY in der Umgebung setzen.',
      );
    }

    // Erst beim ersten Bedarf, damit ein Start ohne Schluessel moeglich
    // bleibt - die Anwendung ist auch ohne KI benutzbar.
    this.client ??= new Anthropic({ apiKey, maxRetries: 2 });
    return this.client;
  }

  async extract<T>(request: ExtractRequest<T>): Promise<ExtractResult<T>> {
    const client = this.getClient();

    const response = await client.messages.parse({
      model: request.model,
      max_tokens: 16000,
      system: request.system,
      messages: [{ role: 'user', content: toContentBlocks(request.content) }],
      // Nachdenken lassen: Fristen und Betraege aus einem Behoerdenbrief
      // herauszulesen ist keine Fleissaufgabe.
      thinking: { type: 'adaptive' },
      output_config: {
        format: zodOutputFormat(request.schema),
        ...(request.effort ? { effort: request.effort as 'low' | 'medium' | 'high' } : {}),
      },
    });

    if (response.stop_reason === 'refusal') {
      // Die Begruendung liegt in `stop_details`, das diese Fassung des SDK
      // noch nicht typisiert. Sie ist eine Zusatzinformation fuer das
      // Protokoll, keine Bedingung - deshalb ein enger Zugriff statt eines
      // Wartens auf die naechste Version.
      const details = (response as { stop_details?: { category?: string | null } }).stop_details;

      throw new AiRefusalError(
        'Die KI hat die Bearbeitung dieses Dokuments abgelehnt. Das Dokument bleibt unverändert erhalten.',
        details?.category ?? null,
      );
    }

    if (response.stop_reason === 'max_tokens') {
      throw new AiSchemaError(
        'Die Antwort der KI wurde abgeschnitten. Das Dokument ist vermutlich zu lang.',
      );
    }

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new AiSchemaError('Die Antwort der KI passte nicht zum erwarteten Aufbau.');
    }

    return {
      data: parsed as T,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        costCents: estimateCents(
          request.model,
          response.usage.input_tokens,
          response.usage.output_tokens,
        ),
      },
    };
  }

  chat<T>(request: ChatRequest<T>): Promise<ChatResult<T>> {
    return runChat(this.getClient(), request, estimateCents);
  }
}

function toContentBlocks(parts: ContentPart[]) {
  return parts.map((part) =>
    part.type === 'text'
      ? ({ type: 'text', text: part.text } as const)
      : ({
          type: 'image',
          source: { type: 'base64', media_type: part.mediaType, data: part.data },
        } as const),
  );
}

function estimateCents(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = PRICES[model];
  if (!price) return null;

  const dollars = (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
  return Math.round(dollars * 100);
}
