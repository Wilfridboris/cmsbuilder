import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  saveInvoiceDraft,
  issueInvoice,
  type InvoiceMutateIdentity,
} from "@/lib/data/invoice-mutate";

/**
 * Real-DB integration test for the invoice ISSUE path (Story 12.4) against the Supabase
 * test project. Exercises the shipped `issueInvoice` + the `issue_invoice` RPC + the
 * gap-free counter + the immutability triggers under an RLS-scoped client:
 *   - issuing a valid draft allocates a gap-free number, freezes snapshots + issue_date
 *     + share_token, and flips status to issued;
 *   - two issues in the same org increment the number;
 *   - a stale / non-draft issue raises the conflict (409 versionConflict);
 *   - the immutability trigger rejects a frozen-column UPDATE, a DELETE, and a child-row
 *     change on an issued invoice, and permits issued→paid / issued→void / issued→overdue
 *     / paid→overdue;
 *   - a standalone draft freezes customer_snapshot null.
 *
 * Credentials come from SUPABASE_TEST_URL / _ANON_KEY / _SERVICE_ROLE_KEY (a git-ignored
 * `.env.test.local` locally; GitHub secrets in CI). When absent the suite skips.
 */

const URL = process.env.SUPABASE_TEST_URL;
const ANON = process.env.SUPABASE_TEST_ANON_KEY;
const SERVICE = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

const present = [URL, ANON, SERVICE].filter(Boolean).length;
if (present > 0 && present < 3) {
  throw new Error(
    "Partial SUPABASE_TEST_* configuration detected. Set ALL of SUPABASE_TEST_URL, " +
      "SUPABASE_TEST_ANON_KEY, and SUPABASE_TEST_SERVICE_ROLE_KEY (or none).",
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

const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

function draft(
  invoiceId: string | null,
  version: number | null,
  lineItems: { description: string; quantity: number; unitPrice: number }[],
  customerRecordId: string | null = null,
) {
  return {
    invoiceId,
    customerRecordId,
    province: "ON",
    language: "en" as const,
    version,
    lineItems,
    referenceDate: TODAY,
  };
}

describeDb("invoice issue path (real Supabase)", () => {
  const admin = HAS_ENV ? adminClient() : (null as unknown as SupabaseClient);

  let orgId = "";
  let userId = "";
  let identity: InvoiceMutateIdentity;

  const adminEmail = `invoice-issue-${runId}@invoice-test.scheza.local`;
  const password = `Pw-${runId}-Aa1!`;

  async function invoiceRow(invoiceId: string) {
    const { data } = await admin
      .from("invoices")
      .select(
        "id, status, version, invoice_number, issue_date, supplier_snapshot, customer_snapshot, share_token, subtotal, tax_total, total",
      )
      .eq("id", invoiceId)
      .maybeSingle();
    return data;
  }

  async function setRegistration(
    gstHstNumber: string | null,
    effectiveDate: string | null,
  ) {
    const { error } = await admin.from("business_profiles").upsert(
      {
        organization_id: orgId,
        legal_name: `Issue Org ${runId}`,
        operating_name: "Issue Ops",
        gst_hst_number: gstHstNumber,
        gst_hst_effective_date: effectiveDate,
      },
      { onConflict: "organization_id" },
    );
    if (error) throw error;
  }

  /** Save a registered-ON draft with a 100.00 line and return its id + version. */
  async function newRegisteredDraft() {
    const res = await saveInvoiceDraft(
      identity,
      draft(null, null, [{ description: "Work", quantity: 1, unitPrice: 100 }]),
    );
    if (res.error || !res.data) throw new Error("draft save failed");
    return res.data;
  }

  beforeAll(async () => {
    if (!HAS_ENV) return;

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({ name: `Issue Org ${runId}`, slug: `issue-org-${runId}` })
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

    // Registered ON supplier effective yesterday, so tax applies today.
    await setRegistration("123456789RT0001", YESTERDAY);
  }, 30_000);

  afterAll(async () => {
    if (!HAS_ENV) return;
    if (orgId) await admin.from("organizations").delete().eq("id", orgId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  }, 30_000);

  it("issues a valid draft: allocates a number, freezes snapshots + issue_date + share_token, flips status", async () => {
    const d = await newRegisteredDraft();

    const result = await issueInvoice(identity, {
      invoiceId: d.id,
      version: d.version,
    });
    expect(result.error).toBeNull();
    expect(typeof result.data?.invoice_number).toBe("number");
    expect(result.data?.invoice_number).toBeGreaterThanOrEqual(1);

    const row = await invoiceRow(d.id);
    expect(row?.status).toBe("issued");
    expect(Number(row?.invoice_number)).toBe(result.data?.invoice_number);
    expect(row?.issue_date).toBe(TODAY);
    expect(row?.share_token).toBeTruthy();
    expect(String(row?.share_token).length).toBeGreaterThanOrEqual(20);
    // Supplier snapshot froze the legal + operating name.
    expect((row?.supplier_snapshot as { legal_name: string }).legal_name).toBe(
      `Issue Org ${runId}`,
    );
    expect(
      (row?.supplier_snapshot as { operating_name: string }).operating_name,
    ).toBe("Issue Ops");
    // Standalone invoice: customer snapshot is null.
    expect(row?.customer_snapshot).toBeNull();
    // Version bumped past the draft version.
    expect(Number(row?.version)).toBe(d.version + 1);
  });

  it("allocates gap-free incrementing numbers across two issues in the same org", async () => {
    const a = await newRegisteredDraft();
    const first = await issueInvoice(identity, {
      invoiceId: a.id,
      version: a.version,
    });
    const b = await newRegisteredDraft();
    const second = await issueInvoice(identity, {
      invoiceId: b.id,
      version: b.version,
    });

    expect(second.data!.invoice_number).toBe(first.data!.invoice_number + 1);
  });

  it("rejects a stale-version issue with versionConflict and writes nothing", async () => {
    const d = await newRegisteredDraft();
    // Bump the draft to version 2 via a save so a version-1 issue is now stale.
    await saveInvoiceDraft(
      identity,
      draft(d.id, d.version, [
        { description: "Work v2", quantity: 1, unitPrice: 100 },
      ]),
    );

    await expect(
      issueInvoice(identity, { invoiceId: d.id, version: d.version }),
    ).rejects.toMatchObject({ statusCode: 409, userMessage: "versionConflict" });

    const row = await invoiceRow(d.id);
    expect(row?.status).toBe("draft");
    expect(row?.invoice_number).toBeNull();
  });

  it("rejects re-issuing an already-issued invoice (notDraft)", async () => {
    const d = await newRegisteredDraft();
    const issued = await issueInvoice(identity, {
      invoiceId: d.id,
      version: d.version,
    });

    await expect(
      issueInvoice(identity, { invoiceId: d.id, version: issued.data!.version }),
    ).rejects.toMatchObject({ statusCode: 409, userMessage: "notDraft" });
  });

  it("immutability trigger: rejects a frozen-column UPDATE and a DELETE on an issued invoice", async () => {
    const d = await newRegisteredDraft();
    await issueInvoice(identity, { invoiceId: d.id, version: d.version });

    // A frozen-column change (total) is blocked by enforce_invoice_immutability.
    const upd = await admin
      .from("invoices")
      .update({ total: 999 })
      .eq("id", d.id);
    expect(upd.error).not.toBeNull();
    expect(upd.error?.message).toContain("invoice_immutable");

    // due_date is frozen at issue too (Story 12.7): it is not in the mutable whitelist,
    // so an UPDATE on the issued invoice is rejected by the same trigger.
    const dueUpd = await admin
      .from("invoices")
      .update({ due_date: "2027-01-01" })
      .eq("id", d.id);
    expect(dueUpd.error).not.toBeNull();
    expect(dueUpd.error?.message).toContain("invoice_immutable");

    // A DELETE of a non-draft invoice is blocked.
    const del = await admin.from("invoices").delete().eq("id", d.id);
    expect(del.error).not.toBeNull();
    expect(del.error?.message).toContain("invoice_immutable");

    const row = await invoiceRow(d.id);
    expect(Number(row?.total)).not.toBe(999);
    expect(row?.status).toBe("issued");
  });

  it("immutability trigger: rejects a child line-item change on an issued invoice", async () => {
    const d = await newRegisteredDraft();
    await issueInvoice(identity, { invoiceId: d.id, version: d.version });

    // Update a line item on the issued invoice — blocked by the child trigger.
    const upd = await admin
      .from("invoice_line_items")
      .update({ description: "tampered" })
      .eq("invoice_id", d.id);
    expect(upd.error).not.toBeNull();
    expect(upd.error?.message).toContain("invoice_immutable");

    // Insert a new line item on the issued invoice — also blocked.
    const ins = await admin.from("invoice_line_items").insert({
      invoice_id: d.id,
      organization_id: orgId,
      description: "sneaky",
      quantity: 1,
      unit_price: 1,
      amount: 1,
      sort_order: 99,
    });
    expect(ins.error).not.toBeNull();
    expect(ins.error?.message).toContain("invoice_immutable");

    // The SAME child trigger guards invoice_tax_lines (a separate trigger on the same
    // function). A tax-line UPDATE on the issued invoice is blocked too.
    const taxUpd = await admin
      .from("invoice_tax_lines")
      .update({ tax_amount: 0 })
      .eq("invoice_id", d.id);
    expect(taxUpd.error).not.toBeNull();
    expect(taxUpd.error?.message).toContain("invoice_immutable");

    // And a tax-line INSERT on the issued invoice is blocked.
    const taxIns = await admin.from("invoice_tax_lines").insert({
      invoice_id: d.id,
      organization_id: orgId,
      label: "HST",
      rate: 0.13,
      base: 1,
      tax_amount: 0.13,
      sort_order: 99,
    });
    expect(taxIns.error).not.toBeNull();
    expect(taxIns.error?.message).toContain("invoice_immutable");
  });

  it("immutability trigger: permits the whitelisted status transitions", async () => {
    const d = await newRegisteredDraft();
    await issueInvoice(identity, { invoiceId: d.id, version: d.version });

    // issued -> overdue
    const toOverdue = await admin
      .from("invoices")
      .update({ status: "overdue" })
      .eq("id", d.id);
    expect(toOverdue.error).toBeNull();

    // A non-whitelisted transition (overdue -> paid) is rejected.
    const bad = await admin
      .from("invoices")
      .update({ status: "paid" })
      .eq("id", d.id);
    expect(bad.error).not.toBeNull();
    expect(bad.error?.message).toContain("invoice_status_transition");

    // A fresh invoice: issued -> paid -> overdue is allowed.
    const e = await newRegisteredDraft();
    await issueInvoice(identity, { invoiceId: e.id, version: e.version });
    const toPaid = await admin
      .from("invoices")
      .update({ status: "paid" })
      .eq("id", e.id);
    expect(toPaid.error).toBeNull();
    const paidToOverdue = await admin
      .from("invoices")
      .update({ status: "overdue" })
      .eq("id", e.id);
    expect(paidToOverdue.error).toBeNull();

    // issued -> void on another fresh invoice.
    const f = await newRegisteredDraft();
    await issueInvoice(identity, { invoiceId: f.id, version: f.version });
    const toVoid = await admin
      .from("invoices")
      .update({ status: "void" })
      .eq("id", f.id);
    expect(toVoid.error).toBeNull();
  });

  it("blocks issuing a draft with a tax line but no valid registration (taxWithoutRegistration)", async () => {
    // A registered draft (tax line stored), then clear the registration so the gate
    // recomputes taxApplies=false against a stored tax line -> block.
    const d = await newRegisteredDraft();
    await admin
      .from("business_profiles")
      .update({ gst_hst_number: null, gst_hst_effective_date: null })
      .eq("organization_id", orgId);

    await expect(
      issueInvoice(identity, { invoiceId: d.id, version: d.version }),
    ).rejects.toMatchObject({
      statusCode: 422,
      userMessage: "Invoice.error.taxWithoutRegistration",
    });

    const row = await invoiceRow(d.id);
    expect(row?.status).toBe("draft");
    expect(row?.invoice_number).toBeNull();

    // Restore registration for any later tests.
    await setRegistration("123456789RT0001", YESTERDAY);
  });

  it("freezes a linked customer into customer_snapshot when a customer is linked", async () => {
    // Seed a minimal record to link. The customer label resolution is best-effort; the
    // snapshot always carries the record id + data.
    const { data: rec, error: recErr } = await admin
      .from("records")
      .insert({
        organization_id: orgId,
        table_key: "customers",
        data: { name: "Big Client" },
      })
      .select("id")
      .single();
    if (recErr) throw recErr;

    const saved = await saveInvoiceDraft(
      identity,
      draft(
        null,
        null,
        [{ description: "Work", quantity: 1, unitPrice: 100 }],
        rec!.id as string,
      ),
    );
    const issued = await issueInvoice(identity, {
      invoiceId: saved.data!.id,
      version: saved.data!.version,
    });
    expect(issued.error).toBeNull();

    const row = await invoiceRow(saved.data!.id);
    const snap = row?.customer_snapshot as {
      record_id: string;
      data: Record<string, unknown>;
    } | null;
    expect(snap).not.toBeNull();
    expect(snap?.record_id).toBe(rec!.id);
    expect(snap?.data).toMatchObject({ name: "Big Client" });
  });
});
