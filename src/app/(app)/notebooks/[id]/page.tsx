import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace/workspace";
import { getAIStatus } from "@/lib/ai";
import { getCurrentUser } from "@/lib/session";
import { SOURCE_LIST_COLUMNS, type Notebook, type Source } from "@/lib/types";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ source?: string; chunk?: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Notebook" };
  const { supabase } = await getCurrentUser();
  const { data } = await supabase.from("notebooks").select("title").eq("id", id).maybeSingle();
  return { title: data?.title ?? "Notebook" };
}

export default async function NotebookPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { source, chunk } = await searchParams;
  if (!UUID.test(id)) notFound();
  const { supabase, user } = await getCurrentUser();

  const { data: notebook } = await supabase
    .from("notebooks")
    .update({ last_opened_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (!notebook) notFound();

  const { data: sources } = await supabase.from("sources").select(SOURCE_LIST_COLUMNS).eq("notebook_id", id).order("created_at");

  return (
    <Workspace
      userId={user.id}
      initialNotebook={notebook as Notebook}
      initialSources={(sources ?? []) as unknown as Source[]}
      aiMode={getAIStatus().mode}
      initialViewer={source && UUID.test(source) ? { sourceId: source, chunkId: chunk && UUID.test(chunk) ? chunk : undefined } : null}
    />
  );
}
