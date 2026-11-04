"use client";

import { useState } from "react";
import { Markdown } from "@/components/workspace/chat/markdown";
import { FlashcardDeck } from "@/components/workspace/studio/flashcards";
import { MindMap } from "@/components/workspace/studio/mind-map";
import { QuizPlayer } from "@/components/workspace/studio/quiz";
import { STUDIO_ICONS } from "@/components/workspace/studio/studio-icons";
import type { ArtifactData, ArtifactType } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SharedArtifacts({ artifacts }: { artifacts: { id: string; type: ArtifactType; title: string; content: string | null; data: ArtifactData }[] }) {
  const [activeId, setActiveId] = useState(artifacts[0]?.id);
  const active = artifacts.find((a) => a.id === activeId);
  if (artifacts.length === 0) return <p className="mt-3 text-sm text-muted-foreground">No Studio items have been created yet.</p>;
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {artifacts.map((a) => {
          const Icon = STUDIO_ICONS[a.type];
          return (
            <button
              key={a.id}
              onClick={() => setActiveId(a.id)}
              className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm", a.id === activeId ? "border-brand bg-brand-soft" : "hover:bg-muted")}
            >
              <Icon className="size-3.5 text-brand" /> {a.title}
            </button>
          );
        })}
      </div>
      {active && (
        <div className="mt-5 rounded-2xl border bg-card p-5">
          {active.content && <Markdown content={active.content} />}
          {active.data?.kind === "flashcards" && <FlashcardDeck key={active.id} cards={active.data.cards} />}
          {active.data?.kind === "quiz" && <QuizPlayer key={active.id} questions={active.data.questions} />}
          {active.data?.kind === "mind_map" && <MindMap root={active.data.root} />}
        </div>
      )}
    </div>
  );
}
