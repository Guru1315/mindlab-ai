import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

/**
 * Minimal stand-ins for the Supabase-managed schemas (auth, storage) and roles,
 * so the real migration files can be applied and RLS exercised in-process.
 * auth.uid() reads the same JWT claim setting PostgREST sets in production.
 */
const SUPABASE_SHIM = `
create schema if not exists extensions;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create role anon nologin;
create role authenticated nologin;

create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
`;

const GRANTS = `
grant usage on schema public, extensions, auth, storage to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema auth to anon, authenticated;
`;

export const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "supabase", "migrations");

export async function createTestDatabase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { vector } });
  await db.exec(SUPABASE_SHIM);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  await db.exec(GRANTS);
  return db;
}

export async function createUser(db: PGlite, id: string, email: string) {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    id,
    email,
    JSON.stringify({ full_name: email.split("@")[0] }),
  ]);
}

/** Run `fn` as an authenticated user, the way PostgREST does for a JWT. */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

export function fakeEmbedding(seed: number, dims = 768): string {
  const values = Array.from({ length: dims }, (_, i) => Math.sin(seed * 31 + i * 7) * 0.5);
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0));
  return `[${values.map((v) => (v / norm).toFixed(6)).join(",")}]`;
}
