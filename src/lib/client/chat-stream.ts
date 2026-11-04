import type { Citation } from "@/lib/types";

export type ChatStreamEvent =
  | { type: "start"; conversationId: string; userMessageId: string }
  | { type: "passages"; citations: Citation[] }
  | { type: "delta"; text: string }
  | { type: "final"; text: string; citations: Citation[] }
  | { type: "followups"; questions: string[] }
  | { type: "done"; messageId?: string }
  | { type: "error"; error: string; messageId?: string };

/** Parses a newline-delimited JSON stream into events. */
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as ChatStreamEvent;
        newline = buffer.indexOf("\n");
      }
    }
    const rest = buffer.trim();
    if (rest) yield JSON.parse(rest) as ChatStreamEvent;
  } finally {
    reader.releaseLock();
  }
}
