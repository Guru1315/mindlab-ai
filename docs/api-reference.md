# API reference

All endpoints are Next.js route handlers under `/api`. They require a signed-in Supabase session (cookie) unless noted, and respond with JSON.

**Errors** use `{ "error": string, "code": string }`:

| Status | code | Meaning |
|---|---|---|
| 400 | `invalid_request` / `source_limit` | Validation failed (message is user-facing) |
| 401 | `unauthorized` | No valid session |
| 404 | `not_found` | Missing, malformed id, or not owned by the caller |
| 409 | `in_progress` / `already_ready` | Conflicting state |
| 429 | `rate_limited` | Usage limit reached (`Retry-After` header) |
| 502 | `ai_error` | Model returned an error/blocked/invalid output |
| 503 | `ai_not_configured` / `not_configured` | `GEMINI_API_KEY` or Supabase env missing |
| 500 | `internal` | Unexpected (details only in server logs) |

## Notebooks
| Method & path | Body / query | Response |
|---|---|---|
| `GET /api/notebooks` | `?q=` search, `?archived=true` | `{ notebooks: NotebookWithCounts[] }` |
| `POST /api/notebooks` | `{ title?, description?, emoji? }` | `201 { notebook }` |
| `GET /api/notebooks/:id` | — | `{ notebook }` |
| `PATCH /api/notebooks/:id` | `{ title?, description?, emoji?, is_archived?, touch?: true }` | `{ notebook }` |
| `DELETE /api/notebooks/:id` | — | `{ ok }` (cascades rows, removes stored files) |
| `POST /api/notebooks/:id/duplicate` | — | `201 { notebook }` (copies ready sources + chunks + artifacts) |
| `POST /api/notebooks/:id/share` | `{ enabled: boolean, rotate?: boolean }` | `{ share_enabled, share_token }` |
| `POST /api/notebooks/:id/overview` | — | `{ summary, suggested_questions }` (rate-limited) |
| `GET /api/notebooks/:id/saved` | — | `{ messages }` saved responses |

## Sources
| Method & path | Body / query | Response |
|---|---|---|
| `GET /api/notebooks/:id/sources` | — | `{ sources }` (without extracted text) |
| `POST /api/notebooks/:id/sources` | see below | `201 { sources }` — processing starts in the background |
| `PATCH /api/notebooks/:id/sources/selection` | `{ selected: boolean }` | `{ ok }` |
| `GET /api/sources/:id` | `?chunk=<chunkId>` optional | `{ source (incl. extracted_text, page_offsets), highlight? }` |
| `PATCH /api/sources/:id` | `{ title?, is_selected?, is_bookmarked? }` | `{ source }` |
| `DELETE /api/sources/:id` | — | `{ ok }` |
| `POST /api/sources/:id/retry` | — | `{ ok }` (failed, or stuck > 10 min) |
| `GET /api/sources/:id/file` | `?download=1` | `302` to a 1-hour signed URL |

`POST /api/notebooks/:id/sources` bodies (discriminated by `type`):
```jsonc
{ "type": "file", "files": [{ "storagePath": "<userId>/<notebookId>/<uuid>-name.pdf", "fileName": "name.pdf", "mimeType": "application/pdf", "size": 12345 }] } // ≤20
{ "type": "url", "urls": ["https://example.com/article"] }   // ≤10
{ "type": "text", "title": "Notes", "text": "..." }          // ≤1,000,000 chars
```
Files must already be uploaded by the browser to the `sources` bucket at a path inside the caller's notebook folder.

## Chat
| Method & path | Body | Response |
|---|---|---|
| `GET /api/notebooks/:id/chat` | — | `{ conversation, messages }` (latest conversation) |
| `POST /api/notebooks/:id/chat` | `{ question, sourceIds: uuid[], conversationId? }` | NDJSON stream (below) |
| `DELETE /api/notebooks/:id/chat` | — | `{ ok }` clears history |
| `PATCH /api/messages/:id` | `{ is_saved: boolean }` | `{ message }` |

Stream (`application/x-ndjson`, one JSON object per line):
```jsonc
{"type":"start","conversationId":"…","userMessageId":"…"}
{"type":"passages","citations":[Citation…]}        // candidate passages, numbered 1..n
{"type":"delta","text":"…"}                        // repeated
{"type":"final","text":"…","citations":[Citation…]}// validated text + cited passages only
{"type":"followups","questions":["…"]}             // optional
{"type":"done","messageId":"…"}
{"type":"error","error":"…","messageId":"…"}       // instead of final/done on failure
```
`Citation = { index, chunkId, sourceId, sourceTitle, sourceKind, excerpt, pageStart, pageEnd, charStart, charEnd }`. Aborting the request stops generation; the partial answer is saved with `status: "stopped"`.

## Studio
| Method & path | Body / query | Response |
|---|---|---|
| `GET /api/notebooks/:id/artifacts` | — | `{ artifacts }` |
| `POST /api/notebooks/:id/artifacts` | `{ type, sourceIds, focus? }` | `202 { artifact }` (`status: generating`) |
| `GET /api/artifacts/:id` | — | `{ artifact }` |
| `PATCH /api/artifacts/:id` | `{ title?, content?, data? }` | `{ artifact }` |
| `DELETE /api/artifacts/:id` | — | `{ ok }` |
| `POST /api/artifacts/:id/regenerate` | `{ focus? }` | `202 { artifact }` |
| `GET /api/artifacts/:id/export` | `?format=md\|json\|csv` (csv: flashcards) | file download |

`type` ∈ `study_guide, faq, briefing, timeline, key_concepts, flashcards, quiz, mind_map, comparison (≥2 sources), revision_notes`.

## Audio
| Method & path | Body | Response |
|---|---|---|
| `GET /api/notebooks/:id/audio` | — | `{ audio: (AudioGeneration & { url })[] }` (signed URLs for ready items) |
| `POST /api/notebooks/:id/audio` | `{ format?, length?, focus?, sourceIds, hostVoice?, guestVoice? }` | `202 { audio }` |
| `GET /api/audio/:id` | — | `{ audio: { …, url } }` (poll for status/progress) |
| `GET /api/audio/:id/download` | — | `302` to signed MP3 download |
| `DELETE /api/audio/:id` | — | `{ ok }` |

## Account
| Method & path | Body | Response |
|---|---|---|
| `GET /api/settings` | — | `{ profile, settings, models, aiConfigured }` |
| `PATCH /api/settings` | `{ profile?: { full_name }, settings?: Partial<UserSettings> }` | `{ ok }` |
| `GET /api/usage` | — | `{ windowDays, byKind, storage, limits }` |
| `GET /api/search` | `?q=…&notebookId=` | `{ results }` full-text matches across sources |

## Auth routes (not under /api)
- `GET /auth/callback?code=&next=` — OAuth / PKCE exchange (Google, email confirmation, password recovery).
- `GET /auth/confirm?token_hash=&type=` — email OTP verification (recovery → `/reset-password`).
- `POST /auth/signout` — clears the session, redirects to `/`.

## Public
- `GET /share/:token` (page) — read-only notebook via `get_shared_notebook` (no session required).

## Rate limits (defaults, per user)
chat 120/h · Studio & overview 30/h · audio 10/day · source imports 60/h. Configure with `RATE_LIMIT_*` env vars.
