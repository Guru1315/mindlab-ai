import { describe, expect, it } from "vitest";
import { resolveCitations, splitCitationMarkers } from "@/lib/rag/citations";
import { linkCitations } from "@/components/workspace/chat/markdown";
import type { Citation } from "@/lib/types";

const cite = (index: number, sourceId = "s1"): Citation => ({
  index,
  chunkId: `c${index}`,
  sourceId,
  sourceTitle: `Source ${sourceId}`,
  sourceKind: "pdf",
  excerpt: `Passage ${index}`,
  pageStart: index,
  pageEnd: index,
  charStart: index * 100,
  charEnd: index * 100 + 50,
});

describe("resolveCitations", () => {
  const available = [cite(1), cite(2), cite(3, "s2")];

  it("keeps valid markers and returns cited passages in first-use order", () => {
    const r = resolveCitations("Plants use light [2]. Carbon is fixed [1][3].", available);
    expect(r.text).toBe("Plants use light [2]. Carbon is fixed [1][3].");
    expect(r.citations.map((c) => c.index)).toEqual([2, 1, 3]);
    expect(r.invalid).toEqual([]);
  });

  it("strips markers that do not match a retrieved passage (no invented citations)", () => {
    const r = resolveCitations("A claim [7]. Another [2, 9]. Done [12].", available);
    expect(r.text).toBe("A claim. Another [2]. Done.");
    expect(r.citations.map((c) => c.index)).toEqual([2]);
    expect(r.invalid.sort((a, b) => a - b)).toEqual([7, 9, 12]);
  });

  it("expands ranges and grouped markers", () => {
    const r = resolveCitations("Summary [1-3].", available);
    expect(r.text).toBe("Summary [1][2][3].");
    expect(r.citations).toHaveLength(3);
  });

  it("does not treat markdown links as citations", () => {
    const r = resolveCitations("See [the docs](https://example.com) and [1].", available);
    expect(r.text).toContain("[the docs](https://example.com)");
    expect(r.citations.map((c) => c.index)).toEqual([1]);
  });

  it("returns no citations for ungrounded answers", () => {
    const r = resolveCitations("The selected sources don't cover this.", available);
    expect(r.citations).toEqual([]);
  });
});

describe("citation rendering helpers", () => {
  it("splits markers for chip rendering", () => {
    expect(splitCitationMarkers("A [1] b [2, 3].")).toEqual(["A ", 1, " b ", 2, 3, "."]);
  });

  it("converts markers into cite: links for the Markdown renderer", () => {
    expect(linkCitations("Fact [1]. Both [2, 3]. Link [x](y)")).toBe("Fact [1](cite:1). Both [2](cite:2)[3](cite:3). Link [x](y)");
  });
});
