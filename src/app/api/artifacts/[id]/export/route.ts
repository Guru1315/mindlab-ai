import { requireUser } from "@/lib/api/auth";
import { errorResponse, notFound, parseId } from "@/lib/api/http";
import { ValidationError } from "@/lib/ingestion/validation";
import { artifactToMarkdown, flashcardsToCsv } from "@/lib/studio/generate";
import type { ArtifactData } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

function fileName(title: string, ext: string) {
  const base = title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "export";
  return `${base}.${ext}`;
}

/** Downloads an artifact as Markdown, JSON, or (for flashcards) CSV. */
export async function GET(request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Artifact");
    const { supabase } = await requireUser();
    const format = new URL(request.url).searchParams.get("format") ?? "md";
    const { data } = await supabase.from("generated_artifacts").select("title, content, data, status").eq("id", id).maybeSingle();
    if (!data || data.status !== "ready") throw notFound("Artifact");
    const title = data.title as string;
    const artifactData = data.data as ArtifactData;

    let body: string;
    let type: string;
    let ext: string;
    if (format === "json") {
      body = JSON.stringify({ title, content: data.content, data: artifactData }, null, 2);
      type = "application/json";
      ext = "json";
    } else if (format === "csv") {
      if (artifactData?.kind !== "flashcards") throw new ValidationError("CSV export is available for flashcards only.");
      body = flashcardsToCsv(artifactData.cards);
      type = "text/csv";
      ext = "csv";
    } else {
      body = artifactToMarkdown(title, data.content as string | null, artifactData);
      type = "text/markdown";
      ext = "md";
    }
    return new Response(body, {
      headers: {
        "Content-Type": `${type}; charset=utf-8`,
        "Content-Disposition": `attachment; filename="${fileName(title, ext)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, "artifact.export");
  }
}
