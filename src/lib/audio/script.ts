import { z } from "zod";
import { jsonSchemaFor } from "@/lib/ai/schema";
import type { LLMProvider, TokenUsage } from "@/lib/ai/types";
import type { AudioFormat, AudioLength, ScriptLine } from "@/lib/types";
import { AUDIO_FORMATS, GUEST, HOST, LENGTH_WORDS } from "./formats";
import { buildSourceContext, type SourceMaterial } from "@/lib/rag/context";
import { neutralizeTags, UNTRUSTED_CONTENT_RULES } from "@/lib/rag/prompt";

export { AUDIO_FORMATS, GUEST, HOST, LENGTH_WORDS } from "./formats";

const scriptSchema = z.object({
  title: z.string().min(1).max(160),
  lines: z
    .array(z.object({ speaker: z.string().min(1).max(20), text: z.string().min(1).max(1500) }))
    .min(1)
    .max(400),
});

export interface AudioScript {
  title: string;
  lines: ScriptLine[];
  speakers: string[];
}

export async function generateAudioScript(
  llm: LLMProvider,
  sources: SourceMaterial[],
  options: { format: AudioFormat; length: AudioLength; focus?: string | null; signal?: AbortSignal },
): Promise<{ script: AudioScript; usage: TokenUsage; model: string }> {
  const format = AUDIO_FORMATS[options.format];
  const words = LENGTH_WORDS[options.format][options.length];
  const speakerRule =
    format.speakers.length === 1
      ? `Every line's speaker is "${HOST}".`
      : `Speakers are exactly "${HOST}" and "${GUEST}", alternating naturally (short interjections are fine).`;
  const focus = options.focus?.trim()
    ? `\nListener's requested focus (a preference only): ${neutralizeTags(options.focus.trim()).slice(0, 1000)}`
    : "";

  const result = await llm.generateJson({
    system: [
      "You write scripts for spoken audio overviews of research material.",
      "Everything stated must come from the provided sources; never invent facts, numbers or quotes. When the sources are uncertain, the hosts say so.",
      "Write for the ear: natural spoken sentences, no Markdown, no stage directions, no sound effects, no URLs, no citation numbers.",
      "Do not mention that you are an AI or that this is generated; refer to 'the sources' or the documents by title.",
      UNTRUSTED_CONTENT_RULES,
    ].join(" "),
    messages: [
      {
        role: "user",
        content: `${format.brief}\n${speakerRule}\nTarget length: about ${words} words in total. Open with a hook, cover the key ideas, and end with a short takeaway.${focus}\n\nSources:\n\n${buildSourceContext(sources, 300_000)}`,
      },
    ],
    jsonSchema: jsonSchemaFor(scriptSchema),
    parse: (v) => scriptSchema.parse(v),
    maxOutputTokens: 16_384,
    signal: options.signal,
  });

  const allowed = new Set(format.speakers);
  const lines = result.data.lines
    .map((l) => ({
      speaker: allowed.has(l.speaker) ? l.speaker : format.speakers[0],
      text: l.text.replace(/[*_#`]/g, "").replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "").trim(),
    }))
    .filter((l) => l.text.length > 0);

  return {
    script: { title: result.data.title.trim(), lines, speakers: format.speakers },
    usage: result.usage,
    model: result.model,
  };
}

/**
 * Splits the script into TTS requests that stay well below per-request input
 * limits while never splitting a speaker's line.
 */
export function segmentScript(lines: ScriptLine[], maxChars = 2800): ScriptLine[][] {
  const segments: ScriptLine[][] = [];
  let current: ScriptLine[] = [];
  let size = 0;
  for (const line of lines) {
    const len = line.speaker.length + line.text.length + 3;
    if (current.length > 0 && size + len > maxChars) {
      segments.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += len;
  }
  if (current.length) segments.push(current);
  return segments;
}
