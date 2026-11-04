"use client";

import { Download, Eye, Loader2, Pencil, RefreshCw, Save, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/dashboard/notebook-dialogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/client/api";
import { timeAgo } from "@/lib/format";
import { STUDIO_DEFINITIONS } from "@/lib/studio/definitions";
import type { Flashcard, GeneratedArtifact } from "@/lib/types";
import { Markdown } from "../chat/markdown";
import { useWorkspace } from "../workspace-context";
import { FlashcardDeck, FlashcardEditor } from "./flashcards";
import { MindMap } from "./mind-map";
import { QuizPlayer } from "./quiz";
import { STUDIO_ICONS } from "./studio-icons";

export function ArtifactViewer({
  artifact,
  onOpenChange,
  onChanged,
  onDeleted,
}: {
  artifact: GeneratedArtifact | null;
  onOpenChange: (open: boolean) => void;
  onChanged: (artifact: GeneratedArtifact) => void;
  onDeleted: (id: string) => void;
}) {
  const { askQuestion } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset local edit state only when a different artifact (or a new version) is
  // shown, not when polling hands us an identical copy. Done during render.
  const version = artifact ? `${artifact.id}:${artifact.updated_at}` : null;
  const [seenVersion, setSeenVersion] = useState<string | null>(null);
  if (artifact && version !== seenVersion) {
    setSeenVersion(version);
    setEditing(false);
    setTitle(artifact.title);
    setContent(artifact.content ?? "");
    setCards(artifact.data?.kind === "flashcards" ? artifact.data.cards : []);
  }

  if (!artifact) return null;
  const def = STUDIO_DEFINITIONS[artifact.type];
  const Icon = STUDIO_ICONS[artifact.type];
  const editable = artifact.status === "ready" && (def.output === "markdown" || artifact.type === "flashcards");

  async function save() {
    if (!artifact) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { title: title.trim() || artifact.title };
      if (def.output === "markdown") body.content = content;
      if (artifact.type === "flashcards") body.data = { kind: "flashcards", cards };
      const { artifact: updated } = await api<{ artifact: GeneratedArtifact }>(`/api/artifacts/${artifact.id}`, { method: "PATCH", json: body });
      onChanged(updated);
      setEditing(false);
      toast.success("Changes saved");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function regenerate() {
    if (!artifact) return;
    try {
      const { artifact: updated } = await api<{ artifact: GeneratedArtifact }>(`/api/artifacts/${artifact.id}/regenerate`, { method: "POST", json: {} });
      onChanged(updated);
      toast.success("Regenerating…");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Dialog open={!!artifact} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92dvh] max-w-none flex-col gap-0 p-0 sm:max-w-4xl">
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3 pr-12">
          <span className="grid size-8 place-items-center rounded-lg bg-brand-soft text-brand">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            {editing ? (
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} className="h-8" aria-label="Title" />
            ) : (
              <DialogTitle className="truncate">{artifact.title}</DialogTitle>
            )}
            <DialogDescription className="text-xs">
              {def.label} · {artifact.source_ids.length} source{artifact.source_ids.length === 1 ? "" : "s"} · updated {timeAgo(artifact.updated_at)}
            </DialogDescription>
          </div>
          {artifact.status === "ready" && (
            <div className="flex items-center gap-1">
              {editable &&
                (editing ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                      <Eye /> Preview
                    </Button>
                    <Button size="sm" onClick={save} disabled={saving}>
                      {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                    <Pencil /> Edit
                  </Button>
                ))}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <Download /> Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <a href={`/api/artifacts/${artifact.id}/export?format=md`}>Markdown (.md)</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`/api/artifacts/${artifact.id}/export?format=json`}>JSON (.json)</a>
                  </DropdownMenuItem>
                  {artifact.type === "flashcards" && (
                    <DropdownMenuItem asChild>
                      <a href={`/api/artifacts/${artifact.id}/export?format=csv`}>CSV for flashcard apps</a>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="icon-sm" onClick={regenerate} aria-label="Regenerate">
                <RefreshCw />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => setConfirmDelete(true)} aria-label="Delete">
                <Trash2 />
              </Button>
            </div>
          )}
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
          {artifact.status === "generating" && (
            <div className="mx-auto max-w-2xl space-y-3">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-brand" /> Generating {def.label.toLowerCase()} from your sources…
              </p>
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-full" />
            </div>
          )}
          {artifact.status === "failed" && (
            <div className="mx-auto max-w-md py-10 text-center">
              <TriangleAlert className="mx-auto size-8 text-destructive" />
              <p className="mt-3 font-medium">Generation failed</p>
              <p className="mt-1 text-sm text-muted-foreground">{artifact.error ?? "Please try again."}</p>
              <div className="mt-5 flex justify-center gap-2">
                <Button onClick={regenerate}>
                  <RefreshCw /> Try again
                </Button>
                <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </div>
            </div>
          )}
          {artifact.status === "ready" && (
            <div className="mx-auto max-w-3xl">
              {def.output === "markdown" &&
                (editing ? (
                  <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[60dvh] font-mono text-sm" aria-label="Edit content (Markdown)" />
                ) : (
                  <Markdown content={artifact.content ?? ""} />
                ))}
              {artifact.data?.kind === "flashcards" && (editing ? <FlashcardEditor cards={cards} onChange={setCards} /> : <FlashcardDeck key={version} cards={artifact.data.cards} />)}
              {artifact.data?.kind === "quiz" && <QuizPlayer key={version} questions={artifact.data.questions} />}
              {artifact.data?.kind === "mind_map" && (
                <MindMap
                  root={artifact.data.root}
                  onAsk={(q) => {
                    onOpenChange(false);
                    askQuestion(q);
                  }}
                />
              )}
            </div>
          )}
        </div>
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this item?"
          description={`“${artifact.title}” will be permanently deleted.`}
          onConfirm={async () => {
            try {
              await api(`/api/artifacts/${artifact.id}`, { method: "DELETE" });
              onDeleted(artifact.id);
              onOpenChange(false);
            } catch (error) {
              toast.error(errorMessage(error));
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
