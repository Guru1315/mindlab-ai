"use client";

import { Check, Copy, Link2, Loader2, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { HeaderPortal } from "@/components/app/header-slot";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/client/api";
import { useWorkspace } from "./workspace-context";

export function NotebookHeader() {
  const { notebook, updateNotebook } = useWorkspace();
  const [title, setTitle] = useState(notebook.title);
  const [shareOpen, setShareOpen] = useState(false);
  // Follow external title changes (adjusting state during render, not in an effect).
  const [syncedTitle, setSyncedTitle] = useState(notebook.title);
  if (notebook.title !== syncedTitle) {
    setSyncedTitle(notebook.title);
    setTitle(notebook.title);
  }

  const commit = () => {
    const next = title.trim();
    if (!next) setTitle(notebook.title);
    else if (next !== notebook.title) updateNotebook({ title: next });
  };

  return (
    <HeaderPortal>
      <span className="ml-1 hidden h-5 w-px bg-border sm:block" />
      <span className="text-lg" aria-hidden="true">{notebook.emoji}</span>
      <input
        aria-label="Notebook title"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setTitle(notebook.title);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1.5 py-1 text-sm font-medium outline-none hover:bg-muted focus:bg-muted sm:max-w-md"
      />
      <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={() => setShareOpen(true)}>
        <Share2 /> <span className="max-sm:hidden">Share</span>
      </Button>
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} />
    </HeaderPortal>
  );
}

function ShareDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { notebook, setNotebookLocal } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = notebook.share_enabled && notebook.share_token && typeof window !== "undefined" ? `${window.location.origin}/share/${notebook.share_token}` : "";

  async function setShare(enabled: boolean, rotate = false) {
    setBusy(true);
    try {
      const data = await api<{ share_enabled: boolean; share_token: string | null }>(`/api/notebooks/${notebook.id}/share`, {
        method: "POST",
        json: { enabled, rotate },
      });
      setNotebookLocal(data);
      if (rotate) toast.success("New link created. The old link no longer works.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share notebook</DialogTitle>
          <DialogDescription>
            Anyone with the link can view this notebook&apos;s overview, source list and Studio items (read-only). Your original files,
            extracted text, chats and audio stay private.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex items-center justify-between rounded-xl border p-3">
          <div>
            <p className="text-sm font-medium">Read-only link</p>
            <p className="text-xs text-muted-foreground">{notebook.share_enabled ? "Anyone with the link can view" : "Only you can access"}</p>
          </div>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Switch checked={notebook.share_enabled} onCheckedChange={(v) => setShare(v)} aria-label="Enable share link" />}
        </div>
        {link && (
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              <Input readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy link"
                onClick={async () => {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setShare(true, true)}>
              <Link2 /> Reset link
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
