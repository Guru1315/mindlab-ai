-- MindLab AI — keyword-only retrieval for running without an AI provider.
--
-- Natural-language questions rarely contain every term of a passage, so the
-- query's lexemes are OR-ed together (instead of websearch_to_tsquery's AND)
-- and passages are ranked by cover density. SECURITY INVOKER: RLS applies.

create or replace function public.search_chunks_text(
  p_notebook_id uuid,
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
set search_path = public
as $$
  with q as (
    select (
      select string_agg(quote_literal(t.lexeme), ' | ')
      from unnest(to_tsvector('english', coalesce(p_query_text, ''))) as t
    )::tsquery as query
  )
  select c.id, c.source_id, c.chunk_index, c.content, c.page_start, c.page_end,
         c.char_start, c.char_end,
         null::double precision as similarity,
         ts_rank_cd(c.fts, q.query, 1)::double precision as rank_score
  from public.document_chunks c, q
  where q.query is not null
    and c.notebook_id = p_notebook_id
    and (p_source_ids is null or c.source_id = any (p_source_ids))
    and c.fts @@ q.query
  order by rank_score desc, c.chunk_index
  limit least(greatest(p_match_count, 1), 50);
$$;
