import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { bulkInsertRecords, type MutateIdentity } from "@/lib/data/mutate";

/**
 * Real-DB integration test for `bulkInsertRecords` (retro Epic 4 [D3]).
 *
 * `bulkInsertRecords` is the ONLY tenant write in the import commit pipeline, yet
 * the route + planner unit tests fully MOCK the mutate layer, so its real behavior
 * — the idempotency pre-check, the atomic array insert, and the `23505` fallback —
 * ran unverified against Postgres until this test. That blind spot is what let the
 * original `.upsert({ onConflict })` form (which fails EVERY commit with `42P10` on
 * the PARTIAL unique idempotency index) survive a green unit run; it was caught only
 * by a manual `EXPLAIN`. This exercises the shipped pre-check + plain-insert path
 * against a REAL Supabase test project under an RLS-scoped client.
 *
 * Credentials come from `SUPABASE_TEST_URL` / `SUPABASE_TEST_ANON_KEY` /
 * `SUPABASE_TEST_SERVICE_ROLE_KEY` (GitHub secrets in CI; a git-ignored
 * `.env.test.local` locally). Each run seeds a unique org + admin user and cleans
 * up, so it is safe to re-run against the shared project. When the env is absent the
 * suite skips (the plain unit run stays green without the test project).
 */

const URL = process.env.SUPABASE_TEST_URL;
const ANON = process.env.SUPABASE_TEST_ANON_KEY;
const SERVICE = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

// Fail loudly on a PARTIAL secret set rather than silently skipping (mirrors the
// RLS isolation gate): a half-configured write test would look green while
// verifying nothing.
const present = [URL, ANON, SERVICE].filter(Boolean).length;
if (present > 0 && present < 3) {
  throw new Error(
    "Partial SUPABASE_TEST_* configuration detected. Set ALL of SUPABASE_TEST_URL, " +
      "SUPABASE_TEST_ANON_KEY, and SUPABASE_TEST_SERVICE_ROLE_KEY (or none). Refusing " +
      "to silently skip the import write test with an incomplete secret set.",
  );
}

const HAS_ENV = present === 3;
const describeDb = HAS_ENV ? describe : describe.skip;

const TABLE_KEY = "clients";
const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Admin client (service role — bypasses RLS) for seeding + cleanup only. */
function adminClient(): SupabaseClient {
  return createClient(URL as string, SERVICE as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** An anon-key client bearing a specific user's JWT — RLS-scoped as that user. */
function userClient(accessToken: string): SupabaseClient {
  return createClient(URL as string, ANON as string, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

describeDb("bulkInsertRecords (real Supabase)", () => {
  const admin = HAS_ENV ? adminClient() : (null as unknown as SupabaseClient);

  let orgId = "";
  let userId = "";
  let identity: MutateIdentity;

  const adminEmail = `import-${runId}@import-test.scheza.local`;
  const password = `Pw-${runId}-Aa1!`;

  // A per-test idempotency prefix so re-runs and the separate `it` blocks never
  // collide on the shared project.
  const key = (importId: string, i: number) =>
    `import-${runId}-${importId}-${TABLE_KEY}-${i}`;

  async function countRows(): Promise<number> {
    const { count, error } = await admin
      .from("records")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("table_key", TABLE_KEY);
    if (error) throw error;
    return count ?? 0;
  }

  beforeAll(async () => {
    if (!HAS_ENV) return;

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({ name: `Import Org ${runId}`, slug: `import-org-${runId}` })
      .select("id")
      .single();
    if (orgErr) throw orgErr;
    orgId = org!.id as string;

    const created = await admin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    userId = created.data.user!.id;

    const { error: memErr } = await admin
      .from("org_members")
      .insert({ organization_id: orgId, user_id: userId, role: "admin" });
    if (memErr) throw memErr;

    const anonAuth = createClient(URL as string, ANON as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signIn = await anonAuth.auth.signInWithPassword({
      email: adminEmail,
      password,
    });
    if (signIn.error) throw signIn.error;
    const token = signIn.data.session!.access_token;

    identity = { client: userClient(token), actorId: userId, orgId };
  }, 30_000);

  afterAll(async () => {
    if (!HAS_ENV) return;
    if (orgId) await admin.from("organizations").delete().eq("id", orgId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  }, 30_000);

  it("inserts a fresh batch under the RLS client and reports the row count", async () => {
    const importId = "fresh";
    const rows = [
      { data: { name: "Ada" }, idempotencyKey: key(importId, 0) },
      { data: { name: "Bea" }, idempotencyKey: key(importId, 1) },
      { data: { name: "Cid" }, idempotencyKey: key(importId, 2) },
    ];

    const before = await countRows();
    const result = await bulkInsertRecords(identity, TABLE_KEY, rows);

    expect(result.error).toBeNull();
    expect(result.data?.insertedCount).toBe(3);
    expect(await countRows()).toBe(before + 3);

    // The rows landed with the expected data + attribution under the RLS client.
    const { data: landed, error } = await admin
      .from("records")
      .select("data, actor_id, idempotency_key")
      .eq("organization_id", orgId)
      .eq("idempotency_key", key(importId, 0))
      .single();
    expect(error).toBeNull();
    expect(landed?.data).toEqual({ name: "Ada" });
    expect(landed?.actor_id).toBe(userId);
  });

  it("is idempotent: re-running the same importId inserts no duplicates", async () => {
    const importId = "retry";
    const rows = [
      { data: { name: "Xir" }, idempotencyKey: key(importId, 0) },
      { data: { name: "Yad" }, idempotencyKey: key(importId, 1) },
    ];

    const first = await bulkInsertRecords(identity, TABLE_KEY, rows);
    expect(first.error).toBeNull();
    expect(first.data?.insertedCount).toBe(2);
    const afterFirst = await countRows();

    // Second call with the SAME keys hits the pre-check short-circuit: no new rows,
    // same stable summary (a retried commit does not duplicate).
    const second = await bulkInsertRecords(identity, TABLE_KEY, rows);
    expect(second.error).toBeNull();
    expect(second.data?.insertedCount).toBe(2);
    expect(await countRows()).toBe(afterFirst);
  });

  it("treats a unique-violation (23505) on insert as idempotent success", async () => {
    const importId = "collide";
    // Pre-seed ONLY the second row's key so the pre-check (which reads row[0]) MISSES
    // and the array insert then trips the partial-unique idempotency index. The array
    // insert is atomic, so it all rolls back; the function swallows 23505 and reports
    // the stable count (the real retry path reuses ALL keys, so every row already
    // exists — this synthetic partial collision just exercises the 23505 branch).
    const { error: seedErr } = await identity.client.from("records").insert({
      organization_id: orgId,
      table_key: TABLE_KEY,
      data: { name: "pre-existing" },
      actor_id: userId,
      idempotency_key: key(importId, 1),
    });
    expect(seedErr).toBeNull();
    const before = await countRows();

    const rows = [
      { data: { name: "new-0" }, idempotencyKey: key(importId, 0) },
      { data: { name: "dup-1" }, idempotencyKey: key(importId, 1) },
    ];
    const result = await bulkInsertRecords(identity, TABLE_KEY, rows);

    // No throw, no leaked error, stable count.
    expect(result.error).toBeNull();
    expect(result.data?.insertedCount).toBe(2);
    // Atomic rollback: the colliding batch inserted nothing, so only the pre-seeded
    // row remains (the batch's new-0 key did NOT land).
    expect(await countRows()).toBe(before);
    const { data: newRow } = await admin
      .from("records")
      .select("id")
      .eq("organization_id", orgId)
      .eq("idempotency_key", key(importId, 0))
      .maybeSingle();
    expect(newRow).toBeNull();
  });

  it("short-circuits an empty batch to a zero count with no write", async () => {
    const result = await bulkInsertRecords(identity, TABLE_KEY, []);
    expect(result.error).toBeNull();
    expect(result.data?.insertedCount).toBe(0);
  });
});
