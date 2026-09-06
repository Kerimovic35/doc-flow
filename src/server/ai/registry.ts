import { AnthropicProvider } from './anthropic';
import { AiUnavailableError, type AiProvider } from './provider';

/**
 * Auswahl des KI-Anbieters.
 *
 * Eine Stelle, an der entschieden wird, wer die Analyse macht. Die
 * Fachlogik fragt nie nach dem Anbieter - sie bekommt einen und benutzt ihn.
 * In Tests wird hier ein erfundener Anbieter eingesetzt.
 */

let override: AiProvider | null = null;
const anthropic = new AnthropicProvider();

export function aiProvider(kind: 'ANTHROPIC' | 'OLLAMA' = 'ANTHROPIC'): AiProvider {
  if (override) return override;

  if (kind === 'OLLAMA') {
    // Der lokale Anbieter kommt in einer spaeteren Ausbaustufe. Bis dahin
    // eine klare Ansage statt eines stillen Rueckfalls auf die Cloud - wer
    // "lokal" einstellt, will nicht, dass seine Post trotzdem hinausgeht.
    throw new AiUnavailableError(
      'Der lokale KI-Anbieter ist noch nicht eingerichtet. Bitte in den Einstellungen Anthropic wählen.',
    );
  }

  return anthropic;
}

/** Nur fuer Tests. */
export function setAiProvider(provider: AiProvider | null): void {
  override = provider;
}
