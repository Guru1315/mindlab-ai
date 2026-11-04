import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireNotebook, requireUser } from "@/lib/api/auth";
import { errorResponse, json, parseId, readJson } from "@/lib/api/http";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({ enabled: z.boolean(), rotate: z.boolean().optional() });

/**
 * Enables or disables the read-only share link. Tokens are 192-bit random
 * values; rotating invalidates previously shared links.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Notebook");
    const { supabase } = await requireUser();
    const body = await readJson(request, schema);
    const notebook = await requireNotebook(supabase, id, "id, user_id, title, share_token");
    const token = body.enabled && (!notebook.share_token || body.rotate) ? randomBytes(24).toString("base64url") : (notebook.share_token as string | null);
    const { data, error } = await supabase
      .from("notebooks")
      .update({ share_enabled: body.enabled, share_token: token })
      .eq("id", id)
      .select("share_enabled, share_token")
      .single();
    if (error) throw new Error(error.message);
    return json(data);
  } catch (error) {
    return errorResponse(error, "notebook.share");
  }
}
