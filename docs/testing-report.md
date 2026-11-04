# Testing report

**Run date:** 2026-11-03 · Windows 11, Node 24.22, Next.js 16.4.4, Vitest 5.1, Playwright (Microsoft Edge channel).

## Results

| Suite | Command | Result |
|---|---|---|
| Lint | `npm run lint` | ✅ 0 errors, 0 warnings |
| Types | `npm run typecheck` | ✅ |
| Production build | `npm run build` | ✅ |
| Unit (13 files) | `npm run test:unit` | ✅ 119 passed |
| Database / RLS (PGlite + pgvector) | `npm run test:db` | ✅ 16 passed |
| API integration (real route handlers) | `npm run test:integration` | ✅ 6 passed, 4 skipped (live) |
| Live Gemini | `npm run test:live` | ⏭️ skipped — no `GEMINI_API_KEY` in this environment |
| End-to-end, desktop + Pixel 7 | `npm run test:e2e` | ✅ 28 passed |
| **Total** | | **169 passed, 4 skipped, 0 failed** (e2e last run before the AI-mode change; it covers public pages that change did not touch) |

## Coverage against the brief's test list

| # | Area | Tests | Notes |
|---|---|---|---|
| 1 | Authentication | e2e: login/sign-up/forgot screens, failed sign-in shows error, route guards for `/dashboard`, `/settings`, `/notebooks/:id`; integration: 401 on 11 API handlers, 503 when unconfigured | Successful sign-in requires a live Supabase project (not available here). |
| 2 | Notebook creation | DB: insert as owner; RLS blocks spoofed `user_id` | UI flow requires live Supabase. |
| 3 | Notebook editing | DB: update by owner, zero rows for other users; `updated_at` trigger | |
| 4 | Document uploads | Unit: type detection, size limits, magic bytes, UTF-8, sanitised names, owner-only storage paths; DB: storage RLS folder policy | Browser → Storage upload needs live Supabase. |
| 5 | Document parsing | Unit: **real** pdf.js on a generated 2-page PDF (page offsets), corrupted & text-less PDFs, **real** mammoth on a generated DOCX, TXT/MD; HTML readability; SSRF guard incl. redirect re-validation and size cap | |
| 6 | Chunk creation | Unit: exact slices, full coverage, overlap, page ranges, oversized paragraphs, termination | |
| 7 | Embedding generation | Unit: batching (32/request), one Content per input, task prefixes for embedding-2, taskType for 001, dimension check, L2 normalisation (SDK stubbed) | Live call covered by `test:live`. |
| 8 | Vector retrieval | DB: `match_chunks` hybrid search returns relevant chunk first, honours source filter | |
| 9 | AI question answering | Unit: streaming, deterministic "not covered" path without a model call, grounding/system prompt, history handling, follow-ups | Live answer quality covered by `test:live`. |
| 10 | Citation correctness | Unit: invalid markers stripped, ranges/groups expanded, markdown links ignored, citations map to retrieved chunks with char ranges | |
| 11 | Audio generation | Unit: script post-processing, segmenting, two-speaker voice mapping, **real MP3 encoding** (frame sync verified), WAV/PCM decoding, status transitions, failure paths | Live TTS covered by `test:live`. |
| 12 | User data isolation | DB: cross-user select/insert/update/delete, cross-user FK attach, retrieval isolation, usage-record immutability, storage isolation, share projection excludes raw text | |
| 13 | Responsive interface | e2e: no horizontal scroll on landing & login at mobile size; full suite runs on desktop and Pixel 7 profiles | |

## AI modes (added 2026-11-04)
- `tests/unit/gateway.test.ts`: Vercel AI Gateway chat (request shape, OIDC bearer, system message), SSE streaming + usage, JSON-schema output with fence stripping and retry, 429 retry, `customer_verification_required` → clear configuration error, embeddings (768 dims, batching, ordering, normalization, embedding-2 prefixes), speech (per-speaker voices, WAV decoding, stitching, unsupported formats).
- `tests/unit/ai-mode.test.ts`: mode selection (none / gemini / gateway / explicit overrides).
- Search mode: verbatim excerpts with validated citations, Markdown escaping (a source's own "[12]" never becomes a citation), no model calls; ingestion without embeddings; `search_chunks_text` relevance, isolation and source filters; chunks without embeddings found by both search functions.
- **Not verified live:** the gateway itself — the Vercel team has no credit card on file, so the gateway rejects requests (`customer_verification_required`).

## Defects found and fixed during testing
- Audio scripts left a stray space where citation markers were stripped (`"mitochondria ."`).
- Even sampling of long sources dropped the last characters of the document.
- Sanitised file names could contain doubled underscores.
- Sign-in network failures surfaced the raw browser message "Failed to fetch".
- Authenticated pages could be prerendered at build time when Supabase env vars were absent (now always request-time).
- Hero content was invisible until hydration (now CSS-animated, painted from SSR HTML).
- e2e initially attached to an unrelated app already listening on port 3100 (now a dedicated port, never reused).
- 15 React 19 lint errors (setState inside effects) refactored to keyed remounts / render-phase updates.

## Not verified here (requires your credentials)
- Real Supabase Auth flows (email confirmation, Google OAuth, password reset emails).
- Real Gemini calls (model availability on your key, answer quality, TTS audio). Run:
  ```bash
  GEMINI_API_KEY=... npm run test:live
  ```
- End-to-end happy path with a signed-in user (upload → chat → citation → Studio → audio). Run Playwright against a configured deployment with `E2E_BASE_URL=https://your-app npm run test:e2e` and extend `tests/e2e` with an authenticated fixture.

## How to run everything
```bash
npm run check        # lint + typecheck + all Vitest suites
npm run test:e2e     # builds and starts the app on port 39171, runs Playwright (uses installed Edge; PW_CHANNEL=chrome to switch)
```
