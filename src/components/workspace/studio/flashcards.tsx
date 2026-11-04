"use client";

import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Plus, RotateCcw, Shuffle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Flashcard } from "@/lib/types";

/** Callers pass a `key` tied to the artifact version so a new deck starts fresh. */
export function FlashcardDeck({ cards }: { cards: Flashcard[] }) {
  const [order, setOrder] = useState(() => cards.map((_, i) => i));
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const card = cards[order[index]];
  const go = (delta: number) => {
    setFlipped(false);
    setIndex((i) => (i + delta + cards.length) % cards.length);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea")) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === " ") {
        e.preventDefault();
        setFlipped((f) => !f);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!card) return <p className="text-sm text-muted-foreground">No cards.</p>;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Card {index + 1} of {cards.length}
        </span>
        <span>Click the card or press space to flip</span>
      </div>
      <button onClick={() => setFlipped((f) => !f)} className="block w-full [perspective:1200px]" aria-label={flipped ? "Show question" : "Show answer"}>
        <motion.div animate={{ rotateY: flipped ? 180 : 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="relative h-64 w-full [transform-style:preserve-3d] sm:h-72">
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border bg-card p-6 text-center shadow-sm [backface-visibility:hidden]">
            <span className="mb-3 text-[11px] font-semibold tracking-wider text-brand uppercase">Question</span>
            <p className="text-lg font-medium text-balance">{card.front}</p>
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto rounded-2xl border bg-brand-soft/50 p-6 text-center shadow-sm [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <span className="mb-3 text-[11px] font-semibold tracking-wider text-brand uppercase">Answer</span>
            <p className="text-[0.95rem] text-pretty">{card.back}</p>
          </div>
        </motion.div>
      </button>
      <div className="mt-4 flex items-center justify-center gap-2">
        <Button variant="outline" size="icon" onClick={() => go(-1)} aria-label="Previous card">
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOrder((o) => [...o].sort(() => Math.random() - 0.5));
            setIndex(0);
            setFlipped(false);
          }}
        >
          <Shuffle /> Shuffle
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOrder(cards.map((_, i) => i));
            setIndex(0);
            setFlipped(false);
          }}
        >
          <RotateCcw /> Reset
        </Button>
        <Button variant="outline" size="icon" onClick={() => go(1)} aria-label="Next card">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function FlashcardEditor({ cards, onChange }: { cards: Flashcard[]; onChange: (cards: Flashcard[]) => void }) {
  const update = (i: number, patch: Partial<Flashcard>) => onChange(cards.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-3">
      {cards.map((c, i) => (
        <div key={i} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_1fr_auto]">
          <Textarea rows={2} value={c.front} maxLength={400} onChange={(e) => update(i, { front: e.target.value })} aria-label={`Card ${i + 1} question`} />
          <Textarea rows={2} value={c.back} maxLength={1200} onChange={(e) => update(i, { back: e.target.value })} aria-label={`Card ${i + 1} answer`} />
          <Button variant="ghost" size="icon" disabled={cards.length <= 4} onClick={() => onChange(cards.filter((_, j) => j !== i))} aria-label={`Delete card ${i + 1}`}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" disabled={cards.length >= 40} onClick={() => onChange([...cards, { front: "New question", back: "Answer" }])}>
        <Plus /> Add card
      </Button>
    </div>
  );
}
