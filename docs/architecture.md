# Architecture

## Overview

```mermaid
flowchart TB
  subgraph Browser
    UI[Next.js client components<br/>dashboard · workspace · settings]
    SB_JS[supabase-js browser client<br/>auth + direct uploads]
  end
  subgraph Vercel["Next.js 16 server (Vercel)"]
    Proxy[proxy.ts<br/>session refresh + route guard]
    RSC[Server Components<br/>dashboard / notebook pages]
    API[Route handlers /api/*]
    Jobs[Background jobs via after()<br/>ingestion · studio · audio]
    Core[Domain modules<br/>ingestion · rag · studio · audio]
    AI[AI provider layer<br/>LLM · embeddings · speech]
  end
  subgraph Supabase
    Auth[Auth<br/>email + Google]
    PG[(Postgres + pgvector<br/>RLS on every table)]
    Store[(Storage<br/>private buckets: sources, audio)]
  end
  Gemini[[Gemini API<br/>gemini-3.8-flash · embedding-2 · 3.8-flash-tts]]

  UI -->|fetch / NDJSON stream| API
  UI --> SB_JS
  SB_JS --> Auth
  SB_JS -->|upload to own folder| Store
  Proxy --> Auth
  RSC --> PG
  API --> Core --> AI --> Gemini
  API --> Jobs --> Core
  Core -->|user JWT| PG
  Core -->|user JWT| Store
```

## Code layout

```
src/
  app/                    routes (App Router)
    page.tsx              landing
    (auth)/               login, signup, forgot/reset password
    (app)/                authenticated shell: dashboard, notebooks/[id], settings
    share/[token]/        public read-only notebook
    api/                  JSON + streaming route handlers
    auth/                 OAuth callback, email confirm, sign-out
  proxy.ts                session refresh & route protection (Next 16 "proxy")
  components/             UI (no business logic)
    workspace/            sources/, chat/, studio/ panels + shared context
    ui/                   shadcn/ui primitives
  lib/                    business logic (framework-light, unit-tested)
    ai/                   provider interfaces + Gemini implementation
    ingestion/            validation, parsers, URL fetch, normalize, chunker, pipeline
    rag/                  prompt, retrieval, citations, answer orchestration, context
    studio/               artifact definitions, generation, export
    audio/                formats, script, encoding, pipeline
    api/                  auth guard, HTTP errors
    supabase/             server/browser clients
    jobs.ts               background job scheduling
    usage.ts              usage records + rate limiting
supabase/migrations/      SQL schema, RLS, functions, storage policies
tests/                    unit, db (PGlite), integration, e2e (Playwright)
```

Business logic depends only on small interfaces (`LLMProvider`, `EmbeddingProvider`, `SpeechProvider`, `Retriever`, `IngestionRepository`, `AudioRepository`). Route handlers wire real implementations; tests wire in-memory fakes.

## Key flows

### Ingestion
1. Browser uploads the file directly to `storage/sources/<userId>/<notebookId>/<uuid>-<name>` (storage RLS only allows the user's own folder). This avoids serverless body-size limits.
2. `POST /api/notebooks/:id/sources` validates ownership of the path, type, size and quota, rate-limits, inserts `sources` rows (`pending`) and schedules processing with `after()`.
3. `processSource`: download → magic-byte check → parse (unpdf/pdf.js, mammoth, UTF-8 text, Readability for HTML) → normalize → chunk (~1600 chars, 240 overlap, exact slices with char offsets and page ranges) → embed (batched, retried) → replace chunks → source summary → `ready`. Errors set `failed` with a user-facing message; **Retry** re-runs.
4. When any source finishes, the notebook overview and 3 suggested questions are regenerated.

### Question answering (RAG)
1. `POST /api/notebooks/:id/chat` authenticates, rate-limits, keeps only `ready` sources of this notebook from the client's selection, loads the last 10 messages.
2. Query embedding → `match_chunks` RPC: vector (cosine, HNSW) + full-text (`websearch_to_tsquery`) fused with Reciprocal Rank Fusion, scoped to notebook + selected sources, executed with the user's JWT (RLS applies). Weak semantic-only matches are dropped.
3. No passages → deterministic "sources don't cover this" answer (the model is not called).
4. Otherwise the model receives a system prompt with grounding rules and the passages as numbered `<source_passage>` blocks, and the answer is streamed as NDJSON.
5. After streaming, citation markers are validated (`resolveCitations`): unknown numbers are removed, the cited passages are attached, and the validated text replaces the streamed text in the UI and the database. Follow-up questions are generated with the fast model.
6. Stop = client abort → server keeps the partial answer (status `stopped`, citations validated).

### Studio
`POST /api/notebooks/:id/artifacts` creates a `generating` row and runs `generateArtifact` in the background over the full text of the selected sources (proportional, evenly sampled within a 400k-char budget). Markdown types return text; flashcards/quiz/mind-map use JSON-schema structured output validated by zod (one retry on invalid output). UI polls until `ready`.

### Audio overview
`POST /api/notebooks/:id/audio` → background `runAudioGeneration`: script (structured JSON, speakers Alex/Sam) → segments of ≤2,800 chars → Gemini multi-speaker TTS (3 concurrent) → PCM stitched with 250 ms gaps → MP3 (lamejs, 64 kbps mono) → `storage/audio/<user>/<notebook>/<id>.mp3`. Status/progress written at each stage; playback uses short-lived signed URLs.

## Security model

- **Identity:** Supabase Auth; `proxy.ts` refreshes the session cookie; every API route calls `requireUser()` (`auth.getUser()` validates with the Auth server).
- **Authorization:** Postgres RLS (`user_id = auth.uid()`) on all ten tables; composite FKs `(notebook_id, user_id)` make cross-user references impossible even with a bug; `usage_records` has no update/delete policy so limits can't be reset.
- **No service-role key:** background jobs use a client bound to the user's JWT, so RLS applies everywhere. Sharing goes through one `SECURITY DEFINER` function returning a fixed, minimal projection.
- **Storage:** private buckets, owner-folder policies, server-side path validation, signed URLs (1 h).
- **Untrusted content:** passages and documents are wrapped in tags; look-alike tags are neutralised; system prompts forbid following embedded instructions; model output images are never rendered; links open with `noopener nofollow`.
- **Network:** URL imports allow only http(s) on standard ports, resolve DNS and block private/link-local/metadata ranges on every redirect hop, cap size (10 MB) and time (15 s).
- **Headers:** `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, restrictive permissions policy.
- **Abuse:** per-user sliding-window limits for chat, Studio, audio and ingestion; per-notebook source cap; file-size limit.

## Technology decisions (ADRs)

| # | Decision | Why |
|---|---|---|
| 1 | Next.js 16 App Router, **Cache Components off** | Almost every page is per-user; default dynamic rendering avoids wrapping every session read in Suspense. `getCurrentUser()` calls `connection()` so authenticated pages are never prerendered. |
| 2 | Gemini via `@google/genai` `models.generateContent` / `embedContent` | Stable, typed surface in SDK 2.32; supports system instructions, JSON-schema output, streaming and multi-speaker TTS. The newer Interactions API is documented but not required. |
| 3 | Models: `gemini-3.8-flash` (chat/Studio), `gemini-3.5-flash-lite` (summaries, suggestions), `gemini-embedding-2` @ 768 dims, `gemini-3.8-flash-tts` | Verified against Gemini docs on 2026-11-03 (2.5 models are deprecated). All overridable via env. |
| 4 | 768-d embeddings, HNSW cosine index | Recommended reduced size; embedding-2 auto-normalizes; we L2-normalize anyway (needed for embedding-001). |
| 5 | Hybrid retrieval with RRF in SQL | Exact terms (names, codes) are found by full-text even when embeddings miss them. |
| 6 | Direct browser → Storage uploads | Vercel functions cap request bodies (~4.5 MB); storage RLS keeps it safe. |
| 7 | Background work with `after()` + DB status + polling | No extra infrastructure; `maxDuration` 300 s (raise to 800 s on Vercel Pro for very long audio). For heavy load, move jobs to a queue (see roadmap). |
| 8 | MP3 encoding with lamejs | ~5× smaller than WAV for storage and download; pure JS works on serverless. |
| 9 | PGlite + pgvector for DB tests | Runs the real migration SQL and RLS policies in-process (Docker was not available). |
| 10 | unpdf (serverless pdf.js), mammoth, Readability + linkedom | Pure JS parsers that run on Vercel without native deps. |
| 11 | Three AI modes: `gemini`, `gateway` (Vercel AI Gateway over its OpenAI-compatible REST API, authenticated with the deployment's OIDC token via `@vercel/oidc`), `none` | The app must work without any API key. In `none` mode ingestion stores chunks without embeddings, retrieval uses `search_chunks_text` (OR-ed lexemes, `ts_rank_cd`), and chat returns escaped verbatim excerpts with validated citations; generation features return 503 with an explanation. The gateway's speech endpoint takes one voice per request, so speaker runs are synthesized separately and stitched. |

## Known limitations
- DNS-rebinding window between the SSRF DNS check and the fetch (mitigation: pinned-IP dispatcher).
- `after()` jobs are lost if the instance is recycled mid-job; such sources/audio stay in a non-terminal state (sources can be retried after 10 minutes; audio rows remain `synthesizing`). A durable queue would fix this.
- Scanned PDFs (no text layer) are rejected; no OCR.
- The source viewer shows extracted text (with page navigation) and links to the original PDF in the browser's viewer, rather than embedding a PDF renderer.
