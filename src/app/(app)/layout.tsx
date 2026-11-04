import { AppHeader } from "@/components/app/app-header";
import { ThemeSync } from "@/components/app/theme-sync";
import { getCurrentUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user, profile } = await getCurrentUser();
  const { data: settings } = await supabase.from("user_settings").select("theme").eq("user_id", user.id).maybeSingle();
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader profile={profile} />
      <ThemeSync theme={(settings?.theme as "system" | "light" | "dark" | undefined) ?? null} />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
