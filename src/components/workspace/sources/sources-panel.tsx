"use client";

import {
  AlertCircle,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Eye,
  FileText,
  Globe,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Trash2,
  Type,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/dashboard/notebook-dialogs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, errorMessage } from "@/lib/client/api";
import { formatNumber } from "@/lib/format";
import type { Source } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "../workspace-context";
import { AddSourcesDialog } from "./add-sources-dialog";

const KIND_STYLE: Record<string, { icon: typeof FileText; className: string; label: string }> = {
  pdf: { icon: FileText, className: "text-rose-500 bg-rose-500/10", label: "PDF" },
  docx: { icon: FileText, className: "text-sky-500 bg-sky-500/10", label: "Word" },
  txt: { icon: FileText, className: "text-slate-500 bg-slate-500/10", label: "Text" },
  md: { icon: FileText, className: "text-violet-500 bg-violet-500/10", label: "Markdown" },
  url: { icon: Globe, className: "text-emerald-500 bg-emerald-500/10", label: "Web" },
  text: { icon: Type, className: "text-amber-500 bg-amber-500/10", label: "Pasted" },
};

export function SourceKindIcon({ kind, className }: { kind: string; className?: string }) {
  const style = KIND_STYLE[kind] ?? KIND_STYLE.txt;
  return (
    <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", style.className, className)}>
      <style.icon className="size-3.5" />
    </span>
  );
}

export function SourcesPanel() {
  const { sources, setSources, selectAll, notebook } = useWorkspace();
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [onlyBookmarked, setOnlyBookmarked] = useState(false);

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return sources.filter((s) => (!onlyBookmarked || s.is_bookmarked) && (!term || s.title.toLowerCase().includes(term) || s.summary?.toLowerCase().includes(term)));
  }, [sources, filter, onlyBookmarked]);

  const ready = sources.filter((s) => s.status === "ready");
  const allSelected = ready.length > 0 && ready.every((s) => s.is_selected);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="font-semibold">Sources</h2>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus /> Add
        </Button>
      </div>

      {sources.length > 0 && (
        <div className="space-y-2 border-b px-3 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search sources" className="h-8 pl-8 text-sm" aria-label="Search sources" />
          </div>
          <div className="flex items-center justify-between px-1">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={allSelected} onCheckedChange={(v) => selectAll(v === true)} aria-label="Select all sources" />
              Select all ({ready.filter((s) => s.is_selected).length}/{ready.length})
            </label>
            <button
              onClick={() => setOnlyBookmarked((v) => !v)}
              className={cn("flex items-center gap-1 text-xs", onlyBookmarked ? "text-brand" : "text-muted-foreground hover:text-foreground")}
              aria-pressed={onlyBookmarked}
            >
              <Bookmark className="size-3.5" /> Bookmarked
            </button>
          </div>
        </div>
      )}

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
        {sources.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">
              <FileText className="size-6" />
            </span>
            <p className="mt-4 text-sm font-medium">Add your first source</p>
            <p className="mt-1 text-xs text-muted-foreground">PDFs, Word docs, web pages, or pasted text.</p>
            <Button className="mt-4" size="sm" onClick={() => setAddOpen(true)}>
              <Plus /> Add sources
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">No sources match.</p>
        ) : (
          <ul className="space-y-1">
            {visible.map((s) => (
              <SourceRow key={s.id} source={s} onRemoved={() => setSources((xs) => xs.filter((x) => x.id !== s.id))} />
            ))}
          </ul>
        )}
      </div>

      {notebook.summary && sources.length > 0 && (
        <div className="border-t px-4 py-3 text-xs text-muted-foreground">
          <p className="line-clamp-3">{notebook.summary}</p>
        </div>
      )}
      <AddSourcesDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function SourceRow({ source, onRemoved }: { source: Source; onRemoved: () => void }) {
  const { toggleSource, openSource, setSources } = useWorkspace();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(source.title);

  const patch = async (body: Partial<Source>) => {
    setSources((xs) => xs.map((x) => (x.id === source.id ? { ...x, ...body } : x)));
    try {
      await api(`/api/sources/${source.id}`, { method: "PATCH", json: body });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const retry = async () => {
    try {
      await api(`/api/sources/${source.id}/retry`, { method: "POST" });
      setSources((xs) => xs.map((x) => (x.id === source.id ? { ...x, status: "pending", error: null } : x)));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const busy = source.status === "pending" || source.status === "processing";
  const ready = source.status === "ready";

  return (
    <li className="group flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-muted/60">
      <SourceKindIcon kind={source.kind} />
      <div className="min-w-0 flex-1">
        {renaming ? (
          <Input
            autoFocus
            value={title}
            maxLength={500}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              setRenaming(false);
              if (title.trim() && title.trim() !== source.title) patch({ title: title.trim() });
              else setTitle(source.title);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="h-7 text-sm"
          />
        ) : (
          <button className="block w-full text-left disabled:cursor-default" disabled={!ready} onClick={() => openSource({ sourceId: source.id })}>
            <span className="flex items-center gap-1 truncate text-sm font-medium">
              <span className="truncate">{source.title}</span>
              {source.is_bookmarked && <BookmarkCheck className="size-3.5 shrink-0 text-brand" />}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {busy && (
                <>
                  <Loader2 className="size-3 animate-spin" /> {source.status === "pending" ? "Queued…" : "Processing…"}
                </>
              )}
              {ready && (
                <>
                  <CheckCircle2 className="size-3 text-success" />
                  {formatNumber(source.word_count)} words{source.page_count > 1 ? ` · ${source.page_count} pages` : ""}
                </>
              )}
              {source.status === "failed" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1 text-destructive">
                      <AlertCircle className="size-3" /> Failed
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">{source.error ?? "Processing failed."}</TooltipContent>
                </Tooltip>
              )}
            </span>
          </button>
        )}
      </div>
      {source.status === "failed" && (
        <Button variant="ghost" size="icon-sm" aria-label="Retry processing" onClick={retry}>
          <RotateCw />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="opacity-60 group-hover:opacity-100" aria-label={`Actions for ${source.title}`}>
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!ready} onClick={() => openSource({ sourceId: source.id })}>
            <Eye /> View source
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => patch({ is_bookmarked: !source.is_bookmarked })}>
            <Bookmark /> {source.is_bookmarked ? "Remove bookmark" : "Bookmark"}
          </DropdownMenuItem>
          {source.status === "failed" && (
            <DropdownMenuItem onClick={retry}>
              <RotateCw /> Retry processing
            </DropdownMenuItem>
          )}
          {ready && (
            // Re-indexes the source, e.g. to add AI embeddings after enabling an AI provider.
            <DropdownMenuItem onClick={retry}>
              <RotateCw /> Reprocess
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Remove source
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Checkbox
        checked={source.is_selected}
        disabled={!ready}
        onCheckedChange={(v) => toggleSource(source.id, v === true)}
        aria-label={`Use ${source.title} in chat and Studio`}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Remove this source?"
        description={`“${source.title}” and its processed content will be deleted from this notebook. Existing chat answers that cite it keep their text.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          try {
            await api(`/api/sources/${source.id}`, { method: "DELETE" });
            onRemoved();
            toast.success("Source removed");
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />
    </li>
  );
}
