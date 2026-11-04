import { z } from "zod";
import { requireUser } from "@/lib/api/auth";
import { errorResponse, json, notFound, parseId, readJson } from "@/lib/api/http";
import { flashcardsSchema, mindMapSchema, quizSchema } from "@/lib/studio/definitions";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    content: z.string().max(200_000),
    data: z.union([
      flashcardsSchema.extend({ kind: z.literal("flashcards") }),
      quizSchema.extend({ kind: z.literal("quiz") }),
      mindMapSchema.extend({ kind: z.literal("mind_map") }),
    ]),
  })
  .partial();

export async function GET(_request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Artifact");
    const { supabase } = await requireUser();
    const { data, error } = await supabase.from("generated_artifacts").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw notFound("Artifact");
    return json({ artifact: data });
  } catch (error) {
    return errorResponse(error, "artifact.get");
  }
}

/** Saves user edits (title, Markdown content, or structured data). */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Artifact");
    const { supabase } = await requireUser();
    const body = await readJson(request, patchSchema);
    const { data, error } = await supabase.from("generated_artifacts").update(body).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw notFound("Artifact");
    return json({ artifact: data });
  } catch (error) {
    return errorResponse(error, "artifact.patch");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Artifact");
    const { supabase } = await requireUser();
    const { data, error } = await supabase.from("generated_artifacts").delete().eq("id", id).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw notFound("Artifact");
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "artifact.delete");
  }
}
