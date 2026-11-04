"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/client/api";
import type { AIMode } from "@/lib/ai";
import type { Notebook, Source } from "@/lib/types";

export type MobileTab = "sources" | "chat" | "studio";

export interface ViewerTarget {
  sourceId: string;
  /** Character range in the source's normalized text to highlight. */
  highlight?: { start: number; end: number };
  page?: number | null;
  chunkId?: string;
  /** Changes on every open so re-clicking the same citation re-scrolls. */
  nonce: number;
}

interface WorkspaceValue {
  userId: string;
  /** True when a model is available for generation (answers, Studio, audio). */
  aiConfigured: boolean;
  aiMode: AIMode;
  notebook: Notebook;
  updateNotebook: (patch: Partial<Notebook>) => Promise<void>;
  setNotebookLocal: (patch: Partial<Notebook>) => void;
  sources: Source[];
  setSources: React.Dispatch<React.SetStateAction<Source[]>>;
  refreshSources: () => Promise<void>;
  readySelectedIds: string[];
  toggleSource: (id: string, selected: boolean) => void;
  selectAll: (selected: boolean) => void;
  viewer: ViewerTarget | null;
  openSource: (target: Omit<ViewerTarget, "nonce">) => void;
  closeViewer: () => void;
  mobileTab: MobileTab;
  setMobileTab: (tab: MobileTab) => void;
  /** Lets the Sources panel ask the chat to send a question. */
  askQuestion: (question: string) => void;
  registerAsk: (fn: (question: string) => void) => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}

const isBusy = (s: Source) => s.status === "pending" || s.status === "processing";

export function WorkspaceProvider({
  userId,
  aiMode,
  initialNotebook,
  initialSources,
  initialViewer,
  children,
}: {
  userId: string;
  aiMode: AIMode;
  initialNotebook: Notebook;
  initialSources: Source[];
  initialViewer: Omit<ViewerTarget, "nonce"> | null;
  children: ReactNode;
}) {
  const [notebook, setNotebook] = useState(initialNotebook);
  const [sources, setSources] = useState(initialSources);
  const [viewer, setViewer] = useState<ViewerTarget | null>(initialViewer ? { ...initialViewer, nonce: 0 } : null);
  const [mobileTab, setMobileTab] = useState<MobileTab>(initialViewer ? "sources" : "chat");
  const askRef = useRef<((q: string) => void) | null>(null);

  const refreshSources = useCallback(async () => {
    const { sources } = await api<{ sources: Source[] }>(`/api/notebooks/${notebook.id}/sources`);
    setSources(sources);
  }, [notebook.id]);

  const refreshNotebook = useCallback(async () => {
    const { notebook: fresh } = await api<{ notebook: Notebook }>(`/api/notebooks/${notebook.id}`);
    setNotebook(fresh);
  }, [notebook.id]);

  // Poll while any source is still being processed; refresh the overview when they finish.
  const busy = sources.some(isBusy);
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (!busy) {
      if (wasBusy.current) {
        wasBusy.current = false;
        // Suggested questions are generated right after processing completes.
        const t = setTimeout(() => refreshNotebook().catch(() => {}), 4000);
        return () => clearTimeout(t);
      }
      return;
    }
    wasBusy.current = true;
    const timer = setInterval(() => refreshSources().catch(() => {}), 2500);
    return () => clearInterval(timer);
  }, [busy, refreshSources, refreshNotebook]);

  const updateNotebook = useCallback(
    async (patch: Partial<Notebook>) => {
      const previous = notebook;
      setNotebook((n) => ({ ...n, ...patch }));
      try {
        const { notebook: fresh } = await api<{ notebook: Notebook }>(`/api/notebooks/${notebook.id}`, { method: "PATCH", json: patch });
        setNotebook(fresh);
      } catch (error) {
        setNotebook(previous);
        toast.error(errorMessage(error));
      }
    },
    [notebook],
  );

  const toggleSource = useCallback((id: string, selected: boolean) => {
    setSources((xs) => xs.map((s) => (s.id === id ? { ...s, is_selected: selected } : s)));
    api(`/api/sources/${id}`, { method: "PATCH", json: { is_selected: selected } }).catch((error) => {
      setSources((xs) => xs.map((s) => (s.id === id ? { ...s, is_selected: !selected } : s)));
      toast.error(errorMessage(error));
    });
  }, []);

  const selectAll = useCallback(
    (selected: boolean) => {
      setSources((xs) => xs.map((s) => ({ ...s, is_selected: selected })));
      api(`/api/notebooks/${notebook.id}/sources/selection`, { method: "PATCH", json: { selected } }).catch((error) => {
        toast.error(errorMessage(error));
        refreshSources().catch(() => {});
      });
    },
    [notebook.id, refreshSources],
  );

  const readySelectedIds = useMemo(() => sources.filter((s) => s.is_selected && s.status === "ready").map((s) => s.id), [sources]);

  const openSource = useCallback((target: Omit<ViewerTarget, "nonce">) => {
    setViewer({ ...target, nonce: Date.now() });
    setMobileTab("sources");
  }, []);

  const value: WorkspaceValue = {
    userId,
    aiConfigured: aiMode !== "none",
    aiMode,
    notebook,
    updateNotebook,
    setNotebookLocal: (patch) => setNotebook((n) => ({ ...n, ...patch })),
    sources,
    setSources,
    refreshSources,
    readySelectedIds,
    toggleSource,
    selectAll,
    viewer,
    openSource,
    closeViewer: () => setViewer(null),
    mobileTab,
    setMobileTab,
    askQuestion: (q) => {
      setMobileTab("chat");
      askRef.current?.(q);
    },
    registerAsk: (fn) => {
      askRef.current = fn;
    },
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
