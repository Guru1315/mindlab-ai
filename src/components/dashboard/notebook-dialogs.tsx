"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const NOTEBOOK_EMOJIS = ["📓", "🧠", "🔬", "📚", "🧪", "🌍", "💡", "📈", "⚖️", "🩺", "🎨", "🛰️", "🧬", "🏛️", "🎧", "✍️"];

export interface NotebookFormValues {
  title: string;
  description: string;
  emoji: string;
}

export function NotebookFormDialog({
  open,
  onOpenChange,
  initial,
  mode,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<NotebookFormValues>;
  mode: "create" | "edit";
  onSubmit: (values: NotebookFormValues) => Promise<void>;
}) {
  // DialogContent unmounts when closed, so the form starts from `initial` on every open.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <NotebookForm initial={initial} mode={mode} onSubmit={onSubmit} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NotebookForm({
  initial,
  mode,
  onSubmit,
  onClose,
}: {
  initial?: Partial<NotebookFormValues>;
  mode: "create" | "edit";
  onSubmit: (values: NotebookFormValues) => Promise<void>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<NotebookFormValues>({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    emoji: initial?.emoji ?? "📓",
  });
  const [saving, setSaving] = useState(false);
  const onOpenChange = (open: boolean) => !open && onClose();

  return (
    <>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await onSubmit({ ...values, title: values.title.trim() || "Untitled notebook" });
            onOpenChange(false);
          } finally {
            setSaving(false);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New notebook" : "Edit notebook"}</DialogTitle>
          <DialogDescription>
            {mode === "create" ? "Give your notebook a name. You can add sources next." : "Update the notebook's name, icon and description."}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-1.5">
              {NOTEBOOK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`Use ${emoji}`}
                  aria-pressed={values.emoji === emoji}
                  onClick={() => setValues((v) => ({ ...v, emoji }))}
                  className={`grid size-9 place-items-center rounded-lg border text-lg transition ${values.emoji === emoji ? "border-brand bg-brand-soft" : "hover:bg-muted"}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nb-title">Name</Label>
            <Input
              id="nb-title"
              autoFocus
              maxLength={200}
              placeholder="e.g. Thesis literature review"
              value={values.title}
              onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nb-desc">
              Description <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="nb-desc"
              rows={3}
              maxLength={2000}
              value={values.description}
              onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter className="mt-6">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {mode === "create" ? "Create notebook" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
