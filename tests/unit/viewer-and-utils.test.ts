import { describe, expect, it, vi } from "vitest";
import { formatBytes, formatDuration } from "@/lib/format";
import { escapeLike } from "@/lib/notebooks/queries";
import { isTransientError, mapWithConcurrency, withRetry } from "@/lib/retry";
import { findMatches, segmentBlock, splitBlocks } from "@/lib/viewer";

describe("source viewer helpers", () => {
  it("uses real pages for paged documents", () => {
    const blocks = splitBlocks("aaa\n\nbbb\n\nccc", [0, 5, 10], 3);
    expect(blocks).toEqual([
      { page: 1, start: 0, end: 5 },
      { page: 2, start: 5, end: 10 },
      { page: 3, start: 10, end: 13 },
    ]);
  });

  it("splits unpaged text into sections at paragraph boundaries", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${"x".repeat(300)}`).join("\n\n");
    const blocks = splitBlocks(text, [0], 1, 2000);
    expect(blocks.length).toBeGreaterThan(3);
    expect(blocks.every((b) => b.page === null)).toBe(true);
    expect(blocks.map((b) => text.slice(b.start, b.end)).join("")).toBe(text);
  });

  it("finds case-insensitive matches", () => {
    expect(findMatches("Cat cat CAT dog", "cat")).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
    expect(findMatches("abc", "a")).toEqual([]);
  });

  it("segments a block around highlight and search ranges", () => {
    const text = "0123456789";
    const segs = segmentBlock(text, 0, 10, [
      { start: 2, end: 6, kind: "highlight" },
      { start: 4, end: 8, kind: "search" },
    ]);
    expect(segs.map((s) => [s.text, s.ranges.map((r) => r.kind).join("+")])).toEqual([
      ["01", ""],
      ["23", "highlight"],
      ["45", "highlight+search"],
      ["67", "search"],
      ["89", ""],
    ]);
  });
});

describe("retry", () => {
  it("retries transient errors with backoff", async () => {
    const fn = vi.fn().mockRejectedValueOnce({ status: 503 }).mockResolvedValueOnce("ok");
    await expect(withRetry(fn, { baseDelayMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry client errors", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 400 });
    await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toEqual({ status: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("classifies errors", () => {
    expect(isTransientError({ status: 429 })).toBe(true);
    expect(isTransientError(new Error("fetch failed"))).toBe(true);
    expect(isTransientError({ name: "AbortError" })).toBe(false);
  });

  it("maps with bounded concurrency in order", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (x) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return x * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });
});

describe("formatting", () => {
  it("formats bytes and durations", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatDuration(125)).toBe("2:05");
  });

  it("escapes PostgREST filter metacharacters", () => {
    expect(escapeLike("50%_off,(x)")).toBe("50\\%\\_off\\,\\(x\\)");
  });
});
