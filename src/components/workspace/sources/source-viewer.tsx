"use client";

import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ExternalLink, Loader2, MessageSquarePlus, Search, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/client/api";
import { formatNumber } from "@/lib/format";
import type { Source } from "@/lib/types";
import { findMatches, segmentBlock, splitBlocks, type OverlayRange } from "@/lib/viewer";
import { useWorkspace } from "../workspace-context";
import { SourceKindIcon } from "./sources-panel";

type SourceDetail = Source & { extracted_text: string | null; page_offsets: number[] };

export function SourceViewer() {
  const { viewer, closeViewer, askQuestion } = useWorkspace();
  const [source, setSource] = useState<SourceDetail | null>(null);
  const [chunkHighlight, setChunkHighlight] = useState<{ char_start: number; char_end: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeHit, setActiveHit] = useState(0);
  const [currentBlock, setCurrentBlock] = useState(0);
  const [selection, setSelection] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // The parent remounts this component (via key) when the source changes, so
  // state starts fresh and this effect only fetches.
  const sourceId = viewer?.sourceId;
  useEffect(() => {
    if (!sourceId) return;
    let cancelled = false;
    const chunkParam = viewer?.chunkId ? `?chunk=${viewer.chunkId}` : "";
    api<{ source: SourceDetail; highlight: { char_start: number; char_end: number } | null }>(`/api/sources/${sourceId}${chunkParam}`)
      .then((res) => {
        if (cancelled) return;
        setSource(res.source);
        setChunkHighlight(res.highlight);
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [sourceId, viewer?.chunkId]);

  const text = source?.extracted_text ?? "";
  const blocks = useMemo(() => (source ? splitBlocks(text, source.page_offsets ?? [0], source.page_count) : []), [source, text]);
  const hits = useMemo(() => findMatches(text, query), [text, query]);

  const highlight = useMemo(
    () => viewer?.highlight ?? (chunkHighlight ? { start: chunkHighlight.char_start, end: chunkHighlight.char_end } : undefined),
    [viewer?.highlight, chunkHighlight],
  );

  const ranges = useMemo<OverlayRange[]>(() => {
    const r: OverlayRange[] = [];
    if (highlight) r.push({ start: highlight.start, end: highlight.end, kind: "highlight", id: "viewer-highlight" });
    hits.forEach((h, i) => r.push({ ...h, kind: "search", active: i === activeHit, id: i === activeHit ? "viewer-active-hit" : undefined }));
    return r;
  }, [highlight, hits, activeHit]);

  // Scroll to the cited passage whenever a citation is opened.
  const hlStart = highlight?.start;
  const hlEnd = highlight?.end;
  const nonce = viewer?.nonce;
  useEffect(() => {
    if (!source || hlStart === undefined) return;
    const t = setTimeout(() => document.getElementById("viewer-highlight")?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
    return () => clearTimeout(t);
  }, [source, hlStart, hlEnd, nonce]);

  useEffect(() => {
    if (hits.length) document.getElementById("viewer-active-hit")?.scrollIntoView({ block: "center" });
  }, [activeHit, hits.length]);

  // Track which block is in view for page navigation.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || blocks.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setCurrentBlock(Number((visible.target as HTMLElement).dataset.block));
      },
      { root, rootMargin: "0px 0px -70% 0px" },
    );
    root.querySelectorAll("[data-block]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [blocks]);

  const goToBlock = useCallback((index: number) => {
    const el = scrollRef.current?.querySelector(`[data-block="${index}"]`);
    el?.scrollIntoView({ block: "start" });
  }, []);

  const targetPage = viewer?.page;
  useEffect(() => {
    if (source && targetPage && hlStart === undefined) goToBlock(Math.max(0, targetPage - 1));
  }, [source, targetPage, nonce, hlStart, goToBlock]);

  const onMouseUp = () => {
    const sel = window.getSelection()?.toString().trim() ?? "";
    setSelection(sel.length > 3 ? sel.slice(0, 1500) : "");
  };

  const paged = source && source.page_count > 1;
  const label = paged ? "Page" : "Section";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <Button variant="ghost" size="icon-sm" onClick={closeViewer} aria-label="Back to sources">
          <ArrowLeft />
        </Button>
        {source && <SourceKindIcon kind={source.kind} />}
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{source?.title ?? "Loading…"}</h2>
        {source?.storage_path && (
          <Button asChild variant="ghost" size="icon-sm" aria-label="Open original file">
            <a href={`/api/sources/${source.id}/file${paged ? `#page=${blocks[currentBlock]?.page ?? 1}` : ""}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
            </a>
          </Button>
        )}
        {source?.kind === "url" && source.url && (
          <Button asChild variant="ghost" size="icon-sm" aria-label="Open web page">
            <a href={source.url} target="_blank" rel="noopener noreferrer nofollow">
              <ExternalLink />
            </a>
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={closeViewer} aria-label="Close viewer">
          <X />
        </Button>
      </div>

      {source && (
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveHit(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hits.length) setActiveHit((i) => (e.shiftKey ? (i - 1 + hits.length) % hits.length : (i + 1) % hits.length));
              }}
              placeholder="Search in document"
              className="h-8 pl-8 text-sm"
              aria-label="Search in document"
            />
          </div>
          {query.trim().length >= 2 && (
            <>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{hits.length ? `${activeHit + 1}/${hits.length}` : "0"}</span>
              <Button variant="ghost" size="icon-sm" disabled={!hits.length} onClick={() => setActiveHit((i) => (i - 1 + hits.length) % hits.length)} aria-label="Previous match">
                <ChevronUp />
              </Button>
              <Button variant="ghost" size="icon-sm" disabled={!hits.length} onClick={() => setActiveHit((i) => (i + 1) % hits.length)} aria-label="Next match">
                <ChevronDown />
              </Button>
            </>
          )}
        </div>
      )}

      <div ref={scrollRef} onMouseUp={onMouseUp} className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!source && !error && (
          <div className="space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-full" />
          </div>
        )}
        {source && (
          <>
            {source.summary && (
              <div className="mb-5 rounded-xl border bg-brand-soft/40 p-3.5 text-sm">
                <p className="mb-1 text-xs font-semibold tracking-wide text-brand uppercase">Source guide</p>
                <p className="whitespace-pre-line text-foreground/90">{source.summary}</p>
              </div>
            )}
            <p className="mb-4 text-xs text-muted-foreground">
              {formatNumber(source.word_count)} words{paged ? ` · ${source.page_count} pages` : ""}
              {source.kind === "pdf" ? " · extracted text view" : ""}
            </p>
            {blocks.map((block, i) => (
              <section
                key={block.start}
                data-block={i}
                className="mb-6 [contain-intrinsic-size:auto_900px] [content-visibility:auto]"
                aria-label={block.page ? `Page ${block.page}` : undefined}
              >
                {block.page && <p className="sticky top-0 z-10 mb-2 bg-card/95 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase backdrop-blur">Page {block.page}</p>}
                <div className="font-[450] text-[0.9rem] leading-7 whitespace-pre-wrap text-foreground/90 selection:bg-brand/25">
                  {segmentBlock(text, block.start, block.end, ranges).map((seg) => {
                    if (seg.ranges.length === 0) return <Fragment key={seg.start}>{seg.text}</Fragment>;
                    const hl = seg.ranges.find((r) => r.kind === "highlight");
                    const hit = seg.ranges.find((r) => r.kind === "search");
                    const first = (r?: OverlayRange) => (r?.id && seg.start === Math.max(block.start, r.start) ? r.id : undefined);
                    return (
                      <mark
                        key={seg.start}
                        id={first(hit?.active ? hit : undefined) ?? first(hl)}
                        className={hit ? "search-hit" : "citation-highlight"}
                        data-active={hit?.active ? "true" : undefined}
                      >
                        {seg.text}
                      </mark>
                    );
                  })}
                </div>
              </section>
            ))}
          </>
        )}
        {selection && (
          <div className="sticky bottom-2 flex justify-center">
            <Button
              size="sm"
              className="shadow-lg"
              onClick={() => {
                askQuestion(`Explain this passage from “${source?.title}”: "${selection}"`);
                setSelection("");
                window.getSelection()?.removeAllRanges();
              }}
            >
              <MessageSquarePlus /> Ask about selection
            </Button>
          </div>
        )}
      </div>

      {source && blocks.length > 1 && (
        <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
          <Button variant="ghost" size="sm" disabled={currentBlock === 0} onClick={() => goToBlock(currentBlock - 1)}>
            <ChevronLeft /> Prev
          </Button>
          <label className="flex items-center gap-1.5">
            {label}
            <select
              value={currentBlock}
              onChange={(e) => goToBlock(Number(e.target.value))}
              className="rounded-md border bg-background px-1.5 py-0.5 text-foreground"
              aria-label={`Go to ${label.toLowerCase()}`}
            >
              {blocks.map((b, i) => (
                <option key={b.start} value={i}>
                  {b.page ?? i + 1}
                </option>
              ))}
            </select>
            of {blocks.length}
          </label>
          <Button variant="ghost" size="sm" disabled={currentBlock >= blocks.length - 1} onClick={() => goToBlock(currentBlock + 1)}>
            Next <ChevronRight />
          </Button>
        </div>
      )}
      {!source && !error && (
        <div className="flex justify-center border-t py-2">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
