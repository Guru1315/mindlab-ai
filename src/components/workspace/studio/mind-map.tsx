"use client";

import { ChevronRight, MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { MindMapNode } from "@/lib/types";
import { cn } from "@/lib/utils";

const DEPTH_COLORS = ["bg-brand text-brand-foreground", "bg-brand-soft text-foreground", "bg-muted text-foreground", "bg-card text-foreground"];

/** Expandable horizontal tree. Clicking a leaf's ask button sends a question to chat. */
export function MindMap({ root, onAsk }: { root: MindMapNode; onAsk?: (question: string) => void }) {
  const [expandAll, setExpandAll] = useState<number>(0);
  return (
    <div>
      <div className="mb-3 flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setExpandAll((n) => Math.abs(n) + 1)}>
          Expand all
        </Button>
        <Button variant="outline" size="sm" onClick={() => setExpandAll((n) => -(Math.abs(n) + 1))}>
          Collapse all
        </Button>
      </div>
      <div className="scrollbar-thin overflow-x-auto pb-4">
        <Node node={root} depth={0} path={[]} expandSignal={expandAll} onAsk={onAsk} />
      </div>
    </div>
  );
}

function Node({ node, depth, path, expandSignal, onAsk }: { node: MindMapNode; depth: number; path: string[]; expandSignal: number; onAsk?: (q: string) => void }) {
  const [open, setOpen] = useState(depth < 1);
  const [lastSignal, setLastSignal] = useState(expandSignal);
  if (expandSignal !== lastSignal) {
    setLastSignal(expandSignal);
    setOpen(expandSignal > 0 || depth < 1);
  }
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const trail = [...path, node.label];

  return (
    <div className="flex items-center">
      <div className="group flex shrink-0 items-center gap-1">
        <button
          onClick={() => hasChildren && setOpen((o) => !o)}
          aria-expanded={hasChildren ? open : undefined}
          className={cn(
            "flex max-w-56 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-left text-sm shadow-xs transition",
            DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)],
            hasChildren && "hover:ring-2 hover:ring-brand/30",
            depth === 0 && "font-semibold",
          )}
        >
          <span className="line-clamp-2">{node.label}</span>
          {hasChildren && <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />}
        </button>
        {onAsk && depth > 0 && (
          <button
            onClick={() => onAsk(`Tell me about “${node.label}” in the context of ${trail.slice(0, -1).join(" → ")}.`)}
            className="rounded-md p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-brand focus-visible:opacity-100"
            aria-label={`Ask about ${node.label}`}
          >
            <MessageSquarePlus className="size-3.5" />
          </button>
        )}
      </div>
      {hasChildren && open && (
        <div className="relative ml-4 flex flex-col gap-2 border-l border-border py-1 pl-4">
          {children.map((child, i) => (
            <div key={`${child.label}-${i}`} className="relative before:absolute before:top-1/2 before:-left-4 before:h-px before:w-4 before:bg-border">
              <Node node={child} depth={depth + 1} path={trail} expandSignal={expandSignal} onAsk={onAsk} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
