import type {
  DialogueTurn,
  EmbeddingInput,
  EmbeddingProvider,
  GenerateJsonOptions,
  GenerateTextOptions,
  LLMProvider,
  SpeechProvider,
  TextStreamEvent,
} from "@/lib/ai/types";

/**
 * Test doubles for the provider interfaces. They record every call so tests
 * can assert on prompts, and return scripted outputs.
 */
export class FakeLLM implements LLMProvider {
  readonly name = "fake";
  readonly defaultModel = "fake-chat";
  readonly fastModel = "fake-fast";
  calls: (GenerateTextOptions & { kind: "text" | "stream" | "json" })[] = [];

  constructor(
    private readonly script: {
      text?: (o: GenerateTextOptions) => string;
      json?: (o: GenerateJsonOptions<unknown>) => unknown;
    } = {},
  ) {}

  async generateText(options: GenerateTextOptions) {
    this.calls.push({ ...options, kind: "text" });
    return { text: this.script.text?.(options) ?? "fake text", usage: { inputTokens: 10, outputTokens: 5 }, model: options.model ?? this.defaultModel };
  }

  async *streamText(options: GenerateTextOptions): AsyncIterable<TextStreamEvent> {
    this.calls.push({ ...options, kind: "stream" });
    const text = this.script.text?.(options) ?? "fake text";
    for (const piece of text.match(/[\s\S]{1,7}/g) ?? []) yield { type: "text", text: piece };
    yield { type: "usage", usage: { inputTokens: 100, outputTokens: 20 } };
  }

  async generateJson<T>(options: GenerateJsonOptions<T>) {
    this.calls.push({ ...options, kind: "json" });
    const raw = this.script.json?.(options as GenerateJsonOptions<unknown>);
    return { data: options.parse(raw), usage: { inputTokens: 50, outputTokens: 30 }, model: options.model ?? this.defaultModel };
  }
}

/** Deterministic bag-of-words embeddings so similar texts get similar vectors. */
export class FakeEmbeddings implements EmbeddingProvider {
  readonly name = "fake";
  readonly model = "fake-embed";
  readonly dimensions = 768;
  documentCalls: EmbeddingInput[][] = [];

  private vector(text: string): number[] {
    const v = new Array(this.dimensions).fill(0);
    for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
      let h = 0;
      for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % this.dimensions;
      v[h] += 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }

  async embedDocuments(inputs: EmbeddingInput[]) {
    this.documentCalls.push(inputs);
    return inputs.map((i) => this.vector(i.text));
  }

  async embedQuery(text: string) {
    return this.vector(text);
  }
}

export class FakeSpeech implements SpeechProvider {
  readonly name = "fake";
  readonly model = "fake-tts";
  readonly voices = ["Kore", "Puck"] as const;
  calls: { turns: DialogueTurn[]; voices: Record<string, string> }[] = [];

  async synthesize(turns: DialogueTurn[], voiceBySpeaker: Record<string, string>) {
    this.calls.push({ turns, voices: voiceBySpeaker });
    // 0.1 s of a 440 Hz tone per turn at 24 kHz.
    const samples = 2400 * turns.length;
    const pcm = new Int16Array(samples);
    for (let i = 0; i < samples; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 24000) * 8000);
    return { pcm, sampleRate: 24000 };
  }
}
