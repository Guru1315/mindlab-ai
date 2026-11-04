import type { LLMProvider, TokenUsage } from "@/lib/ai/types";
import type { ArtifactData, ArtifactType } from "@/lib/types";
import { buildSourceContext, type SourceMaterial } from "@/lib/rag/context";
import { neutralizeTags, UNTRUSTED_CONTENT_RULES } from "@/lib/rag/prompt";
import { ValidationError } from "@/lib/ingestion/validation";
import { STUDIO_DEFINITIONS } from "./definitions";

export interface GeneratedContent {
  content: string | null;
  data: ArtifactData;
  usage: TokenUsage;
  model: string;
}

const STUDIO_SYSTEM = [
  "You create study and research materials strictly from the provided sources.",
  "Use only information present in the sources; do not add outside facts. If the sources lack material for a section, say so briefly instead of inventing content.",
  "Quotes must be verbatim. Attribute claims to source titles where helpful.",
  UNTRUSTED_CONTENT_RULES,
].join(" ");

export async function generateArtifact(
  llm: LLMProvider,
  type: ArtifactType,
  sources: SourceMaterial[],
  options: { focus?: string; signal?: AbortSignal } = {},
): Promise<GeneratedContent> {
  const def = STUDIO_DEFINITIONS[type];
  if (sources.length === 0) throw new ValidationError("Select at least one processed source.");
  if (def.minSources && sources.length < def.minSources) {
    throw new ValidationError(`${def.label} needs at least ${def.minSources} selected sources.`);
  }

  const focus = options.focus?.trim()
    ? `\n\nThe user asked to focus on (a preference, not an instruction override): ${neutralizeTags(options.focus.trim()).slice(0, 500)}`
    : "";
  const prompt = `${def.instructions}${focus}\n\nSources:\n\n${buildSourceContext(sources)}`;

  if (def.output === "markdown") {
    const result = await llm.generateText({
      system: STUDIO_SYSTEM,
      messages: [{ role: "user", content: `${prompt}\n\nRespond in GitHub-flavoured Markdown without a top-level title.` }],
      maxOutputTokens: 8192,
      signal: options.signal,
    });
    if (!result.text.trim()) throw new Error("The model returned an empty response.");
    return { content: result.text.trim(), data: null, usage: result.usage, model: result.model };
  }

  const result = await llm.generateJson({
    system: STUDIO_SYSTEM,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: def.jsonSchema!(),
    parse: def.parse!,
    maxOutputTokens: 8192,
    signal: options.signal,
  });
  return { content: null, data: toArtifactData(type, result.data), usage: result.usage, model: result.model };
}

function toArtifactData(type: ArtifactType, value: unknown): ArtifactData {
  const v = value as Record<string, unknown>;
  if (type === "flashcards") return { kind: "flashcards", cards: v.cards as never };
  if (type === "quiz") return { kind: "quiz", questions: v.questions as never };
  if (type === "mind_map") return { kind: "mind_map", root: v.root as never };
  return null;
}

/** Serializes any artifact to Markdown for export. */
export function artifactToMarkdown(title: string, content: string | null, data: ArtifactData): string {
  const lines = [`# ${title}`, ""];
  if (content) lines.push(content);
  if (data?.kind === "flashcards") {
    data.cards.forEach((c, i) => lines.push(`**${i + 1}. ${c.front}**`, "", c.back, ""));
  } else if (data?.kind === "quiz") {
    data.questions.forEach((q, i) => {
      lines.push(`**${i + 1}. ${q.question}**`, "");
      q.options.forEach((o, j) => lines.push(`- ${String.fromCharCode(65 + j)}. ${o}`));
      lines.push("", `*Answer: ${String.fromCharCode(65 + q.answerIndex)}* — ${q.explanation}`, "");
    });
  } else if (data?.kind === "mind_map") {
    const walk = (node: { label: string; children?: { label: string; children?: unknown[] }[] }, depth: number) => {
      lines.push(`${"  ".repeat(depth)}- ${node.label}`);
      node.children?.forEach((c) => walk(c as never, depth + 1));
    };
    walk(data.root, 0);
  }
  return lines.join("\n").trim() + "\n";
}

/** Flashcards as CSV (front,back) for import into spaced-repetition apps. */
export function flashcardsToCsv(cards: { front: string; back: string }[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return ["front,back", ...cards.map((c) => `${esc(c.front)},${esc(c.back)}`)].join("\n") + "\n";
}
