import type { AudioFormat, AudioLength } from "@/lib/types";

/** Audio Overview formats (client-safe metadata shared by UI and script generation). */
export const HOST = "Alex";
export const GUEST = "Sam";

export const AUDIO_FORMATS: Record<AudioFormat, { label: string; description: string; speakers: string[]; brief: string }> = {
  deep_dive: {
    label: "Deep dive",
    description: "Two hosts unpack the sources in a lively conversation.",
    speakers: [HOST, GUEST],
    brief:
      "Two podcast hosts explore the material in depth: Alex guides the conversation, Sam reacts, asks clarifying questions and draws connections. Explain ideas with concrete examples from the sources.",
  },
  brief: {
    label: "Brief",
    description: "A single narrator gives a quick overview.",
    speakers: [HOST],
    brief: "A single narrator delivers a crisp spoken overview of the most important ideas.",
  },
  debate: {
    label: "Debate",
    description: "Two hosts argue different perspectives on the material.",
    speakers: [HOST, GUEST],
    brief:
      "A respectful, formal debate: Alex and Sam take different positions supported by the sources, challenge each other's reasoning, and close by summarizing where they agree.",
  },
  critique: {
    label: "Critique",
    description: "Constructive expert feedback on the material.",
    speakers: [HOST, GUEST],
    brief:
      "Two expert reviewers give constructive critique of the material: strengths, weaknesses, gaps in evidence, and concrete suggestions for improvement, grounded in what the sources actually say.",
  },
};

/** Target spoken word counts (~150 words per minute). */
export const LENGTH_WORDS: Record<AudioFormat, Record<AudioLength, number>> = {
  deep_dive: { short: 650, default: 1300, long: 2200 },
  brief: { short: 220, default: 320, long: 450 },
  debate: { short: 650, default: 1200, long: 2000 },
  critique: { short: 600, default: 1100, long: 1800 },
};

export const LENGTH_LABELS: Record<AudioLength, string> = { short: "Shorter", default: "Default", long: "Longer" };
