import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api/auth";
import { errorResponse, notFound, parseId } from "@/lib/api/http";
import { signedUrl } from "@/lib/storage";

type Params = { params: Promise<{ id: string }> };

/** Redirects the owner to a short-lived signed URL for the original file. */
export async function GET(request: Request, { params }: Params) {
  try {
    const id = parseId((await params).id, "Source");
    const { supabase } = await requireUser();
    const { data } = await supabase.from("sources").select("storage_path, title, kind").eq("id", id).maybeSingle();
    if (!data?.storage_path) throw notFound("File");
    const download = new URL(request.url).searchParams.get("download") === "1";
    const url = await signedUrl(supabase, "sources", data.storage_path as string, download ? { download: `${data.title}.${data.kind}` } : undefined);
    return NextResponse.redirect(url, { status: 302 });
  } catch (error) {
    return errorResponse(error, "source.file");
  }
}
