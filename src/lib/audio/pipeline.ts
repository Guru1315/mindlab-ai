import type { LLMProvider, SpeechProvider } from "@/lib/ai/types";
import type { AudioFormat, AudioGeneration, AudioLength } from "@/lib/types";
import type { SourceMaterial } from "@/lib/rag/context";
import { mapWithConcurrency } from "@/lib/retry";
import { ValidationError } from "@/lib/ingestion/validation";
import { concatPcm, encodeMp3 } from "./encode";
import { generateAudioScript, segmentScript, GUEST, HOST } from "./script";

export interface AudioRepository {
  update(id: string, patch: Partial<AudioGeneration>): Promise<void>;
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  recordUsage(record: { kind: "audio" | "tts" | "generation"; model: string; units: number; inputTokens?: number; outputTokens?: number }): Promise<void>;
}

export interface AudioJob {
  id: string;
  userId: string;
  notebookId: string;
  format: AudioFormat;
  length: AudioLength;
  focus: string | null;
  voices: { host: string; guest: string };
}

export interface AudioDeps {
  llm: LLMProvider;
  speech: SpeechProvider;
  repo: AudioRepository;
  loadSources: () => Promise<SourceMaterial[]>;
  signal?: AbortSignal;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

/**
 * Audio Overview pipeline: sources -> script (LLM) -> segmented multi-speaker
 * TTS -> stitched PCM -> MP3 -> storage. Progress and status are written to
 * the audio_generations row so the UI can poll real state.
 */
export async function runAudioGeneration(job: AudioJob, deps: AudioDeps): Promise<void> {
  const log = deps.log ?? (() => {});
  try {
    await deps.repo.update(job.id, { status: "scripting", progress: 5 });
    const sources = await deps.loadSources();
    if (sources.length === 0) throw new ValidationError("Select at least one processed source.");

    const { script, usage, model } = await generateAudioScript(deps.llm, sources, {
      format: job.format,
      length: job.length,
      focus: job.focus,
      signal: deps.signal,
    });
    await deps.repo.recordUsage({ kind: "generation", model, units: 1, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    await deps.repo.update(job.id, { status: "synthesizing", progress: 20, title: script.title, script, model });

    const voiceBySpeaker = { [HOST]: job.voices.host, [GUEST]: job.voices.guest };
    const segments = segmentScript(script.lines);
    let done = 0;
    let sampleRate = 0;
    const pcmSegments = await mapWithConcurrency(segments, 3, async (segment) => {
      const result = await deps.speech.synthesize(segment, voiceBySpeaker, deps.signal);
      if (sampleRate && result.sampleRate !== sampleRate) throw new Error("Inconsistent sample rates from TTS provider.");
      sampleRate = result.sampleRate;
      done++;
      await deps.repo.update(job.id, { progress: 20 + Math.round((done / segments.length) * 70) });
      return result.pcm;
    });

    await deps.repo.update(job.id, { status: "encoding", progress: 92 });
    const pcm = concatPcm(pcmSegments, sampleRate);
    const mp3 = encodeMp3(pcm, sampleRate);
    const duration = pcm.length / sampleRate;
    const path = `${job.userId}/${job.notebookId}/${job.id}.mp3`;
    await deps.repo.upload(path, mp3, "audio/mpeg");
    await deps.repo.recordUsage({
      kind: "tts",
      model: deps.speech.model,
      units: Math.round(duration),
      inputTokens: Math.ceil(script.lines.reduce((s, l) => s + l.text.length, 0) / 4),
    });
    await deps.repo.update(job.id, {
      status: "ready",
      progress: 100,
      storage_path: path,
      mime_type: "audio/mpeg",
      duration_seconds: Math.round(duration * 100) / 100,
      file_size: mp3.byteLength,
      tts_model: deps.speech.model,
      error: null,
    });
    log("audio.ready", { id: job.id, seconds: duration, segments: segments.length });
  } catch (error) {
    log("audio.failed", { id: job.id, error: error instanceof Error ? error.message : String(error) });
    await deps.repo.update(job.id, {
      status: "failed",
      error:
        error instanceof ValidationError
          ? error.message
          : "Audio generation failed. This can happen when the AI service is busy; please try again.",
    });
  }
}
