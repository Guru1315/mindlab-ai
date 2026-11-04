"use client";

import { AlertTriangle, BookOpen, MessageSquare, Sparkles } from "lucide-react";
import type { AIMode } from "@/lib/ai";
import type { Notebook, Source } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChatPanel } from "./chat/chat-panel";
import { NotebookHeader } from "./notebook-header";
import { SourcesPanel } from "./sources/sources-panel";
import { SourceViewer } from "./sources/source-viewer";
import { StudioPanel } from "./studio/studio-panel";
import { useWorkspace, WorkspaceProvider, type MobileTab, type ViewerTarget } from "./workspace-context";

export function Workspace(props: {
  userId: string;
  aiMode: AIMode;
  initialNotebook: Notebook;
  initialSources: Source[];
  initialViewer: Omit<ViewerTarget, "nonce"> | null;
}) {
  return (
    <WorkspaceProvider {...props}>
      <NotebookHeader />
      <WorkspaceLayout />
    </WorkspaceProvider>
  );
}

const TABS: { id: MobileTab; label: string; icon: typeof BookOpen }[] = [
  { id: "sources", label: "Sources", icon: BookOpen },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "studio", label: "Studio", icon: Sparkles },
];

function WorkspaceLayout() {
  const { viewer, mobileTab, setMobileTab, aiConfigured } = useWorkspace();
  const panel = "flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-card";

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      {!aiConfigured && (
        <div className="flex items-center gap-2 border-b bg-warning/15 px-4 py-2 text-xs">
          <AlertTriangle className="size-4 shrink-0 text-warning" />
          <span>
            <strong>Search mode:</strong> no AI provider is configured, so chat shows the best-matching passages from your sources
            (with citations) instead of written answers. Studio and audio overviews need an AI provider.
          </span>
        </div>
      )}
      <div
        className={cn(
          "grid min-h-0 flex-1 gap-3 p-3 max-lg:pb-0",
          "lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)_minmax(300px,360px)]",
          viewer && "lg:grid-cols-[minmax(380px,520px)_minmax(0,1fr)_minmax(300px,340px)]",
        )}
      >
        <section aria-label="Sources" className={cn(panel, mobileTab !== "sources" && "max-lg:hidden")}>
          {viewer ? <SourceViewer key={`${viewer.sourceId}:${viewer.chunkId ?? ""}`} /> : <SourcesPanel />}
        </section>
        <section aria-label="Chat" className={cn(panel, mobileTab !== "chat" && "max-lg:hidden")}>
          <ChatPanel />
        </section>
        <section aria-label="Studio" className={cn(panel, mobileTab !== "studio" && "max-lg:hidden")}>
          <StudioPanel />
        </section>
      </div>
      <nav className="grid grid-cols-3 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Workspace panels">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setMobileTab(tab.id)}
            aria-current={mobileTab === tab.id ? "page" : undefined}
            className={cn("flex flex-col items-center gap-0.5 py-2 text-xs", mobileTab === tab.id ? "text-brand" : "text-muted-foreground")}
          >
            <tab.icon className="size-5" />
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
