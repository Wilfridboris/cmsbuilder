import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  removeView,
  setTableVisibility,
  type SchemaMutateIdentity,
} from "@/lib/data/schema-mutate";
import { getSchema } from "@/lib/data/records";

/**
 * Real-DB integration test for the Epic-5 schema write path (retro Epic 5 [D6]).
 *
 * `setTableVisibility` (Story 5.7 hide-a-table) and `removeView` (Story 5.6) are
 * the two destructive-looking editor ops, yet the route + mutator unit tests mock
 * the Supabase client, so "the write persists", "hiding retains every row"
 * (append-only), and "the `.eq(organization_id)` scope actually isolates tenants"
 * ran unverified against Postgres. This exercises the shipped `withSchemaWrite`
 * read-modify-write skeleton against a REAL Supabase test project under an
 * RLS-scoped client, and proves a stranger (member of another org) cannot mutate
 * this org's schema even when handed this org's id.
 *
 * Credentials come from `SUPABASE_TEST_URL` / `SUPABASE_TEST_ANON_KEY` /
 * `SUPABASE_TEST_SERVICE_ROLE_KEY` (GitHub secrets in CI; a git-ignored
 * `.env.test.local` locally). Each run seeds two unique orgs + users and cleans
 * up, so it is safe to re-run. When the env is absent the suite skips (the plain
 * unit run stays green without the test project).
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
      "to silently skip the schema-mutate write test with an incomplete secret set.",
  );
}

const HAS_ENV = present === 3;
const describeDb = HAS_ENV ? describe : describe.skip;

const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function adminClient(): SupabaseClient {
  return createClient(URL as string, SERVICE as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function userClient(accessToken: string): SupabaseClient {
  return createClient(URL as string, ANON as string, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Seed an org + an admin user + membership; return ids and an RLS-scoped JWT. */
async function seedOrgWithAdmin(
  admin: SupabaseClient,
  label: string,
): Promise<{ orgId: string; userId: string; token: string }> {
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `${label} ${runId}`, slug: `${label}-${runId}` })
    .select("id")
    .single();
  if (orgErr) throw orgErr;
  const orgId = org!.id as string;

  const email = `${label}-${runId}@schema-test.scheza.local`;
  const password = `Pw-${runId}-Aa1!`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const userId = created.data.user!.id;

  const { error: memErr } = await admin
    .from("org_members")
    .insert({ organization_id: orgId, user_id: userId, role: "admin" });
  if (memErr) throw memErr;

  const anonAuth = createClient(URL as string, ANON as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await anonAuth.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;

  return { orgId, userId, token: signIn.data.session!.access_token };
}

describeDb("schema-mutate write path (real Supabase)", () => {
  const admin = HAS_ENV ? adminClient() : (null as unknown as SupabaseClient);

  // Org A is the subject under test; Org B's admin is the stranger.
  let a = { orgId: "", userId: "", token: "" };
  let b = { orgId: "", userId: "", token: "" };
  let identity: SchemaMutateIdentity; // Org A's own admin
  let strangerAsA: SchemaMutateIdentity; // Org B's admin, pointed at Org A

  // Two visible tables so hiding one is allowed (canHideTable needs >1 visible),
  // plus one view and two records in `jobs` to prove append-only row retention.
  const DEFINITION = {
    tables: [
      { key: "jobs", label: "Jobs", fields: [] },
      { key: "customers", label: "Customers", fields: [] },
    ],
    views: [
      {
        key: "open_jobs",
        label: "Open Jobs",
        sourceTableKey: "jobs",
        filters: [{ field: "status", operator: "equals", value: "open" }],
        sort: null,
      },
    ],
  };

  async function jobsRowCount(orgId: string): Promise<number> {
    const { count, error } = await admin
      .from("records")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("table_key", "jobs");
    if (error) throw error;
    return count ?? 0;
  }

  beforeAll(async () => {
    if (!HAS_ENV) return;
    a = await seedOrgWithAdmin(admin, "schema-a");
    b = await seedOrgWithAdmin(admin, "schema-b");

    const { error: schemaErr } = await admin
      .from("org_schemas")
      .insert({ organization_id: a.orgId, definition: DEFINITION });
    if (schemaErr) throw schemaErr;

    const { error: recErr } = await admin.from("records").insert([
      { organization_id: a.orgId, table_key: "jobs", data: { title: "One" }, actor_id: a.userId },
      { organization_id: a.orgId, table_key: "jobs", data: { title: "Two" }, actor_id: a.userId },
    ]);
    if (recErr) throw recErr;

    identity = { client: userClient(a.token), actorId: a.userId, orgId: a.orgId };
    strangerAsA = { client: userClient(b.token), actorId: b.userId, orgId: a.orgId };
  }, 60_000);

  afterAll(async () => {
    if (!HAS_ENV) return;
    for (const id of [a.orgId, b.orgId]) {
      if (id) await admin.from("organizations").delete().eq("id", id);
    }
    if (a.userId) await admin.auth.admin.deleteUser(a.userId);
    if (b.userId) await admin.auth.admin.deleteUser(b.userId);
  }, 60_000);

  it("hides a table (append-only): persists hidden:true, retains every row, and reverses", async () => {
    const before = await jobsRowCount(a.orgId);
    expect(before).toBe(2);

    const hide = await setTableVisibility(identity, "customers", true);
    expect(hide.error).toBeNull();
    expect(hide.data).toEqual({ tableKey: "customers", hidden: true });

    const afterHide = await getSchema(identity.client, a.orgId);
    const customers = afterHide.data?.tables.find((t) => t.key === "customers");
    expect(customers?.hidden).toBe(true);
    // Append-only: hiding is metadata-only — every record row is retained.
    expect(await jobsRowCount(a.orgId)).toBe(before);

    const show = await setTableVisibility(identity, "customers", false);
    expect(show.error).toBeNull();
    const afterShow = await getSchema(identity.client, a.orgId);
    expect(
      afterShow.data?.tables.find((t) => t.key === "customers")?.hidden,
    ).toBe(false);
  });

  it("refuses to hide the LAST visible table (tableHideLast), with no write", async () => {
    // Hide `customers` first so only `jobs` remains visible...
    await setTableVisibility(identity, "customers", true);
    // ...then hiding `jobs` would empty the dashboard → 400 tableHideLast, no write.
    await expect(setTableVisibility(identity, "jobs", true)).rejects.toMatchObject({
      statusCode: 400,
      userMessage: "tableHideLast",
    });
    const schema = await getSchema(identity.client, a.orgId);
    expect(schema.data?.tables.find((t) => t.key === "jobs")?.hidden).toBeFalsy();

    // Restore for a clean state.
    await setTableVisibility(identity, "customers", false);
  });

  it("removes a view: the view is gone from the persisted definition", async () => {
    const remove = await removeView(identity, "open_jobs");
    expect(remove.error).toBeNull();
    expect(remove.data?.view.key).toBe("open_jobs");

    const after = await getSchema(identity.client, a.orgId);
    expect((after.data?.views ?? []).some((v) => v.key === "open_jobs")).toBe(false);
  });

  it("tenant isolation: a stranger cannot mutate another org's schema", async () => {
    // Org B's admin, handed Org A's id, must not be able to hide Org A's table.
    // RLS filters A's org_schemas row from B, so the read-modify-write cannot
    // proceed and nothing is written to A.
    await expect(
      setTableVisibility(strangerAsA, "jobs", true),
    ).rejects.toBeDefined();

    const schema = await getSchema(identity.client, a.orgId);
    expect(schema.data?.tables.find((t) => t.key === "jobs")?.hidden).toBeFalsy();
  });
});
