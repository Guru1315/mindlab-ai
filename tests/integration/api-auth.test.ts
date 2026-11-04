import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Route handlers read cookies via next/headers; outside a request we supply an
// empty cookie jar, i.e. an anonymous visitor.
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

const ID = "3f2b8a1e-7c4d-4e5f-9a6b-1c2d3e4f5a6b";
const params = (id = ID) => ({ params: Promise.resolve({ id }) });
const jsonRequest = (body: unknown, method = "POST") =>
  new Request("http://localhost/api", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("API routes reject unauthenticated requests", () => {
  beforeEach(() => {
    // Configured but unreachable Supabase: no session cookie means no user.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:9");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("GET /api/notebooks → 401", async () => {
    const { GET } = await import("@/app/api/notebooks/route");
    const res = await GET(new Request("http://localhost/api/notebooks"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "unauthorized" });
  });

  it("POST /api/notebooks → 401", async () => {
    const { POST } = await import("@/app/api/notebooks/route");
    expect((await POST(jsonRequest({ title: "x" }))).status).toBe(401);
  });

  it("POST /api/notebooks/:id/chat → 401 before any AI work", async () => {
    const { POST } = await import("@/app/api/notebooks/[id]/chat/route");
    const res = await POST(jsonRequest({ question: "hi", sourceIds: [] }), params());
    expect(res.status).toBe(401);
  });

  it("source, artifact, audio, settings and usage routes → 401", async () => {
    const source = await import("@/app/api/sources/[id]/route");
    const artifacts = await import("@/app/api/notebooks/[id]/artifacts/route");
    const audio = await import("@/app/api/notebooks/[id]/audio/route");
    const settings = await import("@/app/api/settings/route");
    const usage = await import("@/app/api/usage/route");
    const share = await import("@/app/api/notebooks/[id]/share/route");
    const responses = await Promise.all([
      source.GET(new Request("http://localhost"), params()),
      source.DELETE(new Request("http://localhost"), params()),
      artifacts.POST(jsonRequest({ type: "faq", sourceIds: [ID] }), params()),
      audio.POST(jsonRequest({ sourceIds: [ID] }), params()),
      settings.GET(),
      usage.GET(),
      share.POST(jsonRequest({ enabled: true }), params()),
    ]);
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 401, 401]);
  });

  it("returns 404 for malformed ids without touching the database", async () => {
    const { GET } = await import("@/app/api/sources/[id]/route");
    const res = await GET(new Request("http://localhost"), params("not-a-uuid"));
    expect(res.status).toBe(404);
  });
});

describe("API routes when Supabase is not configured", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("responds 503 with a clear configuration error", async () => {
    const { GET } = await import("@/app/api/notebooks/route");
    const res = await GET(new Request("http://localhost/api/notebooks"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/Supabase is not configured/);
  });
});
