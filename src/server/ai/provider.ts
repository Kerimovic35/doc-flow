import type { z } from 'zod';

/**
 * Die KI hinter einer schmalen Schnittstelle.
 *
 * Der Rest der Anwendung kennt keinen Anbieter, kein Modell und keine
 * Bibliothek - nur `extract` und `chat`. Ein Wechsel bleibt damit auf diese
 * Schicht beschraenkt, und die Fachlogik laesst sich mit einem erfundenen
 * Anbieter testen, ohne einen Schluessel zu brauchen oder Geld auszugeben.
 */

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/webp' | 'image/png' | 'image/jpeg'; data: string };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Geschaetzte Kosten in Cent, wenn der Anbieter Preise kennt. */
  costCents: number | null;
}

export interface ExtractRequest<T> {
  system: string;
  content: ContentPart[];
  schema: z.ZodType<T>;
  model: string;
  /** Gruendlichkeit: low, medium, high. */
  effort?: string;
}

export interface ExtractResult<T> {
  data: T;
  usage: Usage;
}

/** Ein Werkzeug, das das Modell aufrufen darf. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON-Schema der Eingabe. */
  inputSchema: Record<string, unknown>;
  run(input: unknown): Promise<string>;
}

export interface ChatRequest<T> {
  system: string;
  /** Der bisherige Verlauf, aelteste Nachricht zuerst. */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools: ToolSpec[];
  /** Aufbau der erwarteten Endantwort. */
  schema: z.ZodType<T>;
  model: string;
  effort?: string;
  /** Hoechstzahl der Werkzeugrunden, bevor abgebrochen wird. */
  maxRounds?: number;
}

export interface ChatResult<T> {
  data: T;
  usage: Usage;
  /** Welche Werkzeuge in welcher Reihenfolge liefen - fuer das Protokoll. */
  toolCalls: string[];
}

export interface AiProvider {
  readonly kind: 'ANTHROPIC' | 'OLLAMA' | 'FAKE';
  readonly name: string;
  /** Ist ein Schluessel hinterlegt und der Anbieter erreichbar? */
  available(): boolean;
  extract<T>(request: ExtractRequest<T>): Promise<ExtractResult<T>>;
  /** Gespraech mit Werkzeugen. Das Ergebnis folgt dem uebergebenen Schema. */
  chat<T>(request: ChatRequest<T>): Promise<ChatResult<T>>;
}

/**
 * Die KI hat die Bearbeitung abgelehnt.
 *
 * Eigener Fehlertyp, weil er anders zu behandeln ist als ein Netzfehler: Ein
 * erneuter Versuch aendert nichts, und der Benutzer soll erfahren, dass sein
 * Dokument nicht verarbeitet wurde - nicht, dass "etwas schiefging".
 */
export class AiRefusalError extends Error {
  constructor(
    message: string,
    readonly category: string | null = null,
  ) {
    super(message);
    this.name = 'AiRefusalError';
  }
}

/** Kein Schluessel, kein Anbieter, keine Analyse. */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

/** Die Antwort passte nicht zum Schema. */
export class AiSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiSchemaError';
  }
}
