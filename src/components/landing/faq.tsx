"use client";

import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const ITEMS = [
  {
    q: "What kinds of sources can I add?",
    a: "PDF, DOCX, TXT and Markdown files (up to 25 MB each by default), public web pages, and pasted text. Scanned PDFs without a text layer aren't supported yet.",
  },
  {
    q: "How does MindLab avoid making things up?",
    a: "Answers are generated from passages retrieved from your selected sources. Citation numbers are checked against those passages before they're shown, and when the sources don't cover a question, MindLab says so instead of guessing.",
  },
  {
    q: "Can other people see my notebooks?",
    a: "No. Every notebook, source and conversation is protected by row-level security tied to your account. You can optionally create a read-only share link for a notebook's sources list and Studio outputs — never your raw documents or chats.",
  },
  {
    q: "How are audio overviews made?",
    a: "MindLab writes a script grounded in your sources, then synthesizes it with a multi-speaker text-to-speech model. You can play, seek and download the MP3, and earlier overviews are kept in your history.",
  },
  {
    q: "Which AI models power MindLab?",
    a: "Google Gemini models for chat, embeddings and speech by default. The AI layer is modular, so providers can be swapped independently.",
  },
];

export function LandingFaq() {
  return (
    <div className="mt-10 divide-y rounded-2xl border bg-background">
      {ITEMS.map((item) => (
        <Collapsible key={item.q} className="group px-5">
          <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 py-4 text-left font-medium">
            {item.q}
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pb-4 text-sm leading-relaxed text-muted-foreground">{item.a}</CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}
