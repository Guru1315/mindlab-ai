import { describe, expect, it } from "vitest";
import { concatPcm, encodeMp3, encodeWav } from "@/lib/audio/encode";
import { runAudioGeneration, type AudioRepository } from "@/lib/audio/pipeline";
import { segmentScript } from "@/lib/audio/script";
import type { AudioGeneration } from "@/lib/types";
import { FakeLLM, FakeSpeech } from "../fakes";

describe("audio encoding", () => {
  it("concatenates PCM with silence gaps", () => {
    const out = concatPcm([new Int16Array([1, 2]), new Int16Array([3])], 1000, 2);
    expect(Array.from(out)).toEqual([1, 2, 0, 0, 3]);
  });

  it("encodes real MP3 frames", () => {
    const pcm = new Int16Array(24000).map((_, i) => Math.round(Math.sin(i / 10) * 10000));
    const mp3 = encodeMp3(pcm, 24000);
    expect(mp3.length).toBeGreaterThan(1000);
    // MPEG audio frame sync: 11 set bits.
    expect(mp3[0]).toBe(0xff);
    expect(mp3[1] & 0xe0).toBe(0xe0);
  });

  it("writes a correct WAV header", () => {
    const wav = Buffer.from(encodeWav(new Int16Array([1, 2, 3, 4]), 24000));
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(40)).toBe(8);
  });
});

describe("segmentScript", () => {
  it("never splits a line and respects the size budget", () => {
    const lines = Array.from({ length: 30 }, (_, i) => ({ speaker: i % 2 ? "Sam" : "Alex", text: "word ".repeat(50).trim() }));
    const segments = segmentScript(lines, 1000);
    expect(segments.flat()).toEqual(lines);
    for (const seg of segments) {
      const size = seg.reduce((s, l) => s + l.speaker.length + l.text.length + 3, 0);
      expect(size <= 1000 || seg.length === 1).toBe(true);
    }
  });
});

describe("runAudioGeneration", () => {
  function memoryRepo() {
    const updates: Partial<AudioGeneration>[] = [];
    const uploads: { path: string; bytes: Uint8Array; contentType: string }[] = [];
    const usage: { kind: string }[] = [];
    const repo: AudioRepository = {
      update: async (_id, patch) => void updates.push(patch),
      upload: async (path, bytes, contentType) => void uploads.push({ path, bytes, contentType }),
      recordUsage: async (r) => void usage.push(r),
    };
    return { repo, updates, uploads, usage };
  }

  const job = {
    id: "a1",
    userId: "u1",
    notebookId: "nb1",
    format: "deep_dive" as const,
    length: "short" as const,
    focus: "Focus on energy",
    voices: { host: "Kore", guest: "Puck" },
  };

  it("scripts, synthesizes two speakers, encodes MP3 and stores it", async () => {
    const llm = new FakeLLM({
      json: () => ({
        title: "Energy in cells",
        lines: [
          { speaker: "Alex", text: "Welcome! Today: **mitochondria** [1]." },
          { speaker: "Sam", text: "They make ATP." },
          { speaker: "Intruder", text: "Unknown speakers are mapped to the host." },
        ],
      }),
    });
    const speech = new FakeSpeech();
    const { repo, updates, uploads, usage } = memoryRepo();
    await runAudioGeneration(job, { llm, speech, repo, loadSources: async () => [{ id: "s", title: "Bio", text: "Mitochondria produce ATP." }] });

    expect(updates.map((u) => u.status).filter(Boolean)).toEqual(["scripting", "synthesizing", "encoding", "ready"]);
    const final = updates.at(-1)!;
    expect(final.storage_path).toBe("u1/nb1/a1.mp3");
    expect(final.mime_type).toBe("audio/mpeg");
    expect(final.duration_seconds).toBeGreaterThan(0.25);
    expect(uploads[0].contentType).toBe("audio/mpeg");
    expect(uploads[0].bytes[0]).toBe(0xff);
    expect(speech.calls[0].voices).toEqual({ Alex: "Kore", Sam: "Puck" });
    const spoken = speech.calls.flatMap((c) => c.turns);
    expect(spoken[0].text).toBe("Welcome! Today: mitochondria."); // markdown + citation markers stripped
    expect(spoken.map((t) => t.speaker)).toEqual(["Alex", "Sam", "Alex"]);
    expect(usage.map((u) => u.kind)).toEqual(["generation", "tts"]);
    const prompt = llm.calls[0].messages[0].content;
    expect(prompt).toContain("Focus on energy");
    expect(prompt).toContain("Mitochondria produce ATP.");
  });

  it("fails cleanly when no sources are available", async () => {
    const { repo, updates, uploads } = memoryRepo();
    await runAudioGeneration(job, { llm: new FakeLLM(), speech: new FakeSpeech(), repo, loadSources: async () => [] });
    expect(updates.at(-1)).toMatchObject({ status: "failed", error: "Select at least one processed source." });
    expect(uploads).toHaveLength(0);
  });

  it("records a generic failure when TTS errors", async () => {
    const speech = new FakeSpeech();
    speech.synthesize = async () => {
      throw new Error("quota exceeded with secret detail");
    };
    const { repo, updates } = memoryRepo();
    await runAudioGeneration(job, {
      llm: new FakeLLM({ json: () => ({ title: "T", lines: [{ speaker: "Alex", text: "Hi" }] }) }),
      speech,
      repo,
      loadSources: async () => [{ id: "s", title: "S", text: "Text" }],
    });
    expect(updates.at(-1)!.status).toBe("failed");
    expect(updates.at(-1)!.error).not.toContain("secret");
  });
});
