import { z } from "zod";
import { getOptionalAIProviders } from "@/lib/ai";
import { requireNotebook, requireUser } from "@/lib/api/auth";
import { errorResponse, json, parseId, readJson } from "@/lib/api/http";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { answerQuestion, type AnswerEvent } from "@/lib/rag/answer";
import { resolveCitations } from "@/lib/rag/citations";
import { SupabaseRetriever } from "@/lib/rag/retrieval";
import type { Citation, UserSettings } from "@/lib/types";
import { enforceRateLimit, recordUsage } from "@/lib/usage";

export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

const chatSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  sourceIds: z.array(z.string().uuid()).max(300),
  conversationId: z.string().uuid().optional(),
});

/** Messages of the notebook's most recent conversation. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const notebookId = parseId((await params).id, "Notebook");
    const { supabase } = await requireUser();
    await requireNotebook(supabase, notebookId);
    const { data: conversation } = await supabase
      .from("conversations")
      .select("id, title, created_at, updated_at")
      .eq("notebook_id", notebookId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conversation) return json({ conversation: null, messages: [] });
    const { data: messages, error } = await supabase
      .from("messages")
      .select("id, conversation_id, notebook_id, role, content, citations, follow_up_questions, status, model, is_saved, created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at")
      .limit(500);
    if (error) throw new Error(error.message);
    return json({ conversation, messages });
  } catch (error) {
    return errorResponse(error, "chat.get");
  }
}

/** Clears the chat history for this notebook. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const notebookId = parseId((await params).id, "Notebook");
    const { supabase } = await requireUser();
    await requireNotebook(supabase, notebookId);
    const { error } = await supabase.from("conversations").delete().eq("notebook_id", notebookId);
    if (error) throw new Error(error.message);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "chat.delete");
  }
}

/**
 * Streams a grounded answer as newline-delimited JSON events:
 * {type:"start"} {type:"passages"} {type:"delta"}* {type:"final"} {type:"followups"}? {type:"done"} | {type:"error"}
 */
export async function POST(request: Request, { params }: Params) {
  let ctx: Awaited<ReturnType<typeof requireUser>>;
  let notebookId: string;
  let body: z.infer<typeof chatSchema>;
  let conversationId: string;
  let history: { role: "user" | "assistant"; content: string }[] = [];
  let settings: UserSettings | null = null;

  try {
    notebookId = parseId((await params).id, "Notebook");
    ctx = await requireUser();
    body = await readJson(request, chatSchema);
    await requireNotebook(ctx.supabase, notebookId);
    await enforceRateLimit(ctx.supabase, ctx.user.id, "chat", getServerEnv().RATE_LIMIT_CHAT_PER_HOUR, 3600);

    // Only ready sources that belong to this notebook are searchable.
    const { data: validSources } = await ctx.supabase
      .from("sources")
      .select("id")
      .eq("notebook_id", notebookId)
      .eq("status", "ready")
      .in("id", body.sourceIds.length ? body.sourceIds : ["00000000-0000-0000-0000-000000000000"]);
    body.sourceIds = (validSources ?? []).map((s) => s.id as string);

    const { data: s } = await ctx.supabase.from("user_settings").select("*").eq("user_id", ctx.user.id).maybeSingle();
    settings = s as UserSettings | null;

    if (body.conversationId) {
      const { data: existing } = await ctx.supabase.from("conversations").select("id").eq("id", body.conversationId).eq("notebook_id", notebookId).maybeSingle();
      if (!existing) body.conversationId = undefined;
    }
    if (body.conversationId) {
      conversationId = body.conversationId;
      const { data: prior } = await ctx.supabase
        .from("messages")
        .select("role, content, status")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(10);
      history = (prior ?? [])
        .reverse()
        .filter((m) => m.status !== "error" && (m.content as string).trim())
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string }));
    } else {
      const { data: created, error } = await ctx.supabase
        .from("conversations")
        .insert({ notebook_id: notebookId, user_id: ctx.user.id, title: body.question.slice(0, 120) })
        .select("id")
        .single();
      if (error || !created) throw new Error(error?.message ?? "Could not create conversation");
      conversationId = created.id as string;
    }
  } catch (error) {
    return errorResponse(error, "chat.post");
  }

  const { supabase, user } = ctx;
  const { data: userMessage, error: userMessageError } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, notebook_id: notebookId, user_id: user.id, role: "user", content: body.question })
    .select("id, created_at")
    .single();
  if (userMessageError) return errorResponse(new Error(userMessageError.message), "chat.save_user");

  const encoder = new TextEncoder();
  const signal = request.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // Client disconnected.
        }
      };
      send({ type: "start", conversationId, userMessageId: userMessage.id });

      let streamed = "";
      let passages: Citation[] = [];
      let final: Extract<AnswerEvent, { type: "final" }> | null = null;
      let followUps: string[] = [];

      const persist = async (status: "complete" | "stopped" | "error", content: string, citations: Citation[], model: string | null) => {
        const { data, error } = await supabase
          .from("messages")
          .insert({
            conversation_id: conversationId,
            notebook_id: notebookId,
            user_id: user.id,
            role: "assistant",
            content,
            citations,
            follow_up_questions: followUps,
            status,
            model,
          })
          .select("id")
          .single();
        if (error) logger.error("chat.save_assistant_failed", { error: error.message });
        await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
        return data?.id as string | undefined;
      };

      try {
        // Without an AI provider this answers in search mode (quoted passages).
        const ai = getOptionalAIProviders();
        for await (const event of answerQuestion(
          {
            notebookId,
            question: body.question,
            sourceIds: body.sourceIds,
            history,
            settings: settings ?? undefined,
            signal,
          },
          { llm: ai?.llm, retriever: new SupabaseRetriever(supabase, ai?.embeddings) },
        )) {
          if (event.type === "passages") {
            passages = event.citations;
            send({ type: "passages", citations: event.citations });
          } else if (event.type === "delta") {
            streamed += event.text;
            send(event);
          } else if (event.type === "final") {
            final = event;
            send({ type: "final", text: event.text, citations: event.citations });
          } else if (event.type === "followups") {
            followUps = event.questions;
            send(event);
          }
        }
        const messageId = await persist("complete", final?.text ?? streamed, final?.citations ?? [], final && final.model !== "none" ? final.model : null);
        if (final) {
          // Search-mode replies count toward the chat rate limit too.
          await recordUsage(supabase, user.id, {
            kind: "chat",
            notebookId,
            model: final.model === "none" ? null : final.model,
            inputTokens: final.usage.inputTokens,
            outputTokens: final.usage.outputTokens,
            units: 1,
          });
        }
        send({ type: "done", messageId });
      } catch (error) {
        if (signal.aborted) {
          // User pressed Stop: keep what was generated, with validated citations.
          const partial = resolveCitations(streamed, passages);
          await persist("stopped", partial.text, partial.citations, null);
          await recordUsage(supabase, user.id, { kind: "chat", notebookId, units: 1, metadata: { stopped: true } });
        } else {
          logger.error("chat.stream_failed", { notebookId, error: error instanceof Error ? error.message : String(error) });
          const message =
            error instanceof Error && (error.name === "AIResponseError" || error.name === "AIConfigurationError")
              ? error.message
              : "The AI service could not complete this answer. Please try again.";
          const messageId = await persist("error", streamed, [], null);
          send({ type: "error", error: message, messageId });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
