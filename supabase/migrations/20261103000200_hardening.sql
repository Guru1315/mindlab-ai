-- MindLab AI — hardening from Supabase advisors.

-- handle_new_user() is only meant to run as the auth.users trigger; it should
-- not be callable through the REST API (/rest/v1/rpc/handle_new_user).
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Note: get_shared_notebook(text) is intentionally executable by anon — it
-- powers read-only share links and returns a fixed, minimal projection.

-- Covering indexes for the composite ownership foreign keys, so cascading
-- deletes (notebook -> children) and ownership joins don't scan.
create index if not exists sources_notebook_user_idx on public.sources (notebook_id, user_id);
create index if not exists document_chunks_notebook_user_idx on public.document_chunks (notebook_id, user_id);
create index if not exists document_chunks_source_user_idx on public.document_chunks (source_id, user_id);
create index if not exists conversations_notebook_user_idx on public.conversations (notebook_id, user_id);
create index if not exists messages_conversation_user_idx on public.messages (conversation_id, user_id);
create index if not exists messages_notebook_user_idx on public.messages (notebook_id, user_id);
create index if not exists generated_artifacts_notebook_user_idx on public.generated_artifacts (notebook_id, user_id);
create index if not exists audio_generations_notebook_user_idx on public.audio_generations (notebook_id, user_id);
create index if not exists usage_records_notebook_idx on public.usage_records (notebook_id);
