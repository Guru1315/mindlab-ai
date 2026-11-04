import { z } from "zod";
import type { LLMProvider, TokenUsage } from "@/lib/ai/types";
import { jsonSchemaFor } from "@/lib/ai/schema";
import type { Citation, UserSettings } from "@/lib/types";
import { resolveCitations } from "./citations";
import { buildChatSystemPrompt, buildQuestionTurn, historyTurns, UNTRUSTED_CONTENT_RULES, wrapUntrusted, type RetrievedPassage } from "./prompt";
import type { Retriever } from "./retrieval";

export type AnswerEvent =
  | { type: "passages"; citations: Citation[] }
  | { type: "delta"; text: string }
  | { type: "final"; text: string; citations: Citation[]; usage: TokenUsage; model: string; grounded: boolean }
  | { type: "followups"; questions: string[] };

export interface AnswerParams {
  notebookId: string;
  question: string;
  sourceIds: string[];
  history: { role: "user" | "assistant"; content: string }[];
  settings?: Pick<UserSettings, "chat_style" | "response_length" | "custom_instructions" | "chat_model">;
  signal?: AbortSignal;
}

export interface AnswerDeps {
  /** Without a model, chat answers with the best-matching passages (search mode). */
  llm?: LLMProvider;
  retriever: Retriever;
  /** Passages retrieved per question. */
  retrievalLimit?: number;
}

export const NO_SOURCES_MESSAGE =
  "I couldn't find anything in the selected sources to answer this. Select at least one processed source, or add a source that covers this topic.";

export const NO_MATCH_MESSAGE =
  "The selected sources don't appear to contain information about this. Try rephrasing the question, selecting more sources, or adding a source that covers it.";

const followUpSchema = z.object({ questions: z.array(z.string().min(3).max(240)).max(3) });

export const SEARCH_MODE_INTRO =
  "**AI answers are turned off on this server**, so here are the passages from your selected sources that best match your question:";

/** Escapes Markdown so quoted source text renders literally (and "[12]" in a source is never read as a citation). */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]<>#|~])/g, "\\$1");
}

function quoteExcerpt(text: string, max = 480): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const sentence = cut.lastIndexOf(". ");
  return `${sentence > max * 0.6 ? cut.slice(0, sentence + 1) : cut.replace(/\s+\S*$/, "")} …`;
}

/**
 * Search-mode reply: verbatim excerpts of the top passages, each with a real
 * citation to the retrieved chunk. Nothing is generated or paraphrased.
 */
export function buildPassageAnswer(passages: Citation[], count = 4): string {
  const blocks = passages.slice(0, count).map((p) => {
    const page = p.pageStart ? `, p. ${p.pageStart}` : "";
    return `> ${escapeMarkdown(quoteExcerpt(p.excerpt))} [${p.index}]\n>\n> — *${escapeMarkdown(p.sourceTitle)}${page}*`;
  });
  return [SEARCH_MODE_INTRO, ...blocks].join("\n\n");
}

/**
 * RAG question answering: retrieve passages scoped to the notebook's selected
 * sources, stream a grounded answer, then validate its citation markers
 * against the retrieved passages before anything is persisted.
 */
export async function* answerQuestion(params: AnswerParams, deps: AnswerDeps): AsyncGenerator<AnswerEvent> {
  const limit = deps.retrievalLimit ?? 10;
  const passages = await deps.retriever.retrieve({
    notebookId: params.notebookId,
    query: params.question,
    sourceIds: params.sourceIds,
    limit,
    signal: params.signal,
  });

  if (passages.length === 0) {
    // Nothing relevant was retrieved: answer deterministically instead of letting the model guess.
    const text = params.sourceIds.length === 0 ? NO_SOURCES_MESSAGE : NO_MATCH_MESSAGE;
    yield { type: "passages", citations: [] };
    yield { type: "delta", text };
    yield { type: "final", text, citations: [], usage: { inputTokens: 0, outputTokens: 0 }, model: "none", grounded: false };
    return;
  }

  yield { type: "passages", citations: passages };

  if (!deps.llm) {
    const resolved = resolveCitations(buildPassageAnswer(passages), passages);
    yield { type: "delta", text: resolved.text };
    yield { type: "final", text: resolved.text, citations: resolved.citations, usage: { inputTokens: 0, outputTokens: 0 }, model: "none", grounded: true };
    return;
  }

  const retrieved: RetrievedPassage[] = passages.map((p) => ({
    index: p.index,
    chunkId: p.chunkId,
    sourceId: p.sourceId,
    sourceTitle: p.sourceTitle,
    content: p.excerpt,
    pageStart: p.pageStart,
    pageEnd: p.pageEnd,
  }));

  const model = params.settings?.chat_model || deps.llm.defaultModel;
  let raw = "";
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  for await (const event of deps.llm.streamText({
    model,
    system: buildChatSystemPrompt(params.settings),
    messages: [...historyTurns(params.history), { role: "user", content: buildQuestionTurn(params.question, retrieved) }],
    maxOutputTokens: params.settings?.response_length === "long" ? 4096 : 2048,
    signal: params.signal,
  })) {
    if (event.type === "text") {
      raw += event.text;
      yield { type: "delta", text: event.text };
    } else {
      usage = event.usage;
    }
  }

  const resolved = resolveCitations(raw, passages);
  yield { type: "final", text: resolved.text, citations: resolved.citations, usage, model, grounded: resolved.citations.length > 0 };

  if (resolved.citations.length > 0 && !params.signal?.aborted) {
    try {
      yield { type: "followups", questions: await suggestFollowUps(deps.llm, params.question, resolved.text, passages, params.signal) };
    } catch {
      // Follow-ups are optional; never fail the answer because of them.
    }
  }
}

export async function suggestFollowUps(
  llm: LLMProvider,
  question: string,
  answer: string,
  passages: Citation[],
  signal?: AbortSignal,
): Promise<string[]> {
  const context = passages
    .slice(0, 6)
    .map((p) => wrapUntrusted("source_passage", p.excerpt.slice(0, 600), { source: p.sourceTitle }))
    .join("\n");
  const { data } = await llm.generateJson({
    model: llm.fastModel,
    system: `Suggest follow-up questions a curious reader might ask next. Only suggest questions the provided passages could plausibly answer. ${UNTRUSTED_CONTENT_RULES}`,
    messages: [
      {
        role: "user",
        content: `Previous question: ${question}\n\nAnswer given: ${answer.slice(0, 3000)}\n\nPassages:\n${context}\n\nReturn up to 3 short follow-up questions.`,
      },
    ],
    jsonSchema: jsonSchemaFor(followUpSchema),
    parse: (v) => followUpSchema.parse(v),
    maxOutputTokens: 300,
    signal,
  });
  return data.questions;
}
