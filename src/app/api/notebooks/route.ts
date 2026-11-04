import { z } from "zod";
import { requireUser } from "@/lib/api/auth";
import { errorResponse, json, readJson } from "@/lib/api/http";
import { listNotebooks } from "@/lib/notebooks/queries";

const createSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  emoji: z.string().trim().min(1).max(16).optional(),
});

export async function GET(request: Request) {
  try {
    const { supabase } = await requireUser();
    const url = new URL(request.url);
    const notebooks = await listNotebooks(supabase, {
      query: url.searchParams.get("q") ?? undefined,
      archived: url.searchParams.get("archived") === "true",
    });
    return json({ notebooks });
  } catch (error) {
    return errorResponse(error, "notebooks.list");
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await readJson(request, createSchema);
    const { data, error } = await supabase
      .from("notebooks")
      .insert({
        user_id: user.id,
        title: body.title || "Untitled notebook",
        description: body.description || null,
        emoji: body.emoji || "📓",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return json({ notebook: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "notebooks.create");
  }
}
