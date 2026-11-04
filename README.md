# MindLab AI

An AI research workspace: add your documents, ask questions and get answers with clickable citations, then turn your sources into study guides, quizzes, flashcards, mind maps and podcast-style audio overviews.

Built with Next.js 16 (App Router), TypeScript, Tailwind CSS 4, shadcn/ui, Supabase (Postgres + pgvector, Auth, Storage) and the Gemini API.

## Features
- **Notebooks** — create, rename, archive, duplicate, delete, search (titles and full source text), read-only share links.
- **Sources** — PDF, DOCX, TXT, Markdown, web pages, pasted text; validated, parsed, chunked with page numbers, embedded; live processing status and retry.
- **Grounded chat** — hybrid vector + keyword retrieval scoped to the notebook's selected sources; streaming answers; validated numbered citations that open the exact passage; suggested and follow-up questions; stop, regenerate, copy, save.
- **Source viewer** — extracted text with page navigation, in-document search, citation highlighting, "ask about selection", link to the original file.
- **Studio** — study guide, FAQ, briefing doc, timeline, key concepts, revision notes, source comparison, flashcards, quiz, mind map; edit, regenerate, export (Markdown/JSON/CSV).
- **Audio overviews** — deep dive, brief, debate, critique; three lengths; focus prompt; two voices; real multi-speaker TTS encoded to MP3; player, download, transcript, history.
- **Settings** — profile, theme, chat style/length/model, default voices, usage and storage.

## Quick start

### 1. Install
```bash
npm install
```

### 2. Supabase
1. Create a project at https://supabase.com.
2. Apply the migrations (creates tables, RLS, pgvector, functions, private buckets):
   ```bash
   npx supabase link --project-ref <your-ref>
   npx supabase db push
   ```
   or run the three `supabase/migrations/*.sql` files in order in the SQL editor.
3. **Authentication → URL configuration:** Site URL = your app URL; add redirect URLs `http://localhost:3000/auth/callback` and `<prod-url>/auth/callback` (and `/auth/confirm`).
4. **Google sign-in:** Authentication → Providers → Google; add OAuth client ID/secret from Google Cloud with redirect URI `https://<ref>.supabase.co/auth/v1/callback`.

### 3. Environment
```bash
cp .env.example .env.local
```
Required:

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | Supabase → Project Settings → API keys |
| `NEXT_PUBLIC_SITE_URL` | Your app URL (`http://localhost:3000` locally) |
| `GEMINI_API_KEY` (optional) | https://aistudio.google.com/apikey — see "AI provider" below |

The Supabase **service-role key is not needed** — all server work runs with the signed-in user's token so Row Level Security always applies.

### AI provider (optional)
MindLab runs in one of three modes (`AI_PROVIDER`, default `auto`):

| Mode | How to enable | What works |
|---|---|---|
| **Gemini** | set `GEMINI_API_KEY` | Everything |
| **Vercel AI Gateway** | `AI_PROVIDER=gateway` on Vercel (no key — uses the deployment's OIDC token; the Vercel team needs a credit card on file to unlock gateway credits), or `AI_GATEWAY_API_KEY` anywhere | Everything (same Gemini models via the gateway) |
| **Search mode** | nothing configured | Notebooks, uploads, keyword-indexed sources, source viewer, sharing; chat quotes the best-matching passages with citations. Studio and audio are disabled. |

After switching from search mode to an AI provider, use **Reprocess** on existing sources to add AI embeddings (keyword search keeps working either way).

### 4. Run
```bash
npm run dev
```

## Deploy (Vercel)
1. Import the repository in Vercel; framework preset Next.js.
2. Add the environment variables above (Production and Preview).
3. Background work runs within each route's `maxDuration` (300 s, the Hobby limit). On Pro with Fluid compute you can raise the audio route to 800 s for very long episodes.
4. Add the production URL to Supabase redirect URLs.

## Testing
```bash
npm run check      # lint + typecheck + unit, database (PGlite) and API integration tests
npm run test:e2e   # production build + Playwright (desktop & mobile)
GEMINI_API_KEY=... npm run test:live   # real Gemini embeddings, JSON, grounded answers, TTS
```
See `docs/testing-report.md` for the latest results.

## Documentation
- `docs/reverse-engineering-report.md` — product research, method and limits, feature comparison, workflow
- `docs/requirements.md` — functional & non-functional requirements with status
- `docs/architecture.md` — system design, flows, security model, decisions
- `docs/database-schema.md` — tables, indexes, RLS, functions, storage
- `docs/api-reference.md` — every endpoint and the chat streaming protocol
- `docs/implementation-roadmap.md` — what's done, go-live checklist, next steps
- `docs/testing-report.md` — results and coverage
