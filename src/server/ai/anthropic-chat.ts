import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  AiRefusalError,
  AiSchemaError,
  type ChatRequest,
  type ChatResult,
  type Usage,
} from './provider';

/**
 * Die Werkzeugschleife.
 *
 * Von Hand statt mit dem Tool-Runner des SDK, aus einem Grund: Die letzte
 * Antwort muss dem Schema folgen (Fakten mit Belegen), waehrend die Runden
 * davor Werkzeuge aufrufen. Der Ablauf ist deshalb zweigeteilt - erst
 * suchen und lesen lassen, dann in einem letzten Aufruf ohne Werkzeuge die
 * strukturierte Antwort verlangen.
 *
 * Das ist auch inhaltlich richtig: Das Modell kann keine Antwort mit Belegen
 * formulieren, solange es noch nicht gelesen hat.
 */

const DEFAULT_MAX_ROUNDS = 6;

export async function runChat<T>(
  client: Anthropic,
  request: ChatRequest<T>,
  estimateCents: (model: string, input: number, output: number) => number | null,
): Promise<ChatResult<T>> {
  const tools = request.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
  }));

  const messages: Anthropic.MessageParam[] = request.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  const usage: Usage = { inputTokens: 0, outputTokens: 0, costCents: 0 };
  const toolCalls: string[] = [];
  const maxRounds = request.maxRounds ?? DEFAULT_MAX_ROUNDS;

  for (let round = 0; round < maxRounds; round += 1) {
    const response = await client.messages.create({
      model: request.model,
      max_tokens: 8000,
      system: request.system,
      messages,
      tools,
      thinking: { type: 'adaptive' },
      ...(request.effort
        ? { output_config: { effort: request.effort as 'low' | 'medium' | 'high' } }
        : {}),
    });

    add(usage, response.usage, request.model, estimateCents);

    if (response.stop_reason === 'refusal') {
      throw new AiRefusalError('Die KI hat die Beantwortung abgelehnt.');
    }

    if (response.stop_reason !== 'tool_use') break;

    // Die Antwort mit den Werkzeugaufrufen gehoert in den Verlauf, sonst
    // fehlt dem Modell der Zusammenhang zu seinen eigenen Ergebnissen.
    messages.push({ role: 'assistant', content: response.content });

    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      const tool = request.tools.find((entry) => entry.name === block.name);
      toolCalls.push(block.name);

      if (!tool) {
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: 'Unbekanntes Werkzeug.',
          is_error: true,
        });
        continue;
      }

      try {
        const output = await tool.run(block.input);
        results.push({ type: 'tool_result', tool_use_id: block.id, content: output });
      } catch (error) {
        // Ein gescheitertes Werkzeug beendet das Gespraech nicht - das
        // Modell soll die Gelegenheit haben, es anders zu versuchen.
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Fehler: ${error instanceof Error ? error.message : 'unbekannt'}`,
          is_error: true,
        });
      }
    }

    // Alle Ergebnisse in EINER Nachricht - getrennt gesendet gewöhnte sich
    // das Modell ab, mehrere Werkzeuge gleichzeitig aufzurufen.
    messages.push({ role: 'user', content: results });
  }

  // Letzter Aufruf ohne Werkzeuge: jetzt die Antwort im vorgegebenen Aufbau.
  messages.push({
    role: 'user',
    content:
      'Fasse deine Antwort jetzt zusammen. Belege jede Tatsachenbehauptung mit Dokument, Seite und wörtlichem Zitat aus den Seiten, die du gelesen hast.',
  });

  const final = await client.messages.parse({
    model: request.model,
    max_tokens: 8000,
    system: request.system,
    messages,
    thinking: { type: 'adaptive' },
    output_config: {
      format: zodOutputFormat(request.schema),
      ...(request.effort ? { effort: request.effort as 'low' | 'medium' | 'high' } : {}),
    },
  });

  add(usage, final.usage, request.model, estimateCents);

  if (final.stop_reason === 'refusal') {
    throw new AiRefusalError('Die KI hat die Beantwortung abgelehnt.');
  }

  if (!final.parsed_output) {
    throw new AiSchemaError('Die Antwort der KI passte nicht zum erwarteten Aufbau.');
  }

  return { data: final.parsed_output as T, usage, toolCalls };
}

function add(
  usage: Usage,
  response: { input_tokens: number; output_tokens: number },
  model: string,
  estimateCents: (model: string, input: number, output: number) => number | null,
): void {
  usage.inputTokens += response.input_tokens;
  usage.outputTokens += response.output_tokens;

  const cents = estimateCents(model, response.input_tokens, response.output_tokens);
  if (cents !== null) usage.costCents = (usage.costCents ?? 0) + cents;
}
