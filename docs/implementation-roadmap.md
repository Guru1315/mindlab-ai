# Implementation roadmap

## Delivered (this iteration)

| Sprint | Scope | Status |
|---|---|---|
| 1 | Research (public docs; REA limitation documented), requirements, architecture, Next.js 16 + Tailwind 4 + shadcn/ui setup, design system (tokens, typography, light/dark) | ✅ |
| 2 | Supabase schema + RLS + storage policies, auth screens (email, Google, reset), proxy route guard, dashboard, notebook CRUD/archive/duplicate/search | ✅ code · DB tested in PGlite |
| 3 | Uploads (direct-to-storage), validation, PDF/DOCX/TXT/MD/URL/text parsing, normalization, chunking with pages, embeddings, background processing, retry | ✅ code · unit tested |
| 4 | Hybrid retrieval (pgvector + FTS, RRF), streaming grounded chat, validated citations, source viewer with highlight/search/pages, follow-ups, saved responses | ✅ code · unit tested |
| 5 | Studio (10 tools) with edit/regenerate/export; audio overview (script → multi-speaker TTS → MP3), player, history, transcript | ✅ code · unit tested |
| 6 | Rate limits, security headers, SSRF guard, prompt-injection defences, logging/usage, tests (unit, DB, integration, e2e), docs | ✅ |

## Required to go live (needs your credentials)
1. Create a Supabase project; apply the two migrations; enable the Google provider; set Site URL and redirect URLs (`<site>/auth/callback`, `<site>/auth/confirm`).
2. Create a Gemini API key; set env vars (see `.env.example`).
3. Run `npm run test:live` with the key to verify model IDs and TTS output on your account.
4. Deploy to Vercel (route `maxDuration` is 300 s; raise the audio route on Pro if you generate very long episodes).
5. Smoke-test the full flow with a real account (upload → chat → citation → Studio → audio).

## Next (recommended order)
1. **Durable job queue** (Supabase Queues / Inngest / Vercel Queues) for ingestion, Studio and audio, with resumable steps and automatic stale-job recovery.
2. **Embedded PDF viewer** (pdf.js) with highlight overlays on the original page images.
3. **OCR** for scanned PDFs (Gemini document understanding or Tesseract).
4. **Collaboration roles**: invitations with viewer/editor permissions enforced in RLS (`notebook_members` table).
5. **More source types**: YouTube transcripts, Google Drive, audio files (Gemini transcription), images.
6. **Audio**: multi-language output, interactive Q&A mode, chapter markers.
7. **Notes**: editable notes that can be promoted to sources.
8. **SSRF hardening**: pin the resolved IP in the HTTP dispatcher to close the DNS-rebinding window.
9. **Observability**: OpenTelemetry traces, Sentry, per-model cost dashboards.
10. **Billing** for the Pro/Team plans shown on the landing page.
