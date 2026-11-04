import { BookOpenText, CalendarClock, FileText, GitCompare, HelpCircle, Layers, Lightbulb, ListChecks, Network, NotebookPen } from "lucide-react";
import type { ArtifactType } from "@/lib/types";

export const STUDIO_ICONS: Record<ArtifactType, typeof BookOpenText> = {
  study_guide: BookOpenText,
  faq: HelpCircle,
  briefing: FileText,
  timeline: CalendarClock,
  key_concepts: Lightbulb,
  flashcards: Layers,
  quiz: ListChecks,
  mind_map: Network,
  revision_notes: NotebookPen,
  comparison: GitCompare,
};
