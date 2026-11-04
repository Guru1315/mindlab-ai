"use client";

import { FileUp, Globe, Loader2, Type, UploadCloud, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/client/api";
import { formatBytes } from "@/lib/format";
import { ACCEPTED_FILE_TYPES, detectFileKind, mimeTypeForKind, sanitizeFileName } from "@/lib/ingestion/validation";
import { createClient } from "@/lib/supabase/client";
import type { Source } from "@/lib/types";
import { useWorkspace } from "../workspace-context";

/** Client-side guard; the server re-validates size, type and content. */
const MAX_FILE_MB = 25;

interface PendingFile {
  file: File;
  error?: string;
}

export function AddSourcesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { notebook, userId, setSources } = useWorkspace();
  const [tab, setTab] = useState("upload");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [urls, setUrls] = useState("");
  const [text, setText] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFiles([]);
    setUrls("");
    setText("");
    setTextTitle("");
    setProgress(0);
  }

  function addFiles(list: FileList | File[]) {
    const next = Array.from(list).map((file): PendingFile => {
      try {
        detectFileKind(file.name, file.type);
      } catch (e) {
        return { file, error: errorMessage(e) };
      }
      if (file.size === 0) return { file, error: "File is empty." };
      if (file.size > MAX_FILE_MB * 1024 * 1024) return { file, error: `Larger than ${MAX_FILE_MB} MB.` };
      return { file };
    });
    setFiles((prev) => [...prev, ...next].slice(0, 20));
  }

  function created(sources: Source[]) {
    setSources((xs) => [...xs, ...sources]);
    toast.success(sources.length === 1 ? "Source added — processing…" : `${sources.length} sources added — processing…`);
    reset();
    onOpenChange(false);
  }

  async function uploadFiles() {
    const valid = files.filter((f) => !f.error);
    if (!valid.length) return;
    setBusy(true);
    setProgress(0);
    const supabase = createClient();
    const uploaded: { storagePath: string; fileName: string; mimeType: string; size: number }[] = [];
    try {
      // Files go straight to private storage under the user's own folder
      // (enforced by storage RLS), avoiding serverless request-size limits.
      for (const [i, { file }] of valid.entries()) {
        const kind = detectFileKind(file.name, file.type);
        const storagePath = `${userId}/${notebook.id}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
        const { error } = await supabase.storage.from("sources").upload(storagePath, file, {
          contentType: mimeTypeForKind(kind),
          upsert: false,
        });
        if (error) throw new Error(`Upload failed for ${file.name}: ${error.message}`);
        uploaded.push({ storagePath, fileName: file.name, mimeType: mimeTypeForKind(kind), size: file.size });
        setProgress(Math.round(((i + 1) / valid.length) * 100));
      }
      const { sources } = await api<{ sources: Source[] }>(`/api/notebooks/${notebook.id}/sources`, {
        method: "POST",
        json: { type: "file", files: uploaded },
      });
      created(sources);
    } catch (error) {
      toast.error(errorMessage(error));
      if (uploaded.length) await supabase.storage.from("sources").remove(uploaded.map((u) => u.storagePath));
    } finally {
      setBusy(false);
    }
  }

  async function addUrls() {
    const list = urls
      .split(/\s+/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (!list.length) return;
    setBusy(true);
    try {
      const { sources } = await api<{ sources: Source[] }>(`/api/notebooks/${notebook.id}/sources`, { method: "POST", json: { type: "url", urls: list.slice(0, 10) } });
      created(sources);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function addText() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const { sources } = await api<{ sources: Source[] }>(`/api/notebooks/${notebook.id}/sources`, {
        method: "POST",
        json: { type: "text", text, title: textTitle.trim() || undefined },
      });
      created(sources);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const validCount = files.filter((f) => !f.error).length;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add sources</DialogTitle>
          <DialogDescription>MindLab answers using only the sources you add to this notebook.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab} className="mt-2">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="upload">
              <FileUp /> Upload
            </TabsTrigger>
            <TabsTrigger value="url">
              <Globe /> Website
            </TabsTrigger>
            <TabsTrigger value="text">
              <Type /> Paste text
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="mt-4 space-y-3">
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${dragging ? "border-brand bg-brand-soft/50" : "hover:border-brand/50 hover:bg-muted/50"}`}
            >
              <UploadCloud className="size-8 text-brand" />
              <p className="mt-3 text-sm font-medium">Drop files here or click to browse</p>
              <p className="mt-1 text-xs text-muted-foreground">PDF, DOCX, TXT, Markdown · up to {MAX_FILE_MB} MB each</p>
              <input
                ref={inputRef}
                type="file"
                multiple
                hidden
                accept={ACCEPTED_FILE_TYPES}
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {files.length > 0 && (
              <ul className="max-h-48 space-y-1.5 overflow-y-auto">
                {files.map((f, i) => (
                  <li key={`${f.file.name}-${i}`} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{f.file.name}</span>
                    {f.error ? <span className="shrink-0 text-xs text-destructive">{f.error}</span> : <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(f.file.size)}</span>}
                    <button aria-label={`Remove ${f.file.name}`} disabled={busy} onClick={() => setFiles((xs) => xs.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground">
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {busy && <Progress value={progress} />}
            <Button className="w-full" disabled={busy || validCount === 0} onClick={uploadFiles}>
              {busy && <Loader2 className="animate-spin" />}
              {validCount ? `Upload ${validCount} file${validCount === 1 ? "" : "s"}` : "Upload"}
            </Button>
          </TabsContent>

          <TabsContent value="url" className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="urls">Web page URLs</Label>
              <Textarea id="urls" rows={4} placeholder={"https://example.com/article\nhttps://another.org/page"} value={urls} onChange={(e) => setUrls(e.target.value)} />
              <p className="text-xs text-muted-foreground">One per line, up to 10. Only the page&apos;s readable text is imported; paywalled or login-only pages won&apos;t work.</p>
            </div>
            <Button className="w-full" disabled={busy || !urls.trim()} onClick={addUrls}>
              {busy && <Loader2 className="animate-spin" />} Add websites
            </Button>
          </TabsContent>

          <TabsContent value="text" className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="text-title">Title <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="text-title" maxLength={200} value={textTitle} onChange={(e) => setTextTitle(e.target.value)} placeholder="Meeting notes" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="text-body">Text</Label>
              <Textarea id="text-body" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste notes, transcripts, articles…" className="max-h-72" />
              <p className="text-xs text-muted-foreground">{text.length.toLocaleString()} characters</p>
            </div>
            <Button className="w-full" disabled={busy || !text.trim()} onClick={addText}>
              {busy && <Loader2 className="animate-spin" />} Add text
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
