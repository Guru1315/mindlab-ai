import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { HttpError, notFound, unauthorized } from "./http";

export interface AuthContext {
  supabase: SupabaseClient;
  user: User;
  /** The user's JWT, for background work that outlives the request. */
  accessToken: string;
}

/** Verifies the session with Supabase Auth (not just the cookie) for API routes. */
export async function requireUser(): Promise<AuthContext> {
  if (!getPublicEnv().isSupabaseConfigured) {
    throw new HttpError(503, "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and the publishable key.", "not_configured");
  }
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw unauthorized();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw unauthorized();
  return { supabase, user, accessToken: session.access_token };
}

/**
 * Loads a notebook the caller owns. RLS already hides other users' rows; this
 * turns "no row" into a 404 so ownership is validated before any work starts.
 */
export async function requireNotebook(supabase: SupabaseClient, notebookId: string, columns = "id, user_id, title, is_archived") {
  const { data, error } = await supabase.from("notebooks").select(columns).eq("id", notebookId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw notFound("Notebook");
  return data as unknown as Record<string, unknown> & { id: string; user_id: string; title: string };
}
