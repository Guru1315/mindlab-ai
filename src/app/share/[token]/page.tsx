import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { SharedArtifacts } from "@/components/share/shared-artifacts";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { getPublicEnv } from "@/lib/env";
import type { ArtifactData, ArtifactType } from "@/lib/types";

type Props = { params: Promise<{ token: string }> };

interface SharedNotebook {
  notebook: { id: string; title: string; description: string | null; emoji: string; summary: string | null; updated_at: string };
  sources: { id: string; title: string; kind: string; word_count: number; summary: string | null }[];
  artifacts: { id: string; type: ArtifactType; title: string; content: string | null; data: ArtifactData; created_at: string }[];
}

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Loads a shared notebook through the minimal SECURITY DEFINER projection (anonymous key). */
async function loadShared(token: string): Promise<SharedNotebook | null> {
  const { supabaseUrl, supabaseKey, isSupabaseConfigured } = getPublicEnv();
  if (!isSupabaseConfigured || !/^[\w-]{24,64}$/.test(token)) return null;
  const supabase = createSupabaseClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("get_shared_notebook", { p_token: token });
  if (error || !data) return null;
  return data as SharedNotebook;
}

export default async function SharedNotebookPage({ params }: Props) {
  const { token } = await params;
  const shared = await loadShared(token);
  if (!shared) notFound();
  const { notebook, sources, artifacts } = shared;

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Logo />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild size="sm">
              <Link href="/signup">Try MindLab</Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Shared notebook · read-only</p>
        <h1 className="mt-2 flex items-center gap-3 font-display text-4xl tracking-tight sm:text-5xl">
          <span>{notebook.emoji}</span> {notebook.title}
        </h1>
        {notebook.description && <p className="mt-3 text-muted-foreground">{notebook.description}</p>}
        {notebook.summary && <p className="mt-6 max-w-3xl leading-relaxed">{notebook.summary}</p>}

        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_2fr]">
          <section>
            <h2 className="font-semibold">Sources ({sources.length})</h2>
            <ul className="mt-3 space-y-2">
              {sources.map((s) => (
                <li key={s.id} className="rounded-xl border bg-card p-3">
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.kind.toUpperCase()} · {s.word_count.toLocaleString()} words
                  </p>
                  {s.summary && <p className="mt-2 line-clamp-4 text-xs text-muted-foreground">{s.summary}</p>}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="font-semibold">Studio</h2>
            <SharedArtifacts artifacts={artifacts} />
          </section>
        </div>
      </main>
    </div>
  );
}
