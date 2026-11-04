import type { Metadata } from "next";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { listNotebooks, recentSources } from "@/lib/notebooks/queries";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Notebooks" };

export default async function DashboardPage() {
  const { supabase, profile } = await getCurrentUser();
  const [notebooks, archived, recent] = await Promise.all([
    listNotebooks(supabase),
    listNotebooks(supabase, { archived: true }),
    recentSources(supabase),
  ]);
  const firstName = profile.full_name?.split(" ")[0] ?? null;
  return <DashboardView firstName={firstName} initialNotebooks={notebooks} initialArchived={archived} recentSources={recent} />;
}
