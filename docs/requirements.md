# Requirements

Derived from the product brief and the research in `reverse-engineering-report.md`. Status reflects the current codebase (✅ implemented and tested · 🟡 implemented, needs live verification · ❌ not implemented).

## Functional requirements

### Accounts & access
| ID | Requirement | Status |
|---|---|---|
| FR-1 | Email/password sign-up and log-in | 🟡 (UI + Supabase Auth wired; needs a Supabase project) |
| FR-2 | Google OAuth sign-in | 🟡 (requires Google provider enabled in Supabase) |
| FR-3 | Forgot / reset password via email link | 🟡 |
| FR-4 | Protected routes redirect anonymous users to login | ✅ (e2e) |
| FR-5 | Profile (name) editable; email shown | 🟡 |
| FR-6 | Sign out | 🟡 |

### Notebooks
| ID | Requirement | Status |
|---|---|---|
| FR-10 | Create, rename (title/description/icon), delete notebooks | 🟡 |
| FR-11 | Archive / restore, duplicate (copies sources, chunks, artifacts) | 🟡 |
| FR-12 | Search notebooks by title/description; full-text search across source content | 🟡 |
| FR-13 | Dashboard shows recent notebooks and recently added sources | 🟡 |
| FR-14 | Read-only public share link (owner-controlled, revocable) | ✅ (DB function tested) / 🟡 UI |

### Sources & ingestion
| ID | Requirement | Status |
|---|---|---|
| FR-20 | Upload PDF, DOCX, TXT, MD (multi-file, drag & drop) | ✅ parsers / 🟡 upload |
| FR-21 | Add web pages by URL (SSRF-safe) and pasted text | ✅ |
| FR-22 | Validate type (extension + magic bytes), size and encoding | ✅ |
| FR-23 | Extract → normalize → chunk with page metadata → embed → store | ✅ (pipeline tested with fakes) / 🟡 live embeddings |
| FR-24 | Show per-source status (queued, processing, ready, failed + reason); retry | ✅ |
| FR-25 | Select/deselect sources for chat & Studio; select all | 🟡 |
| FR-26 | Rename, bookmark, remove sources; filter/search sources | 🟡 |
| FR-27 | Source guide summary per source; notebook overview + suggested questions | 🟡 |

### Chat (RAG)
| ID | Requirement | Status |
|---|---|---|
| FR-30 | Stream answers grounded only in selected sources of the active notebook | ✅ logic / 🟡 live |
| FR-31 | Numbered citations, validated against retrieved passages; invalid markers removed | ✅ |
| FR-32 | Say clearly when sources don't contain the answer (no model call when nothing retrieved) | ✅ |
| FR-33 | Clickable citation → popover → opens source at highlighted passage/page | 🟡 |
| FR-34 | Suggested and follow-up questions | 🟡 |
| FR-35 | Copy, regenerate, stop generation (partial answer kept), save response | 🟡 |
| FR-36 | Persistent history across sessions; clear history | 🟡 |
| FR-37 | Chat style (default/learning/custom) and length preferences | ✅ prompt / 🟡 UI |

### Source viewer
| ID | Requirement | Status |
|---|---|---|
| FR-40 | View extracted text with page/section navigation | ✅ helpers / 🟡 UI |
| FR-41 | Search within document with next/previous match | ✅ helpers |
| FR-42 | Highlight cited passage and scroll to it | 🟡 |
| FR-43 | Open original file (signed URL; PDFs open at the current page) | 🟡 |
| FR-44 | Ask about selected text | 🟡 |

### Studio
| ID | Requirement | Status |
|---|---|---|
| FR-50 | Study guide, FAQ, briefing doc, timeline, key concepts (entities/topics), revision notes, source comparison | ✅ generator / 🟡 live |
| FR-51 | Flashcards (flip/shuffle), multiple-choice quiz (score + explanations), mind map (expand/collapse) | ✅ schema / 🟡 UI |
| FR-52 | Open, edit (Markdown & flashcards), regenerate, delete, export (MD/JSON/CSV) | ✅ export / 🟡 UI |

### Audio overview
| ID | Requirement | Status |
|---|---|---|
| FR-60 | Formats: deep dive, brief, debate, critique; lengths; focus prompt; voice choice | ✅ pipeline / 🟡 live |
| FR-61 | Script generation grounded in sources; two-speaker TTS | ✅ (fakes) / 🟡 live TTS |
| FR-62 | Real progress (scripting → synthesizing → encoding → ready) | ✅ |
| FR-63 | Play/pause/seek/speed, download MP3, transcript, history | 🟡 |

### Settings
| ID | Requirement | Status |
|---|---|---|
| FR-70 | Theme (light/dark/system) saved to account | 🟡 |
| FR-71 | AI configuration (style, length, custom style, chat model override, default voices) | 🟡 |
| FR-72 | Usage (30-day tokens/requests by type), storage usage, limits | 🟡 |

## Non-functional requirements

| ID | Requirement | How it is met |
|---|---|---|
| NFR-1 | Per-user isolation | RLS on every table + composite FKs (tested with PGlite) |
| NFR-2 | Notebook-level isolation in retrieval | `match_chunks` filters by notebook + selected sources, runs as invoker (tested) |
| NFR-3 | No secrets in the browser | Only the publishable key is public; the service-role key is never used |
| NFR-4 | Prompt-injection resistance | Untrusted content fenced, look-alike tags neutralised, explicit rules (tested) |
| NFR-5 | Upload safety | Magic bytes, size, UTF-8 checks, sanitized names, owner-only storage paths (tested) |
| NFR-6 | SSRF safety for URL import | Scheme/port allow-list, DNS checks per redirect hop, size/time limits (tested) |
| NFR-7 | Rate limiting | Sliding windows backed by append-only `usage_records` |
| NFR-8 | Resilience | Retries with jittered backoff for transient AI errors; retryable source failures |
| NFR-9 | Observability | Structured JSON logs; usage records per AI call |
| NFR-10 | Responsive UI | Panels → tabs < 1024 px; no horizontal scroll (e2e at 375 px & Pixel 7) |
| NFR-11 | Accessibility | Labelled controls, keyboard support, reduced-motion respected |

## Out of scope (for now)
Interactive audio mode, multi-language audio, video overviews/infographics/slide decks, Google Drive/YouTube/audio/image sources, OCR of scanned PDFs, per-user collaboration roles, billing.
