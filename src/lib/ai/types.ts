/**
 * Provider-neutral AI interfaces. Business logic depends only on these, so the
 * LLM, embedding and speech providers can each be swapped independently.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateTextOptions {
  system?: string;
  messages: ChatTurn[];
  /** Overrides the provider's default model. */
  model?: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface GenerateTextResult {
  text: string;
  usage: TokenUsage;
  model: string;
}

export type TextStreamEvent = { type: "text"; text: string } | { type: "usage"; usage: TokenUsage };

export interface GenerateJsonOptions<T> extends GenerateTextOptions {
  /** JSON Schema describing the expected output. */
  jsonSchema: Record<string, unknown>;
  /** Validates the parsed JSON (e.g. a zod `parse`). Throwing triggers one retry. */
  parse: (value: unknown) => T;
}

export interface LLMProvider {
  readonly name: string;
  readonly defaultModel: string;
  readonly fastModel: string;
  generateText(options: GenerateTextOptions): Promise<GenerateTextResult>;
  streamText(options: GenerateTextOptions): AsyncIterable<TextStreamEvent>;
  generateJson<T>(options: GenerateJsonOptions<T>): Promise<{ data: T; usage: TokenUsage; model: string }>;
}

export interface EmbeddingInput {
  title?: string;
  text: string;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embedDocuments(inputs: EmbeddingInput[], signal?: AbortSignal): Promise<number[][]>;
  embedQuery(text: string, signal?: AbortSignal): Promise<number[]>;
}

export interface DialogueTurn {
  speaker: string;
  text: string;
}

export interface SpeechResult {
  /** 16-bit signed little-endian mono PCM samples. */
  pcm: Int16Array;
  sampleRate: number;
}

export interface SpeechProvider {
  readonly name: string;
  readonly model: string;
  readonly voices: readonly string[];
  /** Synthesizes up to two speakers in a single request. */
  synthesize(turns: DialogueTurn[], voiceBySpeaker: Record<string, string>, signal?: AbortSignal): Promise<SpeechResult>;
}

export class AIConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIConfigurationError";
  }
}

export class AIResponseError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AIResponseError";
  }
}
