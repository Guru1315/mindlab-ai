import { describe, expect, it } from "vitest";
import { buildSourceContext, sampleEvenly } from "@/lib/rag/context";
import { quizSchema, STUDIO_DEFINITIONS, STUDIO_ORDER } from "@/lib/studio/definitions";
import { artifactToMarkdown, flashcardsToCsv, generateArtifact } from "@/lib/studio/generate";
import { ValidationError } from "@/lib/ingestion/validation";
import { ARTIFACT_TYPES } from "@/lib/types";
import { FakeLLM } from "../fakes";

const sources = [
  { id: "a", title: "Paper A", text: "Paper A argues that carbon taxes are efficient." },
  { id: "b", title: "Paper B", text: "Paper B argues cap-and-trade gives certainty." },
];

describe("Studio definitions", () => {
  it("covers every artifact type exactly once", () => {
    expect([...STUDIO_ORDER].sort()).toEqual([...ARTIFACT_TYPES].sort());
    for (const type of ARTIFACT_TYPES) {
      const def = STUDIO_DEFINITIONS[type];
      if (def.output === "json") {
        expect(def.jsonSchema).toBeTypeOf("function");
        expect(def.parse).toBeTypeOf("function");
      }
    }
  });

  it("rejects quiz answers pointing outside the options", () => {
    const bad = { questions: Array.from({ length: 3 }, () => ({ question: "Which one?", options: ["a", "b", "c"], answerIndex: 3, explanation: "x" })) };
    expect(() => quizSchema.parse(bad)).toThrow();
  });
});

describe("generateArtifact", () => {
  it("generates Markdown documents from all selected sources", async () => {
    const llm = new FakeLLM({ text: () => "## Overview\nCarbon pricing." });
    const result = await generateArtifact(llm, "study_guide", sources, { focus: "exam prep" });
    expect(result.content).toBe("## Overview\nCarbon pricing.");
    expect(result.data).toBeNull();
    const prompt = llm.calls[0].messages[0].content;
    expect(prompt).toContain('<source title="Paper A">');
    expect(prompt).toContain("Paper B argues cap-and-trade");
    expect(prompt).toContain("exam prep");
    expect(llm.calls[0].system).toMatch(/Use only information present in the sources/);
  });

  it("parses structured flashcards", async () => {
    const cards = Array.from({ length: 5 }, (_, i) => ({ front: `Q${i}`, back: `A${i}` }));
    const result = await generateArtifact(new FakeLLM({ json: () => ({ cards }) }), "flashcards", sources);
    expect(result.data).toEqual({ kind: "flashcards", cards });
  });

  it("parses mind maps", async () => {
    const root = { label: "Carbon pricing", children: [{ label: "Taxes" }, { label: "Trading", children: [{ label: "Caps" }] }] };
    const result = await generateArtifact(new FakeLLM({ json: () => ({ root }) }), "mind_map", sources);
    expect(result.data).toEqual({ kind: "mind_map", root });
  });

  it("enforces source requirements", async () => {
    await expect(generateArtifact(new FakeLLM(), "faq", [])).rejects.toBeInstanceOf(ValidationError);
    await expect(generateArtifact(new FakeLLM(), "comparison", [sources[0]])).rejects.toThrow(/at least 2/);
  });
});

describe("exports", () => {
  it("serializes quizzes and mind maps to Markdown", () => {
    const md = artifactToMarkdown("Quiz", null, {
      kind: "quiz",
      questions: [{ question: "2+2?", options: ["3", "4"], answerIndex: 1, explanation: "Arithmetic." }],
    });
    expect(md).toContain("# Quiz");
    expect(md).toContain("- B. 4");
    expect(md).toContain("*Answer: B*");
    expect(artifactToMarkdown("Map", null, { kind: "mind_map", root: { label: "Root", children: [{ label: "Child" }] } })).toContain("  - Child");
  });

  it("escapes CSV fields", () => {
    expect(flashcardsToCsv([{ front: 'Say "hi", ok?', back: "line1\nline2" }])).toBe('front,back\n"Say ""hi"", ok?","line1\nline2"\n');
  });
});

describe("source context budget", () => {
  it("samples evenly across long documents", () => {
    const text = Array.from({ length: 1000 }, (_, i) => `[${i}]`).join(" ");
    const sample = sampleEvenly(text, 500, 5);
    expect(sample).toContain("[0]");
    expect(sample).toContain("[999]");
    expect(sample.length).toBeLessThan(600);
  });

  it("splits the budget proportionally between sources", () => {
    const ctx = buildSourceContext(
      [
        { id: "1", title: "Big", text: "a ".repeat(50_000) },
        { id: "2", title: "Small", text: "b ".repeat(5_000) },
      ],
      20_000,
    );
    expect(ctx.length).toBeLessThan(25_000);
    expect(ctx).toContain('title="Small"');
  });
});
