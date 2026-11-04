"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ArchiveRestore,
  Copy,
  FileSearch,
  FileText,
  Globe,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Type,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHydrated } from "@/hooks/use-hydrated";
import { api, errorMessage } from "@/lib/client/api";
import { timeAgo } from "@/lib/format";
import type { Notebook, NotebookWithCounts } from "@/lib/types";
import { ConfirmDialog, NotebookFormDialog } from "./notebook-dialogs";

interface RecentSource {
  id: string;
  title: string;
  kind: string;
  status: string;
  notebook_id: string;
  updated_at: string;
  notebooks: { title: string; emoji: string };
}

interface SearchResult {
  id: string;
  source_id: string;
  notebook_id: string;
  content: string;
  page_start: number | null;
  sources: { title: string };
  notebooks: { title: string; emoji: string };
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function sourceIcon(kind: string) {
  if (kind === "url") return Globe;
  if (kind === "text") return Type;
  return FileText;
}

export function DashboardView({
  firstName,
  initialNotebooks,
  initialArchived,
  recentSources,
}: {
  firstName: string | null;
  initialNotebooks: NotebookWithCounts[];
  initialArchived: NotebookWithCounts[];
  recentSources: RecentSource[];
}) {
  const router = useRouter();
  const [active, setActive] = useState(initialNotebooks);
  const [archived, setArchived] = useState(initialArchived);
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<NotebookWithCounts | null>(null);
  const [deleting, setDeleting] = useState<NotebookWithCounts | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Greeting depends on the viewer's clock, so render it only after hydration.
  const hello = useHydrated() ? greeting() : "Welcome";
  const [search, setSearch] = useState<{ term: string; results: SearchResult[] } | null>(null);

  // Full-text search across notebook content (debounced). State is only set
  // from the timer callback; stale results are ignored by comparing terms.
  const term = query.trim();
  useEffect(() => {
    if (term.length < 3) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { results } = await api<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(term)}`);
        if (!cancelled) setSearch({ term, results });
      } catch {
        if (!cancelled) setSearch({ term, results: [] });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);
  const contentResults = term.length >= 3 && search?.term === term ? search.results : null;
  const searching = term.length >= 3 && search?.term !== term;

  const list = tab === "active" ? active : archived;
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return list;
    return list.filter((n) => n.title.toLowerCase().includes(term) || n.description?.toLowerCase().includes(term));
  }, [list, query]);

  async function createNotebook(values: { title: string; description: string; emoji: string }) {
    try {
      const { notebook } = await api<{ notebook: Notebook }>("/api/notebooks", { method: "POST", json: values });
      router.push(`/notebooks/${notebook.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }

  async function updateNotebook(id: string, patch: Partial<Notebook>) {
    const { notebook } = await api<{ notebook: Notebook }>(`/api/notebooks/${id}`, { method: "PATCH", json: patch });
    return notebook;
  }

  async function toggleArchive(n: NotebookWithCounts) {
    setBusyId(n.id);
    try {
      const updated = await updateNotebook(n.id, { is_archived: !n.is_archived });
      const merged = { ...n, ...updated };
      if (updated.is_archived) {
        setActive((xs) => xs.filter((x) => x.id !== n.id));
        setArchived((xs) => [merged, ...xs]);
        toast.success("Notebook archived");
      } else {
        setArchived((xs) => xs.filter((x) => x.id !== n.id));
        setActive((xs) => [merged, ...xs]);
        toast.success("Notebook restored");
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function duplicate(n: NotebookWithCounts) {
    setBusyId(n.id);
    const t = toast.loading("Duplicating notebook…");
    try {
      const { notebook } = await api<{ notebook: Notebook }>(`/api/notebooks/${n.id}/duplicate`, { method: "POST" });
      setActive((xs) => [{ ...notebook, source_count: n.source_count }, ...xs]);
      toast.success("Notebook duplicated", { id: t });
    } catch (error) {
      toast.error(errorMessage(error), { id: t });
    } finally {
      setBusyId(null);
    }
  }

  const empty = active.length === 0 && archived.length === 0;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{hello}{firstName ? `, ${firstName}` : ""}</p>
          <h1 className="mt-1 font-display text-4xl tracking-tight sm:text-5xl">Your notebooks</h1>
        </div>
        <Button size="lg" className="h-10" onClick={() => setCreateOpen(true)}>
          <Plus /> New notebook
        </Button>
      </div>

      {empty ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Tabs value={tab} onValueChange={(v) => setTab(v as "active" | "archived")}>
              <TabsList>
                <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
                <TabsTrigger value="archived">Archived ({archived.length})</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative sm:w-80">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notebooks and content…" className="h-10 pl-9" aria-label="Search notebooks" />
              {searching && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tab === "active" && !query && (
              <button
                onClick={() => setCreateOpen(true)}
                className="group flex min-h-44 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed text-muted-foreground transition hover:border-brand/60 hover:bg-brand-soft/30 hover:text-foreground"
              >
                <span className="grid size-11 place-items-center rounded-full bg-muted transition group-hover:bg-brand group-hover:text-brand-foreground">
                  <Plus className="size-5" />
                </span>
                <span className="text-sm font-medium">Create notebook</span>
              </button>
            )}
            <AnimatePresence initial={false}>
              {filtered.map((n) => (
                <motion.div key={n.id} layout initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.18 }}>
                  <NotebookCard
                    notebook={n}
                    busy={busyId === n.id}
                    onEdit={() => setEditing(n)}
                    onArchive={() => toggleArchive(n)}
                    onDuplicate={() => duplicate(n)}
                    onDelete={() => setDeleting(n)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {filtered.length === 0 && (
            <p className="mt-10 text-center text-sm text-muted-foreground">
              {query ? `No notebooks match “${query}”.` : tab === "archived" ? "No archived notebooks." : "No notebooks yet."}
            </p>
          )}

          {contentResults && contentResults.length > 0 && (
            <section className="mt-10">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <FileSearch className="size-4 text-brand" /> Matches inside your sources
              </h2>
              <ul className="mt-3 divide-y rounded-2xl border bg-card">
                {contentResults.slice(0, 10).map((r) => (
                  <li key={r.id}>
                    <Link href={`/notebooks/${r.notebook_id}?source=${r.source_id}&chunk=${r.id}`} className="block px-4 py-3 hover:bg-muted/50">
                      <p className="text-xs text-muted-foreground">
                        {r.notebooks.emoji} {r.notebooks.title} · {r.sources.title}
                        {r.page_start ? ` · p. ${r.page_start}` : ""}
                      </p>
                      <p className="mt-1 line-clamp-2 text-sm">{r.content}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {recentSources.length > 0 && !query && (
            <section className="mt-12">
              <h2 className="text-sm font-semibold">Recently added sources</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {recentSources.map((s) => {
                  const Icon = sourceIcon(s.kind);
                  return (
                    <Link key={s.id} href={`/notebooks/${s.notebook_id}?source=${s.id}`} className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 transition hover:bg-muted/50">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
                        <Icon className="size-4 text-muted-foreground" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{s.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {s.notebooks.emoji} {s.notebooks.title} · {timeAgo(s.updated_at)}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      <NotebookFormDialog open={createOpen} onOpenChange={setCreateOpen} mode="create" onSubmit={createNotebook} />
      <NotebookFormDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        mode="edit"
        initial={editing ? { title: editing.title, description: editing.description ?? "", emoji: editing.emoji } : undefined}
        onSubmit={async (values) => {
          if (!editing) return;
          try {
            const updated = await updateNotebook(editing.id, { title: values.title, description: values.description || null, emoji: values.emoji });
            const apply = (xs: NotebookWithCounts[]) => xs.map((x) => (x.id === editing.id ? { ...x, ...updated } : x));
            setActive(apply);
            setArchived(apply);
            toast.success("Notebook updated");
          } catch (error) {
            toast.error(errorMessage(error));
            throw error;
          }
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.title ?? ""}”?`}
        description="This permanently deletes the notebook with all its sources, chats, Studio items and audio. This can't be undone."
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await api(`/api/notebooks/${deleting.id}`, { method: "DELETE" });
            setActive((xs) => xs.filter((x) => x.id !== deleting.id));
            setArchived((xs) => xs.filter((x) => x.id !== deleting.id));
            toast.success("Notebook deleted");
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />
    </main>
  );
}

function NotebookCard({
  notebook,
  busy,
  onEdit,
  onArchive,
  onDuplicate,
  onDelete,
}: {
  notebook: NotebookWithCounts;
  busy: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group relative flex h-full min-h-44 flex-col rounded-2xl border bg-card p-5 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand/5">
      <Link href={`/notebooks/${notebook.id}`} className="absolute inset-0 rounded-2xl" aria-label={`Open ${notebook.title}`} />
      <div className="flex items-start justify-between">
        <span className="grid size-11 place-items-center rounded-xl bg-muted text-2xl">{notebook.emoji}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="relative z-10 opacity-60 group-hover:opacity-100" aria-label="Notebook actions" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil /> Rename & edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onArchive}>
              {notebook.is_archived ? <ArchiveRestore /> : <Archive />} {notebook.is_archived ? "Restore" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <h3 className="mt-4 line-clamp-2 font-semibold leading-snug">{notebook.title}</h3>
      {notebook.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{notebook.description}</p>}
      <p className="mt-auto pt-4 text-xs text-muted-foreground">
        {notebook.source_count} {notebook.source_count === 1 ? "source" : "sources"} · opened {timeAgo(notebook.last_opened_at)}
      </p>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mt-12 rounded-3xl border border-dashed bg-card/50 px-6 py-16 text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand-soft text-3xl">📓</span>
      <h2 className="mt-5 text-xl font-semibold">Create your first notebook</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        A notebook holds the sources for one project. Add PDFs, documents, web pages or notes, then ask questions and generate study material.
      </p>
      <Button className="mt-6" size="lg" onClick={onCreate}>
        <Plus /> New notebook
      </Button>
    </div>
  );
}
