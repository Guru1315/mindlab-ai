import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { getPublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/** Current user + profile for Server Components (deduplicated per request). */
export const getCurrentUser = cache(async () => {
  // Always per-request: never prerender authenticated pages, even when the
  // build environment lacks Supabase configuration.
  await connection();
  if (!getPublicEnv().isSupabaseConfigured) redirect("/login?error=not_configured");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("id, email, full_name, avatar_url").eq("id", user.id).maybeSingle();
  return {
    supabase,
    user,
    profile: (profile as Profile | null) ?? { id: user.id, email: user.email ?? null, full_name: null, avatar_url: null },
  };
});
