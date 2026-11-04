-- MindLab AI — private storage buckets.
-- Objects are stored under "<user_id>/<notebook_id>/<file>" and only the owner
-- (first path segment = auth.uid()) can read, write or delete them.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('sources', 'sources', false, 52428800, array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ]),
  ('audio', 'audio', false, 104857600, array['audio/mpeg', 'audio/wav'])
on conflict (id) do nothing;

create policy "storage: owner can read" on storage.objects
  for select to authenticated
  using (bucket_id in ('sources', 'audio') and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "storage: owner can upload" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('sources', 'audio') and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "storage: owner can update" on storage.objects
  for update to authenticated
  using (bucket_id in ('sources', 'audio') and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id in ('sources', 'audio') and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "storage: owner can delete" on storage.objects
  for delete to authenticated
  using (bucket_id in ('sources', 'audio') and (storage.foldername(name))[1] = (select auth.uid())::text);
