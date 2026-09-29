import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  saveInvoiceDraft,
  discardInvoiceDraft,
  type InvoiceMutateIdentity,
} from "@/lib/data/invoice-mutate";

/**
 * Real-DB integration test for the invoice-draft write path (Story 12.2 review [VG]).
 *
 * `saveInvoiceDraft` / `discardInvoiceDraft` and the `save_invoice_draft` RPC are the
 * ONLY write path for invoice drafts, yet the route unit tests fully MOCK
 * `@/lib/data/invoice-mutate`, so the RPC's `invoice_draft_conflict` / SQLSTATE
 * `40001` → 409 `versionConflict` mapping, the version+status gate, the atomic
 * replace-all of line items, and the `discardInvoiceDraft` non-draft → `notDraft`
 * mapping ran unverified against Postgres. A drift in the RPC's errcode/text would
 * silently downgrade a conflict to `500 writeFailed` with the whole unit suite still
 * green. This exercises the shipped functions against a REAL Supabase test project
 * under an RLS-scoped client.
 *
 * Credentials come from `SUPABASE_TEST_URL` / `SUPABASE_TEST_ANON_KEY` /
 * `SUPABASE_TEST_SERVICE_ROLE_KEY` (GitHub secrets in CI; a git-ignored
 * `.env.test.local` locally). Each run seeds a unique org + admin user and cleans up,
 * so it is safe to re-run against the shared project. When the env is absent the suite
 * skips (the plain unit run stays green without the test project).
 */

const URL = process.env.SUPABASE_TEST_URL;
const ANON = process.env.SUPABASE_TEST_ANON_KEY;
const SERVICE = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

// Fail loudly on a PARTIAL secret set rather than silently skipping (mirrors the
// import + RLS gates): a half-configured write test would look green while verifying
// nothing.
const present = [URL, ANON, SERVICE].filter(Boolean).length;
if (present > 0 && present < 3) {
  throw new Error(
    "Partial SUPABASE_TEST_* configuration detected. Set ALL of SUPABASE_TEST_URL, " +
      "SUPABASE_TEST_ANON_KEY, and SUPABASE_TEST_SERVICE_ROLE_KEY (or none). Refusing " +
      "to silently skip the invoice-draft write test with an incomplete secret set.",
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

/** Build a draft-save input (the shape the route's `toWritableDraft` produces). */
function draft(
  invoiceId: string | null,
  version: number | null,
  lineItems: { description: string; quantity: number; unitPrice: number }[],
) {
  return {
    invoiceId,
    customerRecordId: null,
    province: "ON",
    language: "en" as const,
    version,
    lineItems,
  };
}

describeDb("invoice draft write path (real Supabase)", () => {
  const admin = HAS_ENV ? adminClient() : (null as unknown as SupabaseClient);

  let orgId = "";
  let userId = "";
  let identity: InvoiceMutateIdentity;

  const adminEmail = `invoice-${runId}@invoice-test.scheza.local`;
  const password = `Pw-${runId}-Aa1!`;

  async function lineItemsOf(invoiceId: string) {
    const { data, error } = await admin
      .from("invoice_line_items")
      .select("description, quantity, unit_price, amount, sort_order")
      .eq("invoice_id", invoiceId)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async function invoiceRow(invoiceId: string) {
    const { data } = await admin
      .from("invoices")
      .select("id, status, version")
      .eq("id", invoiceId)
      .maybeSingle();
    return data;
  }

  beforeAll(async () => {
    if (!HAS_ENV) return;

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({ name: `Invoice Org ${runId}`, slug: `invoice-org-${runId}` })
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

    identity = {
      client: userClient(signIn.data.session!.access_token),
      actorId: userId,
      orgId,
    };
  }, 30_000);

  afterAll(async () => {
    if (!HAS_ENV) return;
    if (orgId) await admin.from("organizations").delete().eq("id", orgId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  }, 30_000);

  it("creates a draft (status draft, version 1) with its line items + computed amounts", async () => {
    const result = await saveInvoiceDraft(
      identity,
      draft(null, null, [
        { description: "Consulting", quantity: 2, unitPrice: 50 },
        { description: "Parts", quantity: 3, unitPrice: 1.005 },
      ]),
    );

    expect(result.error).toBeNull();
    expect(result.data?.version).toBe(1);

    const row = await invoiceRow(result.data!.id);
    expect(row?.status).toBe("draft");

    const lines = await lineItemsOf(result.data!.id);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.sort_order)).toEqual([0, 1]);
    // amount = round(quantity * unit_price, 2); PostgREST returns numeric as string.
    expect(Number(lines[0].amount)).toBe(100);
    expect(Number(lines[1].amount)).toBe(3.02); // 3 × 1.005 → 3.02 (I2 rounding)
  });

  it("updates a draft with the correct version: bumps version and replaces line items", async () => {
    const created = await saveInvoiceDraft(
      identity,
      draft(null, null, [
        { description: "A", quantity: 1, unitPrice: 10 },
        { description: "B", quantity: 1, unitPrice: 20 },
      ]),
    );
    const id = created.data!.id;

    const updated = await saveInvoiceDraft(
      identity,
      draft(id, 1, [{ description: "Only one", quantity: 4, unitPrice: 2.5 }]),
    );
    expect(updated.error).toBeNull();
    expect(updated.data?.version).toBe(2);

    const lines = await lineItemsOf(id);
    expect(lines).toHaveLength(1); // replace-all: the two original lines are gone
    expect(lines[0].description).toBe("Only one");
    expect(Number(lines[0].amount)).toBe(10);
  });

  it("rejects a stale-version save with versionConflict and leaves line items intact", async () => {
    const created = await saveInvoiceDraft(
      identity,
      draft(null, null, [{ description: "Keep me", quantity: 1, unitPrice: 5 }]),
    );
    const id = created.data!.id;
    // Bump to version 2 so a version-1 save is now stale.
    await saveInvoiceDraft(
      identity,
      draft(id, 1, [{ description: "v2", quantity: 1, unitPrice: 7 }]),
    );

    await expect(
      saveInvoiceDraft(
        identity,
        draft(id, 1, [{ description: "should not land", quantity: 9, unitPrice: 9 }]),
      ),
    ).rejects.toMatchObject({ statusCode: 409, userMessage: "versionConflict" });

    // Atomicity: the rejected save wrote nothing — the v2 line set survives.
    const lines = await lineItemsOf(id);
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toBe("v2");
  });

  it("rejects updating / discarding a non-draft invoice (versionConflict / notDraft)", async () => {
    const created = await saveInvoiceDraft(
      identity,
      draft(null, null, [{ description: "X", quantity: 1, unitPrice: 1 }]),
    );
    const id = created.data!.id;
    // Flip to a non-draft status out-of-band (12.4 owns real transitions).
    await admin.from("invoices").update({ status: "issued" }).eq("id", id);

    await expect(
      saveInvoiceDraft(
        identity,
        draft(id, 1, [{ description: "no", quantity: 1, unitPrice: 1 }]),
      ),
    ).rejects.toMatchObject({ statusCode: 409, userMessage: "versionConflict" });

    await expect(discardInvoiceDraft(identity, id)).rejects.toMatchObject({
      statusCode: 409,
      userMessage: "notDraft",
    });

    // The issued invoice is untouched.
    const row = await invoiceRow(id);
    expect(row?.status).toBe("issued");
  });

  it("discards a draft: removes the invoice and cascades its line items", async () => {
    const created = await saveInvoiceDraft(
      identity,
      draft(null, null, [{ description: "Bye", quantity: 1, unitPrice: 1 }]),
    );
    const id = created.data!.id;

    const discarded = await discardInvoiceDraft(identity, id);
    expect(discarded.error).toBeNull();
    expect(discarded.data?.id).toBe(id);

    expect(await invoiceRow(id)).toBeNull();
    expect(await lineItemsOf(id)).toHaveLength(0);
  });
});
