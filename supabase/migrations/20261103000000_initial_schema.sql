-- MindLab AI — initial schema
-- Tables, ownership constraints, indexes, RLS policies and RPC functions.
-- Every user-owned row carries user_id. Child tables use composite foreign keys
-- (parent_id, user_id) so a row can never point at another user's notebook,
-- even if an application bug supplied the wrong id.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- user_settings
-- ---------------------------------------------------------------------------

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  chat_model text,
  chat_style text not null default 'default' check (chat_style in ('default', 'learning', 'custom')),
  custom_instructions text check (char_length(custom_instructions) <= 2000),
  response_length text not null default 'default' check (response_length in ('short', 'default', 'long')),
  audio_host_voice text not null default 'Kore',
  audio_guest_voice text not null default 'Puck',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- New auth user -> profile + settings rows.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- notebooks
-- ---------------------------------------------------------------------------

create table public.notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled notebook' check (char_length(title) between 1 and 200),
  description text check (char_length(description) <= 2000),
  emoji text not null default '📓' check (char_length(emoji) <= 16),
  is_archived boolean not null default false,
  summary text,
  suggested_questions jsonb not null default '[]'::jsonb,
  share_enabled boolean not null default false,
  share_token text unique,
  last_opened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index notebooks_user_recent_idx on public.notebooks (user_id, is_archived, last_opened_at desc);
create index notebooks_title_search_idx on public.notebooks using gin (to_tsvector('simple', title));

-- ---------------------------------------------------------------------------
-- sources
-- ---------------------------------------------------------------------------

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null,
  user_id uuid not null,
  title text not null check (char_length(title) between 1 and 500),
  kind text not null check (kind in ('pdf', 'docx', 'txt', 'md', 'url', 'text')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'failed')),
  error text,
  storage_path text,
  mime_type text,
  file_size bigint not null default 0 check (file_size >= 0),
  url text,
  extracted_text text,
  -- Character offset at which each page starts inside extracted_text.
  page_offsets integer[] not null default '{}',
  page_count integer not null default 0,
  word_count integer not null default 0,
  chunk_count integer not null default 0,
  summary text,
  is_selected boolean not null default true,
  is_bookmarked boolean not null default false,
  attempts integer not null default 0,
  processing_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (notebook_id, user_id) references public.notebooks (id, user_id) on delete cascade
);

create index sources_notebook_idx on public.sources (notebook_id, created_at);
create index sources_user_recent_idx on public.sources (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- document_chunks
-- ---------------------------------------------------------------------------

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null,
  notebook_id uuid not null,
  user_id uuid not null,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  page_start integer,
  page_end integer,
  char_start integer not null,
  char_end integer not null,
  token_count integer not null default 0,
  embedding extensions.vector(768),
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, chunk_index),
  foreign key (source_id, user_id) references public.sources (id, user_id) on delete cascade,
  foreign key (notebook_id, user_id) references public.notebooks (id, user_id) on delete cascade
);

create index document_chunks_notebook_idx on public.document_chunks (notebook_id, source_id);
create index document_chunks_fts_idx on public.document_chunks using gin (fts);
create index document_chunks_embedding_idx on public.document_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- conversations & messages
-- ---------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null,
  user_id uuid not null,
  title text not null default 'Conversation' check (char_length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (notebook_id, user_id) references public.notebooks (id, user_id) on delete cascade
);

create index conversations_notebook_idx on public.conversations (notebook_id, updated_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  notebook_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  citations jsonb not null default '[]'::jsonb,
  follow_up_questions jsonb not null default '[]'::jsonb,
  status text not null default 'complete' check (status in ('streaming', 'complete', 'stopped', 'error')),
  model text,
  is_saved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (conversation_id, user_id) references public.conversations (id, user_id) on delete cascade,
  foreign key (notebook_id, user_id) references public.notebooks (id, user_id) on delete cascade
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_saved_idx on public.messages (notebook_id) where is_saved;

-- ---------------------------------------------------------------------------
-- generated_artifacts (Studio)
-- ---------------------------------------------------------------------------

create table public.generated_artifacts (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null,
  user_id uuid not null,
  type text not null check (type in (
    'study_guide', 'faq', 'briefing', 'timeline', 'key_concepts',
    'flashcards', 'quiz', 'mind_map', 'comparison', 'revision_notes'
  )),
  title text not null check (char_length(title) <= 300),
  content text,
  data jsonb,
  status text not null default 'generating' check (status in ('generating', 'ready', 'failed')),
  error text,
  source_ids uuid[] not null default '{}',
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (notebook_id, user_id) references public.notebooks (id, user_id) on delete cascade
);

create index generated_artifacts_notebook_idx on public.generated_artifacts (notebook_id, created_at desc);

-- ---------------------------------------------------------------------------
-- audio_generations
-- ---------------------------------------------------------------------------

create table public.audio_generations (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null,
  user_id uuid not null,
  status text not null default 'queued' check (status in ('queued', 'scripting', 'synthesizing', 'encoding', 'ready', 'failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  format text not null default 'deep_dive' check (format in ('deep_dive', 'brief', 'debate', 'critique')),
  length text not null default 'default' check (length in ('short', 'default', 'long')),
  focus_prompt text check (char_length(focus_prompt) <= 1000),
  title text,
  script jsonb,
  storage_path text,
  mime_type text,
  duration_seconds numeric(10, 2),
  file_size bigint,
  error text,
  source_ids uuid[] not null default '{}',
  model text,
  tts_model text,
  voices jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (notebook_id, user_id) references public.notebooks (id, user_id) on delete cascade
);

create index audio_generations_notebook_idx on public.audio_generations (notebook_id, created_at desc);

-- ---------------------------------------------------------------------------
-- usage_records (append-only from the user's perspective)
-- ---------------------------------------------------------------------------

create table public.usage_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  notebook_id uuid references public.notebooks (id) on delete set null,
  kind text not null check (kind in ('chat', 'embedding', 'generation', 'tts', 'ingest', 'audio')),
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  units integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index usage_records_user_kind_time_idx on public.usage_records (user_id, kind, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger user_settings_updated_at before update on public.user_settings for each row execute function public.set_updated_at();
create trigger notebooks_updated_at before update on public.notebooks for each row execute function public.set_updated_at();
create trigger sources_updated_at before update on public.sources for each row execute function public.set_updated_at();
create trigger document_chunks_updated_at before update on public.document_chunks for each row execute function public.set_updated_at();
create trigger conversations_updated_at before update on public.conversations for each row execute function public.set_updated_at();
create trigger messages_updated_at before update on public.messages for each row execute function public.set_updated_at();
create trigger generated_artifacts_updated_at before update on public.generated_artifacts for each row execute function public.set_updated_at();
create trigger audio_generations_updated_at before update on public.audio_generations for each row execute function public.set_updated_at();
create trigger usage_records_updated_at before update on public.usage_records for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.notebooks enable row level security;
alter table public.sources enable row level security;
alter table public.document_chunks enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.generated_artifacts enable row level security;
alter table public.audio_generations enable row level security;
alter table public.usage_records enable row level security;

create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "user_settings: read own" on public.user_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy "user_settings: insert own" on public.user_settings
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "user_settings: update own" on public.user_settings
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Owner-only CRUD for every notebook-scoped table. The composite foreign keys
-- guarantee that notebook_id/source_id/conversation_id belong to the same user.
do $$
declare
  t text;
begin
  foreach t in array array[
    'notebooks', 'sources', 'document_chunks', 'conversations',
    'messages', 'generated_artifacts', 'audio_generations'
  ]
  loop
    execute format('create policy "%1$s: select own" on public.%1$I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy "%1$s: insert own" on public.%1$I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy "%1$s: update own" on public.%1$I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "%1$s: delete own" on public.%1$I for delete to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- Usage records can be read and appended, never edited or deleted by users,
-- so rate limits derived from them cannot be reset from the client.
create policy "usage_records: select own" on public.usage_records
  for select to authenticated using (user_id = (select auth.uid()));
create policy "usage_records: insert own" on public.usage_records
  for insert to authenticated with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Hybrid retrieval: vector similarity + full-text, fused with Reciprocal Rank
-- Fusion. SECURITY INVOKER so RLS still restricts rows to the caller.
-- ---------------------------------------------------------------------------

create or replace function public.match_chunks(
  p_notebook_id uuid,
  p_query_embedding extensions.vector(768),
  p_query_text text,
  p_source_ids uuid[] default null,
  p_match_count integer default 8
)
returns table (
  id uuid,
  source_id uuid,
  chunk_index integer,
  content text,
  page_start integer,
  page_end integer,
  char_start integer,
  char_end integer,
  similarity double precision,
  rank_score double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with candidates as (
    select c.*
    from public.document_chunks c
    where c.notebook_id = p_notebook_id
      and (p_source_ids is null or c.source_id = any (p_source_ids))
  ),
  semantic as (
    select c.id,
           row_number() over (order by c.embedding <=> p_query_embedding) as rnk,
           1 - (c.embedding <=> p_query_embedding) as similarity
    from candidates c
    where c.embedding is not null
    order by c.embedding <=> p_query_embedding
    limit greatest(p_match_count, 1) * 4
  ),
  keyword as (
    select c.id,
           row_number() over (order by ts_rank_cd(c.fts, q.query) desc) as rnk
    from candidates c,
         lateral (select websearch_to_tsquery('english', coalesce(p_query_text, '')) as query) q
    where c.fts @@ q.query
    order by ts_rank_cd(c.fts, q.query) desc
    limit greatest(p_match_count, 1) * 4
  ),
  fused as (
    select coalesce(s.id, k.id) as id,
           coalesce(1.0 / (60 + s.rnk), 0) + coalesce(1.0 / (60 + k.rnk), 0) as rank_score
    from semantic s
    full outer join keyword k on k.id = s.id
  )
  select c.id, c.source_id, c.chunk_index, c.content, c.page_start, c.page_end,
         c.char_start, c.char_end,
         (1 - (c.embedding <=> p_query_embedding))::double precision as similarity,
         f.rank_score::double precision
  from fused f
  join public.document_chunks c on c.id = f.id
  order by f.rank_score desc, c.chunk_index
  limit least(greatest(p_match_count, 1), 50);
$$;

-- ---------------------------------------------------------------------------
-- Read-only public share. Only owners can enable sharing (RLS on notebooks);
-- this function exposes a fixed, minimal projection for a valid token and
-- never returns raw document text, chunks, chats or other notebooks.
-- ---------------------------------------------------------------------------

create or replace function public.get_shared_notebook(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'notebook', jsonb_build_object(
      'id', n.id,
      'title', n.title,
      'description', n.description,
      'emoji', n.emoji,
      'summary', n.summary,
      'updated_at', n.updated_at
    ),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'kind', s.kind,
        'word_count', s.word_count, 'summary', s.summary
      ) order by s.created_at)
      from public.sources s
      where s.notebook_id = n.id and s.status = 'ready'
    ), '[]'::jsonb),
    'artifacts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'type', a.type, 'title', a.title,
        'content', a.content, 'data', a.data, 'created_at', a.created_at
      ) order by a.created_at desc)
      from public.generated_artifacts a
      where a.notebook_id = n.id and a.status = 'ready'
    ), '[]'::jsonb)
  )
  from public.notebooks n
  where p_token is not null
    and char_length(p_token) >= 24
    and n.share_token = p_token
    and n.share_enabled
    and not n.is_archived;
$$;

revoke all on function public.get_shared_notebook(text) from public;
grant execute on function public.get_shared_notebook(text) to anon, authenticated;
