import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, fakeEmbedding } from "./harness";

const ALICE = "00000000-0000-4000-8000-00000000000a";
const BOB = "00000000-0000-4000-8000-00000000000b";

let db: PGlite;
let aliceNotebook: string;
let aliceSource: string;

beforeAll(async () => {
  db = await createTestDatabase();
  await createUser(db, ALICE, "alice@example.com");
  await createUser(db, BOB, "bob@example.com");

  await asUser(db, ALICE, async () => {
    const nb = await db.query<{ id: string }>(
      `insert into notebooks (user_id, title) values ($1, 'Alice research') returning id`,
      [ALICE],
    );
    aliceNotebook = nb.rows[0].id;
    const src = await db.query<{ id: string }>(
      `insert into sources (notebook_id, user_id, title, kind, status) values ($1, $2, 'Photosynthesis notes', 'text', 'ready') returning id`,
      [aliceNotebook, ALICE],
    );
    aliceSource = src.rows[0].id;
    const passages = [
      "Photosynthesis converts light energy into chemical energy stored in glucose.",
      "Chlorophyll in the thylakoid membranes absorbs mostly blue and red light.",
      "The Calvin cycle fixes carbon dioxide in the stroma of the chloroplast.",
    ];
    for (const [i, content] of passages.entries()) {
      await db.query(
        `insert into document_chunks (source_id, notebook_id, user_id, chunk_index, content, char_start, char_end, page_start, page_end, embedding)
         values ($1, $2, $3, $4, $5, $6, $7, 1, 1, $8)`,
        [aliceSource, aliceNotebook, ALICE, i, content, i * 100, i * 100 + content.length, fakeEmbedding(i + 1)],
      );
    }
  });
});

afterAll(async () => {
  await db?.close();
});

describe("schema", () => {
  it("creates a profile and settings row for every new auth user", async () => {
    const profiles = await db.query<{ id: string; full_name: string }>(`select id, full_name from profiles order by email`);
    expect(profiles.rows.map((r) => r.id)).toEqual([ALICE, BOB]);
    expect(profiles.rows[0].full_name).toBe("alice");
    const settings = await db.query(`select user_id, chat_style, audio_host_voice from user_settings`);
    expect(settings.rows).toHaveLength(2);
  });

  it("creates all required tables with RLS enabled", async () => {
    const res = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname`,
    );
    const tables = Object.fromEntries(res.rows.map((r) => [r.relname, r.relrowsecurity]));
    for (const t of [
      "profiles", "notebooks", "sources", "document_chunks", "conversations",
      "messages", "generated_artifacts", "audio_generations", "user_settings", "usage_records",
    ]) {
      expect(tables[t], `table ${t}`).toBe(true);
    }
  });

  it("maintains updated_at on update", async () => {
    await asUser(db, ALICE, async () => {
      const before = await db.query<{ updated_at: Date }>(`select updated_at from notebooks where id = $1`, [aliceNotebook]);
      await new Promise((r) => setTimeout(r, 10));
      await db.query(`update notebooks set title = 'Alice research v2' where id = $1`, [aliceNotebook]);
      const after = await db.query<{ updated_at: Date }>(`select updated_at from notebooks where id = $1`, [aliceNotebook]);
      expect(after.rows[0].updated_at.getTime()).toBeGreaterThanOrEqual(before.rows[0].updated_at.getTime());
    });
  });
});

describe("user data isolation (RLS)", () => {
  it("hides another user's notebooks, sources and chunks", async () => {
    await asUser(db, BOB, async () => {
      expect((await db.query(`select * from notebooks`)).rows).toHaveLength(0);
      expect((await db.query(`select * from sources`)).rows).toHaveLength(0);
      expect((await db.query(`select * from document_chunks`)).rows).toHaveLength(0);
    });
    await asUser(db, ALICE, async () => {
      expect((await db.query(`select * from notebooks`)).rows).toHaveLength(1);
      expect((await db.query(`select * from document_chunks`)).rows).toHaveLength(3);
    });
  });

  it("rejects inserting rows that claim another user's id", async () => {
    await asUser(db, BOB, async () => {
      await expect(
        db.query(`insert into notebooks (user_id, title) values ($1, 'spoof')`, [ALICE]),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("rejects attaching a source to another user's notebook", async () => {
    await asUser(db, BOB, async () => {
      await expect(
        db.query(
          `insert into sources (notebook_id, user_id, title, kind) values ($1, $2, 'intruder', 'text')`,
          [aliceNotebook, BOB],
        ),
      ).rejects.toThrow(/foreign key|violates/i);
    });
  });

  it("silently affects zero rows when updating or deleting another user's data", async () => {
    await asUser(db, BOB, async () => {
      const upd = await db.query(`update notebooks set title = 'hacked' where id = $1`, [aliceNotebook]);
      expect(upd.affectedRows).toBe(0);
      const del = await db.query(`delete from sources where id = $1`, [aliceSource]);
      expect(del.affectedRows).toBe(0);
    });
    const check = await db.query<{ title: string }>(`select title from notebooks where id = $1`, [aliceNotebook]);
    expect(check.rows[0].title).not.toBe("hacked");
  });

  it("match_chunks only returns the caller's chunks", async () => {
    const query = fakeEmbedding(2);
    const asAlice = await asUser(db, ALICE, () =>
      db.query<{ content: string }>(`select * from match_chunks($1, $2::extensions.vector, 'chlorophyll light', null, 5)`, [
        aliceNotebook,
        query,
      ]),
    );
    expect(asAlice.rows.length).toBeGreaterThan(0);
    expect(asAlice.rows[0].content).toMatch(/Chlorophyll/);

    const asBob = await asUser(db, BOB, () =>
      db.query(`select * from match_chunks($1, $2::extensions.vector, 'chlorophyll', null, 5)`, [aliceNotebook, query]),
    );
    expect(asBob.rows).toHaveLength(0);
  });

  it("match_chunks respects the selected source filter", async () => {
    const res = await asUser(db, ALICE, () =>
      db.query(`select * from match_chunks($1, $2::extensions.vector, 'light', array[gen_random_uuid()], 5)`, [
        aliceNotebook,
        fakeEmbedding(1),
      ]),
    );
    expect(res.rows).toHaveLength(0);
  });

  it("search_chunks_text answers natural questions by keyword (no embeddings needed)", async () => {
    const res = await asUser(db, ALICE, () =>
      db.query<{ content: string; similarity: number | null; rank_score: number }>(
        `select * from search_chunks_text($1, 'Which part of the chloroplast fixes carbon dioxide?', null, 5)`,
        [aliceNotebook],
      ),
    );
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows[0].content).toMatch(/Calvin cycle/);
    expect(res.rows[0].similarity).toBeNull();
    expect(res.rows[0].rank_score).toBeGreaterThan(0);
  });

  it("search_chunks_text is isolated per user and honours source filters", async () => {
    const asBob = await asUser(db, BOB, () => db.query(`select * from search_chunks_text($1, 'chlorophyll light', null, 5)`, [aliceNotebook]));
    expect(asBob.rows).toHaveLength(0);
    const filtered = await asUser(db, ALICE, () =>
      db.query(`select * from search_chunks_text($1, 'chlorophyll', array[gen_random_uuid()], 5)`, [aliceNotebook]),
    );
    expect(filtered.rows).toHaveLength(0);
    const empty = await asUser(db, ALICE, () => db.query(`select * from search_chunks_text($1, 'the and of', null, 5)`, [aliceNotebook]));
    expect(empty.rows).toHaveLength(0);
  });

  it("finds chunks stored without an embedding through both search functions", async () => {
    await asUser(db, ALICE, async () => {
      await db.query(
        `insert into document_chunks (source_id, notebook_id, user_id, chunk_index, content, char_start, char_end)
         values ($1, $2, $3, 99, 'Stomata regulate gas exchange through guard cells.', 0, 50)`,
        [aliceSource, aliceNotebook, ALICE],
      );
      const keyword = await db.query<{ content: string }>(`select * from search_chunks_text($1, 'How do stomata work?', null, 5)`, [aliceNotebook]);
      expect(keyword.rows[0].content).toMatch(/Stomata/);
      const hybrid = await db.query<{ content: string; similarity: number | null }>(
        `select * from match_chunks($1, $2::extensions.vector, 'stomata guard cells', null, 5)`,
        [aliceNotebook, fakeEmbedding(3)],
      );
      const stomata = hybrid.rows.find((r) => /Stomata/.test(r.content));
      expect(stomata).toBeDefined();
      expect(stomata!.similarity).toBeNull();
    });
  });

  it("does not let users delete usage records (rate limits cannot be reset)", async () => {
    await asUser(db, ALICE, async () => {
      await db.query(`insert into usage_records (user_id, kind, units) values ($1, 'chat', 1)`, [ALICE]);
      const del = await db.query(`delete from usage_records`);
      expect(del.affectedRows).toBe(0);
      const count = await db.query<{ n: number }>(`select count(*)::int as n from usage_records`);
      expect(count.rows[0].n).toBe(1);
    });
  });

  it("restricts storage objects to the owner's folder", async () => {
    await asUser(db, ALICE, async () => {
      await db.query(`insert into storage.objects (bucket_id, name) values ('sources', $1)`, [`${ALICE}/nb/file.pdf`]);
      await expect(
        db.query(`insert into storage.objects (bucket_id, name) values ('sources', $1)`, [`${BOB}/nb/file.pdf`]),
      ).rejects.toThrow(/row-level security/i);
    });
    await asUser(db, BOB, async () => {
      expect((await db.query(`select * from storage.objects`)).rows).toHaveLength(0);
    });
  });
});

describe("read-only sharing", () => {
  it("returns nothing until the owner enables sharing", async () => {
    const token = "t".repeat(32);
    const before = await asUser(db, BOB, () =>
      db.query<{ get_shared_notebook: unknown }>(`select get_shared_notebook($1)`, [token]),
    );
    expect(before.rows[0].get_shared_notebook).toBeNull();

    await asUser(db, BOB, async () => {
      const r = await db.query(`update notebooks set share_enabled = true, share_token = $1 where id = $2`, [token, aliceNotebook]);
      expect(r.affectedRows).toBe(0);
    });
    await asUser(db, ALICE, () =>
      db.query(`update notebooks set share_enabled = true, share_token = $1 where id = $2`, [token, aliceNotebook]),
    );

    const after = await asUser(db, BOB, () =>
      db.query<{ get_shared_notebook: { notebook: { title: string }; sources: unknown[] } }>(
        `select get_shared_notebook($1)`,
        [token],
      ),
    );
    const shared = after.rows[0].get_shared_notebook;
    expect(shared.notebook.title).toMatch(/Alice research/);
    expect(shared.sources).toHaveLength(1);
    expect(JSON.stringify(shared)).not.toContain("Calvin cycle");
  });

  it("rejects short or wrong tokens", async () => {
    const r = await db.query<{ get_shared_notebook: unknown }>(`select get_shared_notebook('short')`);
    expect(r.rows[0].get_shared_notebook).toBeNull();
  });
});
