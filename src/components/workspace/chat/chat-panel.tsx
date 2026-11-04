"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  Bookmark,
  BookmarkCheck,
  Check,
  Copy,
  Loader2,
  MoreVertical,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/dashboard/notebook-dialogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, ApiError, errorMessage } from "@/lib/client/api";
import { readNdjson } from "@/lib/client/chat-stream";
import { timeAgo } from "@/lib/format";
import type { Citation, Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "../workspace-context";
import { Markdown } from "./markdown";

type ChatMessage = Pick<Message, "id" | "role" | "content" | "citations" | "follow_up_questions" | "status" | "is_saved"> & {
  /** Candidate passages while streaming, before citations are validated. */
  passages?: Citation[];
  streaming?: boolean;
  errorText?: string;
};

export function ChatPanel() {
  const { notebook, readySelectedIds, sources, openSource, registerAsk, setNotebookLocal, aiConfigured } = useWorkspace();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [refreshingSuggestions, setRefreshingSuggestions] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ conversation: { id: string } | null; messages: Message[] }>(`/api/notebooks/${notebook.id}/chat`)
      .then(({ conversation, messages }) => {
        if (cancelled) return;
        setConversationId(conversation?.id);
        setMessages(messages);
      })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [notebook.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: streaming ? "auto" : "smooth" });
  }, [messages, streaming]);

  const send = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || streaming) return;
      setInput("");
      setStreaming(true);
      const tempUser: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: q,
        citations: [],
        follow_up_questions: [],
        status: "complete",
        is_saved: false,
      };
      const assistantId = `a-${Date.now()}`;
      const tempAssistant: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        citations: [],
        follow_up_questions: [],
        status: "streaming",
        is_saved: false,
        streaming: true,
      };
      setMessages((m) => [...m, tempUser, tempAssistant]);
      const patch = (fn: (m: ChatMessage) => ChatMessage) => setMessages((ms) => ms.map((m) => (m.id === assistantId ? fn(m) : m)));

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await fetch(`/api/notebooks/${notebook.id}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q, sourceIds: readySelectedIds, conversationId }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => ({}));
          throw new ApiError(body.error ?? `Request failed (${response.status})`, response.status, body.code);
        }
        for await (const event of readNdjson(response.body)) {
          if (event.type === "start") setConversationId(event.conversationId);
          else if (event.type === "passages") patch((m) => ({ ...m, passages: event.citations }));
          else if (event.type === "delta") patch((m) => ({ ...m, content: m.content + event.text }));
          else if (event.type === "final") patch((m) => ({ ...m, content: event.text, citations: event.citations, passages: undefined }));
          else if (event.type === "followups") patch((m) => ({ ...m, follow_up_questions: event.questions }));
          else if (event.type === "done") patch((m) => ({ ...m, id: event.messageId ?? m.id, status: "complete", streaming: false }));
          else if (event.type === "error")
            patch((m) => ({ ...m, id: event.messageId ?? m.id, status: "error", streaming: false, errorText: event.error }));
        }
      } catch (error) {
        if (controller.signal.aborted) {
          patch((m) => ({
            ...m,
            status: "stopped",
            streaming: false,
            passages: undefined,
            citations: m.citations.length ? m.citations : (m.passages ?? []),
          }));
          // The server stores the partial answer; reload to get its id and validated citations.
          setTimeout(() => {
            api<{ messages: Message[] }>(`/api/notebooks/${notebook.id}/chat`)
              .then(({ messages }) => setMessages(messages))
              .catch(() => {});
          }, 800);
        } else {
          patch((m) => ({ ...m, status: "error", streaming: false, errorText: errorMessage(error) }));
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        textareaRef.current?.focus();
      }
    },
    [streaming, notebook.id, readySelectedIds, conversationId],
  );

  useEffect(() => registerAsk((q) => send(q)), [registerAsk, send]);

  const openCitation = useCallback(
    (c: Citation) => openSource({ sourceId: c.sourceId, highlight: { start: c.charStart, end: c.charEnd }, page: c.pageStart }),
    [openSource],
  );

  async function toggleSaved(m: ChatMessage) {
    if (m.id.startsWith("a-")) return;
    setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, is_saved: !m.is_saved } : x)));
    try {
      await api(`/api/messages/${m.id}`, { method: "PATCH", json: { is_saved: !m.is_saved } });
      toast.success(m.is_saved ? "Removed from saved responses" : "Saved to notebook");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function refreshSuggestions() {
    setRefreshingSuggestions(true);
    try {
      const data = await api<{ summary: string | null; suggested_questions: string[] }>(`/api/notebooks/${notebook.id}/overview`, { method: "POST" });
      setNotebookLocal(data);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRefreshingSuggestions(false);
    }
  }

  const readyCount = sources.filter((s) => s.status === "ready").length;
  const lastUserQuestion = [...messages].reverse().find((m) => m.role === "user")?.content;
  const suggestions = (notebook.suggested_questions ?? []).slice(0, 3);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Chat</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {readySelectedIds.length} of {readyCount} sources
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Chat options">
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setSavedOpen(true)}>
              <Bookmark /> Saved responses
            </DropdownMenuItem>
            <DropdownMenuItem disabled={refreshingSuggestions || readyCount === 0 || !aiConfigured} onClick={refreshSuggestions}>
              <Sparkles /> Refresh suggested questions
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={messages.length === 0 || streaming} onClick={() => setConfirmClear(true)}>
              <Trash2 /> Clear chat history
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
            </div>
          ) : messages.length === 0 ? (
            <ChatEmptyState
              summary={notebook.summary}
              emoji={notebook.emoji}
              title={notebook.title}
              hasSources={readyCount > 0}
              suggestions={suggestions}
              onAsk={send}
            />
          ) : (
            <div className="space-y-6">
              <AnimatePresence initial={false}>
                {messages.map((m, i) => (
                  <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                    {m.role === "user" ? (
                      <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[0.925rem] whitespace-pre-wrap text-primary-foreground">
                        {m.content}
                      </div>
                    ) : (
                      <AssistantMessage
                        message={m}
                        isLast={i === messages.length - 1}
                        onOpenCitation={openCitation}
                        onToggleSaved={() => toggleSaved(m)}
                        onRegenerate={lastUserQuestion && i === messages.length - 1 && !streaming ? () => send(lastUserQuestion) : undefined}
                        onAsk={send}
                        disabled={streaming}
                      />
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t p-3">
        {messages.length > 0 && suggestions.length > 0 && !streaming && (
          <div className="scrollbar-thin mx-auto mb-2 flex max-w-3xl gap-2 overflow-x-auto pb-1">
            {suggestions.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                className="shrink-0 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground transition hover:border-brand/50 hover:text-foreground"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <form
          className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/40"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder={
              readySelectedIds.length
                ? aiConfigured
                  ? "Ask about your sources…"
                  : "Search your sources…"
                : readyCount
                  ? "Select at least one source to ask questions"
                  : "Add a source to start asking questions"
            }
            aria-label="Ask a question"
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-[0.925rem] outline-none [field-sizing:content] placeholder:text-muted-foreground"
          />
          {streaming ? (
            <Button type="button" size="icon" variant="secondary" onClick={() => abortRef.current?.abort()} aria-label="Stop generating">
              <Square className="fill-current" />
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Send">
              <ArrowUp />
            </Button>
          )}
        </form>
        <p className="mx-auto mt-1.5 max-w-3xl text-center text-[11px] text-muted-foreground">
          {aiConfigured
            ? "Answers are generated from your selected sources and can still contain mistakes. Check the citations."
            : "Search mode: replies quote the best-matching passages from your selected sources."}
        </p>
      </div>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear chat history?"
        description="All messages in this notebook's chat will be deleted, including saved responses."
        confirmLabel="Clear history"
        onConfirm={async () => {
          try {
            await api(`/api/notebooks/${notebook.id}/chat`, { method: "DELETE" });
            setMessages([]);
            setConversationId(undefined);
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />
      <SavedResponsesDialog open={savedOpen} onOpenChange={setSavedOpen} notebookId={notebook.id} onOpenCitation={openCitation} />
    </div>
  );
}

function ChatEmptyState({
  summary,
  emoji,
  title,
  hasSources,
  suggestions,
  onAsk,
}: {
  summary: string | null;
  emoji: string;
  title: string;
  hasSources: boolean;
  suggestions: string[];
  onAsk: (q: string) => void;
}) {
  return (
    <div className="py-6">
      <span className="grid size-12 place-items-center rounded-2xl bg-muted text-2xl">{emoji}</span>
      <h3 className="mt-4 font-display text-3xl tracking-tight">{title}</h3>
      {summary ? (
        <p className="mt-3 text-[0.925rem] leading-relaxed text-foreground/85">{summary}</p>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {hasSources
            ? "Ask anything about your sources. Answers include citations you can click to see the original passage."
            : "Add sources in the left panel. Once they're processed, you can ask questions about them here."}
        </p>
      )}
      {suggestions.length > 0 && (
        <div className="mt-6 space-y-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Suggested questions</p>
          {suggestions.map((q) => (
            <button
              key={q}
              onClick={() => onAsk(q)}
              className="flex w-full items-start gap-2 rounded-xl border bg-background px-4 py-3 text-left text-sm transition hover:border-brand/50 hover:bg-brand-soft/30"
            >
              <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" />
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AssistantMessage({
  message,
  isLast,
  onOpenCitation,
  onToggleSaved,
  onRegenerate,
  onAsk,
  disabled,
}: {
  message: ChatMessage;
  isLast: boolean;
  onOpenCitation: (c: Citation) => void;
  onToggleSaved: () => void;
  onRegenerate?: () => void;
  onAsk: (q: string) => void;
  disabled: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const citations = message.passages ?? message.citations;
  const persisted = !message.id.startsWith("a-");

  return (
    <div className="group">
      {message.streaming && !message.content ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-brand" />
          {message.passages ? "Writing answer…" : "Searching your sources…"}
        </div>
      ) : (
        <Markdown content={message.content} citations={citations} onOpen={onOpenCitation} />
      )}
      {message.streaming && message.content && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-brand align-middle" />}

      {message.status === "error" && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-destructive">
          <TriangleAlert className="size-4" /> {message.errorText ?? "This answer could not be completed."}
        </p>
      )}
      {message.status === "stopped" && <p className="mt-2 text-xs text-muted-foreground">Generation stopped.</p>}

      {!message.streaming && (
        <div className={cn("mt-2 flex items-center gap-0.5 transition", !isLast && "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
          <ActionButton
            label={copied ? "Copied" : "Copy"}
            onClick={async () => {
              await navigator.clipboard.writeText(message.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check /> : <Copy />}
          </ActionButton>
          {persisted && message.content && (
            <ActionButton label={message.is_saved ? "Remove from saved" : "Save response"} onClick={onToggleSaved}>
              {message.is_saved ? <BookmarkCheck className="text-brand" /> : <Bookmark />}
            </ActionButton>
          )}
          {onRegenerate && (
            <ActionButton label="Regenerate" onClick={onRegenerate}>
              <RefreshCw />
            </ActionButton>
          )}
          {message.citations.length > 0 && (
            <span className="ml-2 text-xs text-muted-foreground">
              {new Set(message.citations.map((c) => c.sourceId)).size} source{new Set(message.citations.map((c) => c.sourceId)).size === 1 ? "" : "s"}{" "}
              cited
            </span>
          )}
        </div>
      )}

      {isLast && !message.streaming && message.follow_up_questions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {message.follow_up_questions.map((q) => (
            <button
              key={q}
              disabled={disabled}
              onClick={() => onAsk(q)}
              className="rounded-full border bg-background px-3 py-1.5 text-left text-xs transition hover:border-brand/50 hover:bg-brand-soft/30 disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={onClick} aria-label={label} className="text-muted-foreground">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function SavedResponsesDialog({
  open,
  onOpenChange,
  notebookId,
  onOpenCitation,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  notebookId: string;
  onOpenCitation: (c: Citation) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Saved responses</DialogTitle>
          <DialogDescription>Answers you saved from this notebook&apos;s chat.</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so each opening fetches fresh data. */}
        <SavedResponsesList
          notebookId={notebookId}
          onOpenCitation={(c) => {
            onOpenChange(false);
            onOpenCitation(c);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function SavedResponsesList({ notebookId, onOpenCitation }: { notebookId: string; onOpenCitation: (c: Citation) => void }) {
  const [items, setItems] = useState<{ id: string; content: string; citations: Citation[]; created_at: string }[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<{ messages: { id: string; content: string; citations: Citation[]; created_at: string }[] }>(`/api/notebooks/${notebookId}/saved`)
      .then((r) => !cancelled && setItems(r.messages))
      .catch((e) => {
        if (cancelled) return;
        toast.error(errorMessage(e));
        setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [notebookId]);

  return (
    <div className="scrollbar-thin -mx-6 max-h-[65dvh] space-y-4 overflow-y-auto px-6">
      {items === null && <Skeleton className="h-24 w-full" />}
      {items?.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">No saved responses yet. Use the bookmark icon under an answer to save it.</p>
      )}
      {items?.map((m) => (
        <div key={m.id} className="rounded-xl border p-4">
          <p className="mb-2 text-xs text-muted-foreground">{timeAgo(m.created_at)}</p>
          <Markdown content={m.content} citations={m.citations} onOpen={onOpenCitation} />
        </div>
      ))}
    </div>
  );
}
