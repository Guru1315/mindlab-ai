import { z } from "zod";
import { requireNotebook, requireUser } from "@/lib/api/auth";
import { errorResponse, HttpError, json, parseId, readJson } from "@/lib/api/http";
import { getServerEnv } from "@/lib/env";
import { parsePublicUrl } from "@/lib/ingestion/url";
import {
  assertFileSize,
  assertOwnedStoragePath,
  detectFileKind,
  mimeTypeForKind,
  titleFromFileName,
  ValidationError,
} from "@/lib/ingestion/validation";
import { scheduleSourceProcessing } from "@/lib/jobs";
import { SOURCE_LIST_COLUMNS } from "@/lib/types";
import { enforceRateLimit } from "@/lib/usage";

// Background ingestion (after()) inherits this limit.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

const MAX_PASTED_CHARS = 1_000_000;

const createSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("file"),
    files: z
      .array(
        z.object({
          storagePath: z.string().min(1).max(500),
          fileName: z.string().min(1).max(255),
          mimeType: z.string().max(200).optional(),
          size: z.number().int().nonnegative(),
        }),
      )
      .min(1)
      .max(20),
  }),
  z.object({ type: z.literal("url"), urls: z.array(z.string().min(1).max(2048)).min(1).max(10) }),
  z.object({
    type: z.literal("text"),
    title: z.string().trim().max(200).optional(),
    text: z.string().trim().min(1, "Paste some text first.").max(MAX_PASTED_CHARS, "Pasted text is too long (max 1,000,000 characters)."),
  }),
]);

export async function GET(_request: Request, { params }: Params) {
  try {
    const notebookId = parseId((await params).id, "Notebook");
    const { supabase } = await requireUser();
    await requireNotebook(supabase, notebookId);
    const { data, error } = await supabase.from("sources").select(SOURCE_LIST_COLUMNS).eq("notebook_id", notebookId).order("created_at");
    if (error) throw new Error(error.message);
    return json({ sources: data });
  } catch (error) {
    return errorResponse(error, "sources.list");
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const notebookId = parseId((await params).id, "Notebook");
    const ctx = await requireUser();
    const { supabase, user } = ctx;
    const body = await readJson(request, createSchema);
    await requireNotebook(supabase, notebookId);
    const env = getServerEnv();
    await enforceRateLimit(supabase, user.id, "ingest", env.RATE_LIMIT_INGEST_PER_HOUR, 3600);

    const { count } = await supabase.from("sources").select("id", { count: "exact", head: true }).eq("notebook_id", notebookId);
    const incoming = body.type === "file" ? body.files.length : body.type === "url" ? body.urls.length : 1;
    if ((count ?? 0) + incoming > env.MAX_SOURCES_PER_NOTEBOOK) {
      throw new HttpError(400, `A notebook can hold up to ${env.MAX_SOURCES_PER_NOTEBOOK} sources.`, "source_limit");
    }

    let rows: Record<string, unknown>[];
    if (body.type === "file") {
      rows = body.files.map((file) => {
        assertOwnedStoragePath(file.storagePath, user.id, notebookId);
        assertFileSize(file.size, env.MAX_UPLOAD_MB);
        const kind = detectFileKind(file.fileName, file.mimeType);
        return {
          notebook_id: notebookId,
          user_id: user.id,
          title: titleFromFileName(file.fileName),
          kind,
          storage_path: file.storagePath,
          mime_type: mimeTypeForKind(kind),
          file_size: file.size,
        };
      });
    } else if (body.type === "url") {
      rows = body.urls.map((raw) => {
        const url = parsePublicUrl(raw);
        return { notebook_id: notebookId, user_id: user.id, title: url.hostname + url.pathname.replace(/\/$/, ""), kind: "url", url: url.toString() };
      });
    } else {
      const firstLine = body.text.split("\n").find((l) => l.trim())?.trim() ?? "Pasted text";
      rows = [
        {
          notebook_id: notebookId,
          user_id: user.id,
          title: (body.title || firstLine).slice(0, 200) || "Pasted text",
          kind: "text",
          extracted_text: body.text,
          file_size: new TextEncoder().encode(body.text).byteLength,
        },
      ];
    }

    const { data, error } = await supabase.from("sources").insert(rows).select(SOURCE_LIST_COLUMNS);
    if (error) throw new Error(error.message);
    const created = data as unknown as { id: string }[];
    scheduleSourceProcessing({ accessToken: ctx.accessToken, userId: user.id }, notebookId, created.map((s) => s.id));
    return json({ sources: created }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return errorResponse(error);
    return errorResponse(error, "sources.create");
  }
}
