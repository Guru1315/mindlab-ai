"use client";

import { AudioLines, ChevronDown, FileText, Headphones, Loader2, Settings2, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/dashboard/notebook-dialogs";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { GEMINI_VOICES } from "@/lib/ai/voices";
import { AUDIO_FORMATS, LENGTH_LABELS } from "@/lib/audio/formats";
import { api, errorMessage } from "@/lib/client/api";
import { formatDuration, timeAgo } from "@/lib/format";
import type { AudioFormat, AudioGeneration, AudioLength } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "../workspace-context";
import { AudioPlayer } from "./audio-player";

type AudioItem = AudioGeneration & { url: string | null };

const STATUS_LABEL: Record<AudioGeneration["status"], string> = {
  queued: "Queued…",
  scripting: "Writing the script from your sources…",
  synthesizing: "Recording voices…",
  encoding: "Finishing audio…",
  ready: "Ready",
  failed: "Failed",
};

const inProgress = (a: AudioGeneration) => a.status !== "ready" && a.status !== "failed";

export function AudioOverview() {
  const { notebook, readySelectedIds, aiConfigured } = useWorkspace();
  const [items, setItems] = useState<AudioItem[] | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    const { audio } = await api<{ audio: AudioItem[] }>(`/api/notebooks/${notebook.id}/audio`);
    setItems(audio);
  }, [notebook.id]);

  useEffect(() => {
    let cancelled = false;
    api<{ audio: AudioItem[] }>(`/api/notebooks/${notebook.id}/audio`)
      .then(({ audio }) => !cancelled && setItems(audio))
      .catch((e) => {
        if (cancelled) return;
        toast.error(errorMessage(e));
        setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [notebook.id]);

  const generating = items?.some(inProgress) ?? false;
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => load().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [generating, load]);

  async function start(options: { format: AudioFormat; length: AudioLength; focus?: string; hostVoice?: string; guestVoice?: string }) {
    setStarting(true);
    try {
      const { audio } = await api<{ audio: AudioItem }>(`/api/notebooks/${notebook.id}/audio`, {
        method: "POST",
        json: { ...options, sourceIds: readySelectedIds },
      });
      setItems((xs) => [audio, ...(xs ?? [])]);
      setCustomizeOpen(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setStarting(false);
    }
  }

  const latest = items?.[0];
  const history = items?.slice(1) ?? [];
  const disabled = !aiConfigured || readySelectedIds.length === 0 || starting || generating;

  return (
    <div className="rounded-2xl border bg-gradient-to-br from-brand-soft/70 to-transparent p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand text-brand-foreground">
          <Headphones className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Audio overview</h3>
          <p className="text-xs text-muted-foreground">A podcast-style conversation about your selected sources.</p>
        </div>
      </div>

      {items === null ? (
        <div className="mt-4 h-16 animate-pulse rounded-xl bg-muted" />
      ) : latest ? (
        <div className="mt-4">
          <AudioCard item={latest} onChanged={load} onDeleted={(id) => setItems((xs) => xs?.filter((x) => x.id !== id) ?? null)} />
        </div>
      ) : null}

      <div className="mt-3 flex gap-2">
        <Button className="flex-1" size="sm" disabled={disabled} onClick={() => start({ format: "deep_dive", length: "default" })}>
          {starting ? <Loader2 className="animate-spin" /> : <AudioLines />}
          {latest ? "Generate new" : "Generate"}
        </Button>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => setCustomizeOpen(true)}>
          <Settings2 /> Customize
        </Button>
      </div>
      {!aiConfigured ? (
        <p className="mt-2 text-xs text-muted-foreground">Audio overviews need an AI provider; this server is running in search mode.</p>
      ) : (
        readySelectedIds.length === 0 && <p className="mt-2 text-xs text-muted-foreground">Select at least one processed source.</p>
      )}

      {history.length > 0 && (
        <Collapsible className="mt-3">
          <CollapsibleTrigger className="group flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground">
            Previous overviews ({history.length})
            <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            {history.map((item) => (
              <AudioCard key={item.id} item={item} compact onChanged={load} onDeleted={(id) => setItems((xs) => xs?.filter((x) => x.id !== id) ?? null)} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      <CustomizeDialog open={customizeOpen} onOpenChange={setCustomizeOpen} onSubmit={start} busy={starting} />
    </div>
  );
}

function AudioCard({ item, compact, onChanged, onDeleted }: { item: AudioItem; compact?: boolean; onChanged: () => void; onDeleted: (id: string) => void }) {
  const [expanded, setExpanded] = useState(!compact);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const format = AUDIO_FORMATS[item.format];

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-start gap-2">
        <button className="min-w-0 flex-1 text-left" onClick={() => setExpanded((e) => !e)}>
          <p className="truncate text-sm font-medium">{item.title ?? `${format.label} overview`}</p>
          <p className="text-xs text-muted-foreground">
            {format.label} · {LENGTH_LABELS[item.length]}
            {item.duration_seconds ? ` · ${formatDuration(Number(item.duration_seconds))}` : ""} · {timeAgo(item.created_at)}
          </p>
        </button>
        {item.status === "ready" && item.script && (
          <Button variant="ghost" size="icon-sm" onClick={() => setTranscriptOpen(true)} aria-label="View transcript">
            <FileText />
          </Button>
        )}
        {!inProgress(item) && (
          <Button variant="ghost" size="icon-sm" onClick={() => setConfirmDelete(true)} aria-label="Delete audio overview">
            <Trash2 />
          </Button>
        )}
      </div>

      {inProgress(item) && (
        <div className="mt-3 space-y-1.5">
          <Progress value={item.progress} className="h-1.5" />
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> {STATUS_LABEL[item.status]} This takes a few minutes.
          </p>
        </div>
      )}
      {item.status === "failed" && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {item.error ?? "Generation failed."}
        </p>
      )}
      {item.status === "ready" && item.url && expanded && (
        <div className="mt-3">
          <AudioPlayer src={item.url} downloadHref={`/api/audio/${item.id}/download`} initialDuration={item.duration_seconds} onError={onChanged} />
        </div>
      )}

      <Dialog open={transcriptOpen} onOpenChange={setTranscriptOpen}>
        <DialogContent className="max-h-[85dvh] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{item.title ?? "Transcript"}</DialogTitle>
            <DialogDescription>Script generated from your sources and used for the audio.</DialogDescription>
          </DialogHeader>
          <div className="scrollbar-thin -mx-6 max-h-[65dvh] space-y-3 overflow-y-auto px-6">
            {item.script?.lines.map((line, i) => (
              <p key={i} className="text-sm leading-relaxed">
                <span className={cn("mr-2 font-semibold", line.speaker === item.script?.speakers[0] ? "text-brand" : "text-chart-4")}>{line.speaker}</span>
                {line.text}
              </p>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this audio overview?"
        description="The audio file and its transcript will be permanently deleted."
        onConfirm={async () => {
          try {
            await api(`/api/audio/${item.id}`, { method: "DELETE" });
            onDeleted(item.id);
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />
    </div>
  );
}

function CustomizeDialog({
  open,
  onOpenChange,
  onSubmit,
  busy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (o: { format: AudioFormat; length: AudioLength; focus?: string; hostVoice?: string; guestVoice?: string }) => void;
  busy: boolean;
}) {
  const [format, setFormat] = useState<AudioFormat>("deep_dive");
  const [length, setLength] = useState<AudioLength>("default");
  const [focus, setFocus] = useState("");
  const [hostVoice, setHostVoice] = useState<string>("");
  const [guestVoice, setGuestVoice] = useState<string>("");
  const twoSpeakers = AUDIO_FORMATS[format].speakers.length === 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Customize audio overview</DialogTitle>
          <DialogDescription>Choose a format and tell the hosts what to focus on.</DialogDescription>
        </DialogHeader>
        <div className="mt-2 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(AUDIO_FORMATS) as AudioFormat[]).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                aria-pressed={format === f}
                className={cn("rounded-xl border p-3 text-left transition", format === f ? "border-brand bg-brand-soft/50" : "hover:bg-muted/60")}
              >
                <p className="text-sm font-medium">{AUDIO_FORMATS[f].label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{AUDIO_FORMATS[f].description}</p>
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label>Length</Label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(LENGTH_LABELS) as AudioLength[]).map((l) => (
                <Button key={l} type="button" variant={length === l ? "default" : "outline"} size="sm" onClick={() => setLength(l)}>
                  {LENGTH_LABELS[l]}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audio-focus">What should the episode focus on? <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="audio-focus" rows={3} maxLength={1000} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. Explain the methodology for a beginner, and skip the history section." />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <VoiceSelect label="Host voice (Alex)" value={hostVoice} onChange={setHostVoice} />
            {twoSpeakers && <VoiceSelect label="Co-host voice (Sam)" value={guestVoice} onChange={setGuestVoice} />}
          </div>
        </div>
        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() => onSubmit({ format, length, focus: focus.trim() || undefined, hostVoice: hostVoice || undefined, guestVoice: twoSpeakers ? guestVoice || undefined : undefined })}
          >
            {busy && <Loader2 className="animate-spin" />} Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoiceSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value || "default"} onValueChange={(v) => onChange(v === "default" ? "" : v)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value="default">From my settings</SelectItem>
          {GEMINI_VOICES.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
