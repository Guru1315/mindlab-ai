import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth-redirect";

/** OAuth / PKCE code exchange (Google sign-in, email confirmation, password recovery). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  const errorDescription = url.searchParams.get("error_description");
  const login = new URL("/login", url.origin);
  login.searchParams.set("error", errorDescription ? errorDescription.slice(0, 200) : "auth_failed");
  return NextResponse.redirect(login);
}
