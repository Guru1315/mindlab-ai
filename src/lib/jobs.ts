import "server-only";
import { after } from "next/server";
import { getAIProviders, getOptionalAIProviders } from "@/lib/ai";
import { runAudioGeneration, type AudioJob } from "@/lib/audio/pipeline";
import { getServerEnv } from "@/lib/env";
import { processSource } from "@/lib/ingestion/pipeline";
import { SupabaseIngestionRepository } from "@/lib/ingestion/supabase-repository";
import { logger } from "@/lib/logger";
import { refreshNotebookOverview } from "@/lib/notebooks/overview";
import { loadSourceMaterial } from "@/lib/rag/context";
import { generateArtifact } from "@/lib/studio/generate";
import { createUserScopedClient } from "@/lib/supabase/server";
import type { ArtifactType } from "@/lib/types";
import { recordUsage } from "@/lib/usage";

/**
 * Background jobs run after the HTTP response with Next.js `after()`, using a
 * client bound to the user's JWT so RLS applies to every query. Each job writes
 * its status to the database; the UI polls those rows. The route segment's
 * `maxDuration` bounds how long a job may run on Vercel.
 */

export function scheduleSourceProcessing(ctx: { accessToken: string; userId: string }, notebookId: string, sourceIds: string[]) {
  after(async () => {
    const supabase = createUserScopedClient(ctx.accessToken);
    // Without an AI provider, sources are still indexed for keyword search.
    const ai = getOptionalAIProviders();
    const repo = new SupabaseIngestionRepository(supabase, ctx.userId);
    let anyReady = false;
    for (const id of sourceIds) {
      try {
        const result = await processSource(id, {
          repo,
          embeddings: ai?.embeddings,
          llm: ai?.llm,
          maxUploadMb: getServerEnv().MAX_UPLOAD_MB,
          log: logger.info,
        });
        anyReady ||= result.status === "ready";
      } catch (error) {
        logger.error("ingest.crashed", { sourceId: id, error: error instanceof Error ? error.message : String(error) });
        await repo.markFailed(id, "Processing failed unexpectedly. Use Retry to try again.").catch(() => {});
      }
    }
    if (anyReady && ai) await refreshNotebookOverview(supabase, ctx.userId, notebookId, ai.llm);
  });
}

export function scheduleArtifactGeneration(
  ctx: { accessToken: string; userId: string },
  artifact: { id: string; notebookId: string; type: ArtifactType; sourceIds: string[]; focus?: string },
) {
  after(async () => {
    const supabase = createUserScopedClient(ctx.accessToken);
    try {
      const { llm } = getAIProviders();
      const sources = await loadSourceMaterial(supabase, artifact.notebookId, artifact.sourceIds);
      const result = await generateArtifact(llm, artifact.type, sources, { focus: artifact.focus });
      await supabase
        .from("generated_artifacts")
        .update({ status: "ready", content: result.content, data: result.data, model: result.model, error: null })
        .eq("id", artifact.id);
      await recordUsage(supabase, ctx.userId, {
        kind: "generation",
        notebookId: artifact.notebookId,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        units: 1,
        metadata: { type: artifact.type },
      });
    } catch (error) {
      const message = error instanceof Error && error.name === "ValidationError" ? error.message : "Generation failed. Please try again.";
      logger.error("artifact.failed", { id: artifact.id, error: error instanceof Error ? error.message : String(error) });
      await supabase.from("generated_artifacts").update({ status: "failed", error: message }).eq("id", artifact.id);
    }
  });
}

export function scheduleAudioGeneration(ctx: { accessToken: string; userId: string }, job: AudioJob, sourceIds: string[]) {
  after(async () => {
    const supabase = createUserScopedClient(ctx.accessToken);
    const ai = getAIProviders();
    await runAudioGeneration(job, {
      llm: ai.llm,
      speech: ai.speech,
      loadSources: () => loadSourceMaterial(supabase, job.notebookId, sourceIds),
      log: logger.info,
      repo: {
        async update(id, patch) {
          const { error } = await supabase.from("audio_generations").update(patch).eq("id", id);
          if (error) logger.warn("audio.update_failed", { id, error: error.message });
        },
        async upload(path, bytes, contentType) {
          const { error } = await supabase.storage.from("audio").upload(path, bytes, { contentType, upsert: true });
          if (error) throw new Error(`Audio upload failed: ${error.message}`);
        },
        async recordUsage(record) {
          await recordUsage(supabase, ctx.userId, { ...record, notebookId: job.notebookId });
        },
      },
    });
  });
}
