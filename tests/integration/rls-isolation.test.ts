import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * RLS isolation test (Story 1.2) — the hard tenant-isolation gate.
 *
 * Runs against a REAL (hosted) Supabase test project, never a mock. It seeds
 * two orgs, mints two auth users (a member of Org A; a stranger), builds
 * RLS-scoped clients from their JWTs, and proves the membership policy:
 *
 *   - a member of Org A reads Org A's records (> 0);
 *   - a stranger reads Org A → 0 rows (RLS filters silently);
 *   - a stranger INSERT into Org A is rejected by WITH CHECK.
 *
 * Credentials come from `SUPABASE_TEST_URL` / `SUPABASE_TEST_ANON_KEY` /
 * `SUPABASE_TEST_SERVICE_ROLE_KEY` (GitHub secrets in CI; a git-ignored
 * `.env.test.local` locally). Each run seeds unique orgs and cleans up, so it is
 * safe to re-run against the shared project. When the env is absent the suite
 * skips (so the plain unit run stays green without the test project).
 */

const URL = process.env.SUPABASE_TEST_URL;
const ANON = process.env.SUPABASE_TEST_ANON_KEY;
const SERVICE = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

// Fail loudly on a PARTIAL secret set rather than silently skipping: a
// half-configured hard gate would appear green while enforcing nothing.
const present = [URL, ANON, SERVICE].filter(Boolean).length;
if (present > 0 && present < 3) {
  throw new Error(
    "Partial SUPABASE_TEST_* configuration detected. Set ALL of SUPABASE_TEST_URL, " +
      "SUPABASE_TEST_ANON_KEY, and SUPABASE_TEST_SERVICE_ROLE_KEY (or none). Refusing " +
      "to silently skip the RLS isolation gate with an incomplete secret set.",
  );
}

const HAS_ENV = present === 3;
const describeRls = HAS_ENV ? describe : describe.skip;

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

describeRls("RLS tenant isolation (real Supabase)", () => {
  const admin = HAS_ENV ? adminClient() : (null as unknown as SupabaseClient);

  let orgA = "";
  let orgB = "";
  let memberId = "";
  let strangerId = "";
  let memberToken = "";
  let strangerToken = "";

  const memberEmail = `member-${runId}@rls-test.snapbusy.local`;
  const strangerEmail = `stranger-${runId}@rls-test.snapbusy.local`;
  const password = `Pw-${runId}-Aa1!`;

  beforeAll(async () => {
    if (!HAS_ENV) return;

    // Seed two orgs.
    const { data: orgs, error: orgErr } = await admin
      .from("organizations")
      .insert([
        { name: `Org A ${runId}`, slug: `org-a-${runId}` },
        { name: `Org B ${runId}`, slug: `org-b-${runId}` },
      ])
      .select("id, slug");
    if (orgErr) throw orgErr;
    orgA = orgs!.find((o) => o.slug === `org-a-${runId}`)!.id;
    orgB = orgs!.find((o) => o.slug === `org-b-${runId}`)!.id;

    // Create two confirmed auth users.
    const member = await admin.auth.admin.createUser({
      email: memberEmail,
      password,
      email_confirm: true,
    });
    if (member.error) throw member.error;
    memberId = member.data.user!.id;

    const stranger = await admin.auth.admin.createUser({
      email: strangerEmail,
      password,
      email_confirm: true,
    });
    if (stranger.error) throw stranger.error;
    strangerId = stranger.data.user!.id;

    // Member joins Org A; stranger joins Org B (so it is a real, unrelated org).
    const { error: memErr } = await admin.from("org_members").insert([
      { organization_id: orgA, user_id: memberId, role: "admin" },
      { organization_id: orgB, user_id: strangerId, role: "admin" },
    ]);
    if (memErr) throw memErr;

    // Seed a record into Org A (as admin — bypasses RLS).
    const { error: recErr } = await admin.from("records").insert({
      organization_id: orgA,
      table_key: TABLE_KEY,
      data: { name: "Org A client" },
      actor_id: memberId,
    });
    if (recErr) throw recErr;

    // Seed Org A's logical schema so org_schemas isolation can be exercised too.
    const { error: schemaErr } = await admin.from("org_schemas").insert({
      organization_id: orgA,
      definition: { tables: [{ key: TABLE_KEY, label: "Clients", fields: [] }] },
    });
    if (schemaErr) throw schemaErr;

    // Sign both users in to obtain RLS-scoped JWTs.
    const anonAuth = createClient(URL as string, ANON as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const memberSignIn = await anonAuth.auth.signInWithPassword({
      email: memberEmail,
      password,
    });
    if (memberSignIn.error) throw memberSignIn.error;
    memberToken = memberSignIn.data.session!.access_token;

    const strangerSignIn = await anonAuth.auth.signInWithPassword({
      email: strangerEmail,
      password,
    });
    if (strangerSignIn.error) throw strangerSignIn.error;
    strangerToken = strangerSignIn.data.session!.access_token;
  }, 30_000);

  afterAll(async () => {
    if (!HAS_ENV) return;
    // Cascade delete via org FK removes members + records; then remove users.
    if (orgA) await admin.from("organizations").delete().eq("id", orgA);
    if (orgB) await admin.from("organizations").delete().eq("id", orgB);
    if (memberId) await admin.auth.admin.deleteUser(memberId);
    if (strangerId) await admin.auth.admin.deleteUser(strangerId);
  }, 30_000);

  it("lets a member of Org A read Org A's records", async () => {
    const client = userClient(memberToken);
    const { data, error } = await client
      .from("records")
      .select("id")
      .eq("organization_id", orgA)
      .is("deleted_at", null);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("returns zero rows when a stranger reads Org A", async () => {
    const client = userClient(strangerToken);
    const { data, error } = await client
      .from("records")
      .select("id")
      .eq("organization_id", orgA);
    // RLS filters silently — no error, just no rows.
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });

  it("rejects a stranger INSERT into Org A (WITH CHECK)", async () => {
    const client = userClient(strangerToken);
    const { data, error } = await client.from("records").insert({
      organization_id: orgA,
      table_key: TABLE_KEY,
      data: { name: "malicious" },
    });
    // Either a policy error is raised, or nothing is written — never a success
    // that persists into Org A.
    expect(data).toBeNull();
    expect(error).not.toBeNull();

    // Confirm via the admin client that NO malicious row actually landed in
    // Org A — the assertion above alone could pass for the wrong reason.
    const { data: leaked, error: checkErr } = await admin
      .from("records")
      .select("id")
      .eq("organization_id", orgA)
      .contains("data", { name: "malicious" });
    expect(checkErr).toBeNull();
    expect((leaked ?? []).length).toBe(0);
  });

  it("lets a member of Org A read Org A's schema", async () => {
    const client = userClient(memberToken);
    const { data, error } = await client
      .from("org_schemas")
      .select("organization_id")
      .eq("organization_id", orgA);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
  });

  it("returns zero rows when a stranger reads Org A's schema", async () => {
    const client = userClient(strangerToken);
    const { data, error } = await client
      .from("org_schemas")
      .select("organization_id")
      .eq("organization_id", orgA);
    // Same membership policy guards org_schemas — the stranger sees nothing.
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });
});
