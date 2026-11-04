import { z } from "zod";
import type { ArtifactType } from "@/lib/types";
import { jsonSchemaFor } from "@/lib/ai/schema";

export const flashcardsSchema = z.object({
  cards: z
    .array(z.object({ front: z.string().min(1).max(400), back: z.string().min(1).max(1200) }))
    .min(4)
    .max(40),
});

export const quizSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(5).max(600),
        options: z.array(z.string().min(1).max(300)).min(3).max(5),
        answerIndex: z.number().int().min(0).max(4),
        explanation: z.string().min(1).max(1200),
      }),
    )
    .min(3)
    .max(25)
    .refine((qs) => qs.every((q) => q.answerIndex < q.options.length), "answerIndex out of range"),
});

interface MindMapNodeShape {
  label: string;
  children?: MindMapNodeShape[];
}

const mindMapNode: z.ZodType<MindMapNodeShape> = z.lazy(() =>
  z.object({
    label: z.string().min(1).max(160),
    children: z.array(mindMapNode).max(10).optional(),
  }),
);

export const mindMapSchema = z.object({ root: mindMapNode });

// JSON Schema for the mind map is written by hand: recursive zod schemas need
// $ref support, and a bounded explicit depth keeps model output well-formed.
function mindMapJsonSchema(depth: number): Record<string, unknown> {
  const node: Record<string, unknown> = { type: "object", properties: { label: { type: "string" } }, required: ["label"] };
  if (depth > 0) {
    (node.properties as Record<string, unknown>).children = { type: "array", items: mindMapJsonSchema(depth - 1) };
  }
  return node;
}

export interface StudioDefinition {
  type: ArtifactType;
  label: string;
  description: string;
  defaultTitle: string;
  output: "markdown" | "json";
  instructions: string;
  minSources?: number;
  jsonSchema?: () => Record<string, unknown>;
  parse?: (value: unknown) => unknown;
}

const md = (s: string) => s.trim();

export const STUDIO_DEFINITIONS: Record<ArtifactType, StudioDefinition> = {
  study_guide: {
    type: "study_guide",
    label: "Study guide",
    description: "Short-answer quiz, essay prompts and a glossary.",
    defaultTitle: "Study guide",
    output: "markdown",
    instructions: md(`
Create a study guide with these sections:
## Overview — 1 paragraph on what the material covers.
## Short-answer quiz — 10 questions answerable in 2-3 sentences.
## Answer key — answers to the quiz, in order.
## Essay questions — 5 open-ended questions (no answers).
## Glossary — key terms with concise definitions drawn from the sources.`),
  },
  faq: {
    type: "faq",
    label: "FAQ",
    description: "Frequently asked questions with sourced answers.",
    defaultTitle: "Frequently asked questions",
    output: "markdown",
    instructions: md(`
Write an FAQ of 8-12 questions a newcomer would ask about this material.
Format each as "### Question" followed by a clear answer paragraph.
Order from foundational to advanced.`),
  },
  briefing: {
    type: "briefing",
    label: "Briefing doc",
    description: "Executive summary, key themes and notable quotes.",
    defaultTitle: "Briefing document",
    output: "markdown",
    instructions: md(`
Write a briefing document:
## Executive summary — 1-2 paragraphs.
## Key themes — each theme as a ### heading with supporting detail.
## Notable quotes — up to 6 quotes copied exactly (verbatim) from the sources, each attributed to its source title. Omit this section rather than paraphrase.
## Implications and open questions.`),
  },
  timeline: {
    type: "timeline",
    label: "Timeline",
    description: "Chronology of events and a cast of characters.",
    defaultTitle: "Timeline",
    output: "markdown",
    instructions: md(`
Build a timeline of the events described in the sources.
## Timeline — chronological bullet list: "**Date or period** — event". Use only dates stated or clearly implied by the sources; if order is known but dates are not, say "Undated".
## Cast of characters — people and organizations involved, each with a one-line description.
If the sources contain no chronological information, say so in one sentence instead.`),
  },
  key_concepts: {
    type: "key_concepts",
    label: "Key concepts",
    description: "Core ideas, entities and topics extracted from sources.",
    defaultTitle: "Key concepts",
    output: "markdown",
    instructions: md(`
Extract the core knowledge in the sources:
## Main topics — the 3-7 major topics, one line each.
## Key concepts — each as "**Term** — explanation (why it matters)".
## Entities — tables of People, Organizations, Places and Works/Products mentioned (Name | Role/description). Omit empty categories.
## Key points — the 8-12 most important takeaways as bullets.`),
  },
  revision_notes: {
    type: "revision_notes",
    label: "Revision notes",
    description: "Condensed notes for quick review before an exam.",
    defaultTitle: "Revision notes",
    output: "markdown",
    instructions: md(`
Write condensed revision notes: hierarchical bullet points grouped under ## headings by topic,
with key terms in bold, formulas or definitions verbatim where present, and a final
"## Common pitfalls" section listing misconceptions the sources warn about or clarify (omit if none).`),
  },
  comparison: {
    type: "comparison",
    label: "Compare sources",
    description: "How the selected sources agree, differ and complement each other.",
    defaultTitle: "Source comparison",
    output: "markdown",
    minSources: 2,
    instructions: md(`
Compare the sources against each other:
## At a glance — a Markdown table with one row per source: Source | Focus | Main claim/position | Approach.
## Where they agree
## Where they differ — be specific about which source says what.
## Unique contributions — what each source adds that others do not.
## Synthesis — a combined view that respects the differences.`),
  },
  flashcards: {
    type: "flashcards",
    label: "Flashcards",
    description: "Question-and-answer cards for active recall.",
    defaultTitle: "Flashcards",
    output: "json",
    instructions: md(`
Create 15-25 flashcards covering the most important facts, definitions and ideas.
"front" is a concise question or term; "back" is a precise answer from the sources.
Avoid duplicates and trivia; vary difficulty.`),
    jsonSchema: () => jsonSchemaFor(flashcardsSchema),
    parse: (v) => flashcardsSchema.parse(v),
  },
  quiz: {
    type: "quiz",
    label: "Quiz",
    description: "Multiple-choice questions with explanations.",
    defaultTitle: "Quiz",
    output: "json",
    instructions: md(`
Write a 10-question multiple-choice quiz. Each question has 4 options with exactly one correct answer
(answerIndex is its 0-based position). Distractors must be plausible but clearly wrong according to the sources.
The explanation says why the answer is correct, referencing the source content.`),
    jsonSchema: () => jsonSchemaFor(quizSchema),
    parse: (v) => quizSchema.parse(v),
  },
  mind_map: {
    type: "mind_map",
    label: "Mind map",
    description: "Hierarchical map of topics and subtopics.",
    defaultTitle: "Mind map",
    output: "json",
    instructions: md(`
Build a mind map of the material. The root label is the overall subject (max 6 words).
Give it 4-7 main branches, each with 2-6 children, and go up to 4 levels deep where the sources support it.
Labels are short noun phrases (max 10 words).`),
    jsonSchema: () => ({ type: "object", properties: { root: mindMapJsonSchema(4) }, required: ["root"] }),
    parse: (v) => mindMapSchema.parse(v),
  },
};

export const STUDIO_ORDER: ArtifactType[] = [
  "study_guide",
  "faq",
  "briefing",
  "timeline",
  "key_concepts",
  "flashcards",
  "quiz",
  "mind_map",
  "revision_notes",
  "comparison",
];
