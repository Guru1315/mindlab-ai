import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

export async function removeStorageFiles(supabase: SupabaseClient, bucket: "sources" | "audio", paths: string[]) {
  const unique = [...new Set(paths.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 100) {
    const { error } = await supabase.storage.from(bucket).remove(unique.slice(i, i + 100));
    if (error) logger.warn("storage.remove_failed", { bucket, error: error.message });
  }
}

/** Short-lived signed URL for a private object (the bucket is never public). */
export async function signedUrl(supabase: SupabaseClient, bucket: "sources" | "audio", path: string, options?: { download?: string }) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60, options?.download ? { download: options.download } : undefined);
  if (error || !data) throw new Error(`Could not create a file link: ${error?.message ?? "unknown error"}`);
  return data.signedUrl;
}
