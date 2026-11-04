/** Shared domain types mirroring the database schema (supabase/migrations). */

export type SourceKind = "pdf" | "docx" | "txt" | "md" | "url" | "text";
export type SourceStatus = "pending" | "processing" | "ready" | "failed";

export interface Notebook {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  emoji: string;
  is_archived: boolean;
  summary: string | null;
  suggested_questions: string[];
  share_enabled: boolean;
  share_token: string | null;
  last_opened_at: string;
  created_at: string;
  updated_at: string;
}

export interface NotebookWithCounts extends Notebook {
  source_count: number;
}

export interface Source {
  id: string;
  notebook_id: string;
  user_id: string;
  title: string;
  kind: SourceKind;
  status: SourceStatus;
  error: string | null;
  storage_path: string | null;
  mime_type: string | null;
  file_size: number;
  url: string | null;
  page_count: number;
  word_count: number;
  chunk_count: number;
  summary: string | null;
  is_selected: boolean;
  is_bookmarked: boolean;
  attempts: number;
  processing_started_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Columns safe to send to list views (excludes the large extracted_text). */
export const SOURCE_LIST_COLUMNS =
  "id, notebook_id, user_id, title, kind, status, error, storage_path, mime_type, file_size, url, page_count, word_count, chunk_count, summary, is_selected, is_bookmarked, attempts, processing_started_at, created_at, updated_at";

export interface Citation {
  /** The [n] marker number used in the answer text. */
  index: number;
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  sourceKind: SourceKind;
  excerpt: string;
  pageStart: number | null;
  pageEnd: number | null;
  charStart: number;
  charEnd: number;
}

export type MessageStatus = "streaming" | "complete" | "stopped" | "error";

export interface Message {
  id: string;
  conversation_id: string;
  notebook_id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  follow_up_questions: string[];
  status: MessageStatus;
  model: string | null;
  is_saved: boolean;
  created_at: string;
}

export interface Conversation {
  id: string;
  notebook_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export const ARTIFACT_TYPES = [
  "study_guide",
  "faq",
  "briefing",
  "timeline",
  "key_concepts",
  "flashcards",
  "quiz",
  "mind_map",
  "comparison",
  "revision_notes",
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export interface Flashcard {
  front: string;
  back: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export interface MindMapNode {
  label: string;
  children?: MindMapNode[];
}

export type ArtifactData =
  | { kind: "flashcards"; cards: Flashcard[] }
  | { kind: "quiz"; questions: QuizQuestion[] }
  | { kind: "mind_map"; root: MindMapNode }
  | null;

export interface GeneratedArtifact {
  id: string;
  notebook_id: string;
  type: ArtifactType;
  title: string;
  content: string | null;
  data: ArtifactData;
  status: "generating" | "ready" | "failed";
  error: string | null;
  source_ids: string[];
  model: string | null;
  created_at: string;
  updated_at: string;
}

export type AudioFormat = "deep_dive" | "brief" | "debate" | "critique";
export type AudioLength = "short" | "default" | "long";
export type AudioStatus = "queued" | "scripting" | "synthesizing" | "encoding" | "ready" | "failed";

export interface ScriptLine {
  speaker: string;
  text: string;
}

export interface AudioGeneration {
  id: string;
  notebook_id: string;
  status: AudioStatus;
  progress: number;
  format: AudioFormat;
  length: AudioLength;
  focus_prompt: string | null;
  title: string | null;
  script: { lines: ScriptLine[]; speakers: string[] } | null;
  storage_path: string | null;
  mime_type: string | null;
  duration_seconds: number | null;
  file_size: number | null;
  error: string | null;
  source_ids: string[];
  model: string | null;
  tts_model: string | null;
  voices: Record<string, string> | null;
  created_at: string;
  updated_at: string;
}

export interface UserSettings {
  user_id: string;
  theme: "system" | "light" | "dark";
  chat_model: string | null;
  chat_style: "default" | "learning" | "custom";
  custom_instructions: string | null;
  response_length: "short" | "default" | "long";
  audio_host_voice: string;
  audio_guest_voice: string;
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
}
