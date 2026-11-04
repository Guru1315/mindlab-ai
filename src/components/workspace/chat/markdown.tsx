"use client";

import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Citation } from "@/lib/types";
import { cn } from "@/lib/utils";

const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g;

/** Turns [1] / [1, 2] markers into cite: links that render as chips. */
export function linkCitations(markdown: string): string {
  return markdown.replace(MARKER, (_m, group: string) =>
    group
      .split(/\s*,\s*/)
      .map((n) => `[${n}](cite:${n})`)
      .join(""),
  );
}

function urlTransform(url: string) {
  return url.startsWith("cite:") ? url : defaultUrlTransform(url);
}

export interface CitationHandlers {
  citations: Citation[];
  onOpen?: (citation: Citation) => void;
}

function CitationChip({ citation, n, onOpen }: { citation?: Citation; n: string; onOpen?: (c: Citation) => void }) {
  if (!citation) {
    // While streaming, a marker may arrive before its passage list; render it neutrally.
    return <span className="mx-0.5 inline-grid h-[1.15rem] min-w-[1.15rem] place-items-center rounded-full bg-muted px-1 align-[1px] text-[10px] font-semibold text-muted-foreground">{n}</span>;
  }
  const page = citation.pageStart ? (citation.pageEnd && citation.pageEnd !== citation.pageStart ? `pp. ${citation.pageStart}–${citation.pageEnd}` : `p. ${citation.pageStart}`) : null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-citation
          aria-label={`Citation ${n}: ${citation.sourceTitle}${page ? `, ${page}` : ""}`}
          className="mx-0.5 inline-grid h-[1.15rem] min-w-[1.15rem] place-items-center rounded-full bg-brand-soft px-1 align-[1px] text-[10px] font-semibold text-brand transition hover:bg-brand hover:text-brand-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {n}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="border-b px-3.5 py-2.5">
          <p className="truncate text-sm font-medium">{citation.sourceTitle}</p>
          {page && <p className="text-xs text-muted-foreground">{page}</p>}
        </div>
        <p className="scrollbar-thin max-h-48 overflow-y-auto px-3.5 py-2.5 text-xs leading-relaxed text-foreground/85">“{citation.excerpt.length > 700 ? `${citation.excerpt.slice(0, 700)}…` : citation.excerpt}”</p>
        {onOpen && (
          <div className="border-t px-2 py-1.5">
            <button onClick={() => onOpen(citation)} className="w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-brand hover:bg-brand-soft">
              Open in source →
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export const Markdown = memo(function Markdown({ content, citations = [], onOpen, className }: { content: string; className?: string } & Partial<CitationHandlers>) {
  const byIndex = new Map(citations.map((c) => [String(c.index), c]));
  return (
    <div className={cn("prose-ml", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={{
          a({ href, children }) {
            if (href?.startsWith("cite:")) {
              const n = href.slice(5);
              return <CitationChip n={n} citation={byIndex.get(n)} onOpen={onOpen} />;
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                {children}
              </a>
            );
          },
          img() {
            // Never load remote images referenced by model output or sources.
            return null;
          },
        }}
      >
        {linkCitations(content)}
      </ReactMarkdown>
    </div>
  );
});
