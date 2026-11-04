import { z } from "zod";
import { requireUser } from "@/lib/api/auth";
import { errorResponse, json, notFound, parseId, readJson } from "@/lib/api/http";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({ is_saved: z.boolean() });

/** Save (or unsave) an AI response to the notebook's saved notes. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Message");
    const { supabase } = await requireUser();
    const body = await readJson(request, schema);
    const { data, error } = await supabase
      .from("messages")
      .update(body)
      .eq("id", id)
      .eq("role", "assistant")
      .select("id, is_saved")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw notFound("Message");
    return json({ message: data });
  } catch (error) {
    return errorResponse(error, "message.patch");
  }
}
