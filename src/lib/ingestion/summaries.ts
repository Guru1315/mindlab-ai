import { z } from "zod";
import type { LLMProvider } from "@/lib/ai/types";
import { jsonSchemaFor } from "@/lib/ai/schema";
import { UNTRUSTED_CONTENT_RULES, wrapUntrusted } from "@/lib/rag/prompt";

const SUMMARY_INPUT_CHARS = 60_000;

/** Short "source guide" summary shown in the source list and viewer. */
export async function summarizeSource(llm: LLMProvider, title: string, text: string, signal?: AbortSignal): Promise<string> {
  const excerpt = text.length > SUMMARY_INPUT_CHARS ? `${text.slice(0, SUMMARY_INPUT_CHARS)}\n[…truncated]` : text;
  const { text: summary } = await llm.generateText({
    model: llm.fastModel,
    system: `You write concise, factual summaries of documents. ${UNTRUSTED_CONTENT_RULES}`,
    messages: [
      {
        role: "user",
        content: `Summarize the document below in 2-4 sentences, then list up to 5 key topics as a single line starting with "Key topics:". Use only information in the document.\n\n${wrapUntrusted("document", excerpt, { title })}`,
      },
    ],
    maxOutputTokens: 400,
    signal,
  });
  return summary.trim().slice(0, 2000);
}

export const notebookOverviewSchema = z.object({
  summary: z.string().min(1).max(2000),
  suggestedQuestions: z.array(z.string().min(3).max(300)).min(1).max(5),
});

export type NotebookOverview = z.infer<typeof notebookOverviewSchema>;

/** Notebook-level overview plus suggested starter questions, built from source summaries. */
export async function generateNotebookOverview(
  llm: LLMProvider,
  sources: { title: string; summary: string | null; excerpt: string }[],
  signal?: AbortSignal,
): Promise<NotebookOverview> {
  const material = sources
    .map((s) => wrapUntrusted("source", s.summary ? `${s.summary}\n\nExcerpt: ${s.excerpt}` : s.excerpt, { title: s.title }))
    .join("\n\n");
  const { data } = await llm.generateJson({
    model: llm.fastModel,
    system: `You help researchers orient themselves in a collection of documents. ${UNTRUSTED_CONTENT_RULES}`,
    messages: [
      {
        role: "user",
        content: `Write a 2-3 sentence overview of what this notebook's sources cover together, and 3 specific, interesting questions a reader could ask that the sources can answer.\n\n${material}`,
      },
    ],
    jsonSchema: jsonSchemaFor(notebookOverviewSchema),
    parse: (v) => notebookOverviewSchema.parse(v),
    maxOutputTokens: 800,
    signal,
  });
  return data;
}
