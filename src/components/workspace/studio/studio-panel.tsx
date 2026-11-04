"use client";

import { ChevronRight, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/client/api";
import { timeAgo } from "@/lib/format";
import { STUDIO_DEFINITIONS, STUDIO_ORDER } from "@/lib/studio/definitions";
import type { ArtifactType, GeneratedArtifact } from "@/lib/types";
import { useWorkspace } from "../workspace-context";
import { ArtifactViewer } from "./artifact-viewer";
import { AudioOverview } from "./audio-overview";
import { STUDIO_ICONS } from "./studio-icons";

export function StudioPanel() {
  const { notebook, readySelectedIds, aiConfigured } = useWorkspace();
  const [artifacts, setArtifacts] = useState<GeneratedArtifact[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pendingType, setPendingType] = useState<ArtifactType | null>(null);
  const [focus, setFocus] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const { artifacts } = await api<{ artifacts: GeneratedArtifact[] }>(`/api/notebooks/${notebook.id}/artifacts`);
    // Keep unchanged objects stable so open viewers (quiz progress, flashcards) don't reset while polling.
    setArtifacts((prev) => {
      const byId = new Map((prev ?? []).map((a) => [a.id, a]));
      return artifacts.map((a) => {
        const old = byId.get(a.id);
        return old && old.updated_at === a.updated_at && old.status === a.status ? old : a;
      });
    });
  }, [notebook.id]);

  useEffect(() => {
    let cancelled = false;
    api<{ artifacts: GeneratedArtifact[] }>(`/api/notebooks/${notebook.id}/artifacts`)
      .then(({ artifacts }) => !cancelled && setArtifacts(artifacts))
      .catch((e) => {
        if (cancelled) return;
        toast.error(errorMessage(e));
        setArtifacts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [notebook.id]);

  const generating = artifacts?.some((a) => a.status === "generating") ?? false;
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => load().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [generating, load]);

  async function create(type: ArtifactType) {
    setCreating(true);
    try {
      const { artifact } = await api<{ artifact: GeneratedArtifact }>(`/api/notebooks/${notebook.id}/artifacts`, {
        method: "POST",
        json: { type, sourceIds: readySelectedIds, focus: focus.trim() || undefined },
      });
      setArtifacts((xs) => [artifact, ...(xs ?? [])]);
      setPendingType(null);
      setFocus("");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  const upsert = (a: GeneratedArtifact) => setArtifacts((xs) => xs?.map((x) => (x.id === a.id ? a : x)) ?? [a]);
  const open = artifacts?.find((a) => a.id === openId) ?? null;
  const pendingDef = pendingType ? STUDIO_DEFINITIONS[pendingType] : null;
  const noSources = readySelectedIds.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="font-semibold">Studio</h2>
        <span className="text-xs text-muted-foreground">{readySelectedIds.length} sources selected</span>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
        <AudioOverview />

        <div>
          <p className="mb-2 px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Create</p>
          <div className="grid grid-cols-2 gap-2">
            {STUDIO_ORDER.map((type) => {
              const def = STUDIO_DEFINITIONS[type];
              const Icon = STUDIO_ICONS[type];
              const insufficient = def.minSources ? readySelectedIds.length < def.minSources : noSources;
              return (
                <button
                  key={type}
                  disabled={!aiConfigured || insufficient}
                  onClick={() => setPendingType(type)}
                  title={
                    !aiConfigured
                      ? "Needs an AI provider (search mode is active)"
                      : insufficient
                        ? def.minSources
                          ? `Select at least ${def.minSources} sources`
                          : "Select at least one source"
                        : def.description
                  }
                  className="group flex items-center gap-2 rounded-xl border bg-background px-2.5 py-2.5 text-left text-[13px] font-medium transition hover:border-brand/50 hover:bg-brand-soft/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon className="size-4 shrink-0 text-brand" />
                  <span className="truncate">{def.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Generated</p>
          {artifacts === null ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full rounded-xl" />
              <Skeleton className="h-14 w-full rounded-xl" />
            </div>
          ) : artifacts.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
              <Sparkles className="mx-auto mb-2 size-5 text-brand/70" />
              Study guides, quizzes and other outputs you create will appear here.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {artifacts.map((a) => {
                const Icon = STUDIO_ICONS[a.type];
                return (
                  <li key={a.id}>
                    <button onClick={() => setOpenId(a.id)} className="flex w-full items-center gap-3 rounded-xl border bg-background px-3 py-2.5 text-left transition hover:bg-muted/50">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                        {a.status === "generating" ? <Loader2 className="size-4 animate-spin" /> : a.status === "failed" ? <TriangleAlert className="size-4 text-destructive" /> : <Icon className="size-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{a.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {a.status === "generating" ? "Generating…" : a.status === "failed" ? "Failed — tap to retry" : `${STUDIO_DEFINITIONS[a.type].label} · ${timeAgo(a.updated_at)}`}
                        </span>
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <Dialog open={!!pendingType} onOpenChange={(o) => !o && setPendingType(null)}>
        <DialogContent className="sm:max-w-md">
          {pendingDef && (
            <>
              <DialogHeader>
                <DialogTitle>Create {pendingDef.label.toLowerCase()}</DialogTitle>
                <DialogDescription>
                  {pendingDef.description} Uses your {readySelectedIds.length} selected source{readySelectedIds.length === 1 ? "" : "s"}.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-2 space-y-1.5">
                <Label htmlFor="studio-focus">
                  Focus or instructions <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea id="studio-focus" rows={3} maxLength={500} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. Focus on chapters 3–5, for an undergraduate exam." />
              </div>
              <DialogFooter className="mt-4">
                <Button variant="ghost" onClick={() => setPendingType(null)}>
                  Cancel
                </Button>
                <Button disabled={creating} onClick={() => pendingType && create(pendingType)}>
                  {creating ? <Loader2 className="animate-spin" /> : <Sparkles />} Generate
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ArtifactViewer
        artifact={open}
        onOpenChange={(o) => !o && setOpenId(null)}
        onChanged={upsert}
        onDeleted={(id) => setArtifacts((xs) => xs?.filter((x) => x.id !== id) ?? null)}
      />
    </div>
  );
}
