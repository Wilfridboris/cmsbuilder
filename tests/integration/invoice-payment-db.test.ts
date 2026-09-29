import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  saveInvoiceDraft,
  issueInvoice,
  recordPayment,
  type InvoiceMutateIdentity,
} from "@/lib/data/invoice-mutate";

/**
 * Real-DB integration test for the invoice PAYMENT path (Story 12.7) against the Supabase
 * test project. Exercises the shipped `recordPayment` + the `record_invoice_payment` RPC +
 * the invoice_payments table (deliberately outside the immutability triggers, I7) under an
 * RLS-scoped client:
 *   - recording a payment inserts exactly one invoice_payments row and flips status->paid;
 *   - a second mark-paid attempt is rejected (alreadyPaid) and no second row appears;
 *   - a stale version 409s (versionConflict) and writes nothing;
 *   - a non-issued (draft) invoice is rejected (notIssued);
 *   - a payment row is STILL editable/deletable after the invoice is frozen (I7).
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
) {
  return {
    invoiceId,
    customerRecordId: null,
    province: "ON",
    language: "en" as const,
    version,
    dueDate: null,
    lineItems,
    referenceDate: TODAY,
  };
}

describeDb("invoice payment path (real Supabase)", () => {
  const admin = HAS_ENV ? adminClient() : (null as unknown as SupabaseClient);

  let orgId = "";
  let userId = "";
  let identity: InvoiceMutateIdentity;

  const adminEmail = `invoice-pay-${runId}@invoice-test.scheza.local`;
  const password = `Pw-${runId}-Aa1!`;

  async function invoiceStatus(invoiceId: string) {
    const { data } = await admin
      .from("invoices")
      .select("status, version")
      .eq("id", invoiceId)
      .maybeSingle();
    return data;
  }

  async function paymentRows(invoiceId: string) {
    const { data } = await admin
      .from("invoice_payments")
      .select("*")
      .eq("invoice_id", invoiceId);
    return data ?? [];
  }

  /** Save a registered-ON draft with a 100.00 line and ISSUE it; return the issued row. */
  async function newIssuedInvoice() {
    const saved = await saveInvoiceDraft(
      identity,
      draft(null, null, [{ description: "Work", quantity: 1, unitPrice: 100 }]),
    );
    if (saved.error || !saved.data) throw new Error("draft save failed");
    const issued = await issueInvoice(identity, {
      invoiceId: saved.data.id,
      version: saved.data.version,
    });
    if (issued.error || !issued.data) throw new Error("issue failed");
    return { id: saved.data.id, version: issued.data.version };
  }

  beforeAll(async () => {
    if (!HAS_ENV) return;

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({ name: `Pay Org ${runId}`, slug: `pay-org-${runId}` })
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

    // Registered ON supplier effective yesterday, so tax applies today (so issuing works).
    const { error } = await admin.from("business_profiles").upsert(
      {
        organization_id: orgId,
        legal_name: `Pay Org ${runId}`,
        operating_name: "Pay Ops",
        gst_hst_number: "123456789RT0001",
        gst_hst_effective_date: YESTERDAY,
      },
      { onConflict: "organization_id" },
    );
    if (error) throw error;
  }, 30_000);

  afterAll(async () => {
    if (!HAS_ENV) return;
    if (orgId) await admin.from("organizations").delete().eq("id", orgId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  }, 30_000);

  it("records one payment and flips status->paid", async () => {
    const inv = await newIssuedInvoice();

    const result = await recordPayment(identity, {
      invoiceId: inv.id,
      version: inv.version,
      method: "etransfer",
      paidDate: TODAY,
      amount: 113,
      reference: "conf-abc",
    });
    expect(result.error).toBeNull();
    expect(result.data?.version).toBe(inv.version + 1);

    const row = await invoiceStatus(inv.id);
    expect(row?.status).toBe("paid");

    const payments = await paymentRows(inv.id);
    expect(payments.length).toBe(1);
    expect(payments[0].method).toBe("etransfer");
    expect(Number(payments[0].amount)).toBe(113);
    expect(payments[0].reference).toBe("conf-abc");
    expect(payments[0].actor_id).toBe(userId);
  });

  it("rejects a second mark-paid attempt (alreadyPaid) and keeps one payment row", async () => {
    const inv = await newIssuedInvoice();
    const first = await recordPayment(identity, {
      invoiceId: inv.id,
      version: inv.version,
      method: "cheque",
      paidDate: TODAY,
      amount: 113,
      reference: null,
    });

    await expect(
      recordPayment(identity, {
        invoiceId: inv.id,
        version: first.data!.version,
        method: "card",
        paidDate: TODAY,
        amount: 113,
        reference: null,
      }),
    ).rejects.toMatchObject({ statusCode: 409, userMessage: "alreadyPaid" });

    const payments = await paymentRows(inv.id);
    expect(payments.length).toBe(1);
  });

  it("rejects a stale-version payment (versionConflict) and writes nothing", async () => {
    const inv = await newIssuedInvoice();
    // Advance the invoice version out from under a stale caller by marking paid, which
    // makes the original issued version stale for a would-be concurrent caller.
    // Instead, drive the gate directly: use a wrong version against the issued row.
    await expect(
      recordPayment(identity, {
        invoiceId: inv.id,
        version: inv.version + 99,
        method: "etransfer",
        paidDate: TODAY,
        amount: 113,
        reference: null,
      }),
    ).rejects.toMatchObject({ statusCode: 409, userMessage: "versionConflict" });

    const row = await invoiceStatus(inv.id);
    expect(row?.status).toBe("issued");
    expect((await paymentRows(inv.id)).length).toBe(0);
  });

  it("rejects marking a draft paid (notIssued)", async () => {
    const saved = await saveInvoiceDraft(
      identity,
      draft(null, null, [{ description: "Work", quantity: 1, unitPrice: 100 }]),
    );

    await expect(
      recordPayment(identity, {
        invoiceId: saved.data!.id,
        version: saved.data!.version,
        method: "etransfer",
        paidDate: TODAY,
        amount: 113,
        reference: null,
      }),
    ).rejects.toMatchObject({ statusCode: 409, userMessage: "notIssued" });

    expect((await paymentRows(saved.data!.id)).length).toBe(0);
  });

  it("leaves the payment row mutable after the invoice is frozen (I7)", async () => {
    const inv = await newIssuedInvoice();
    await recordPayment(identity, {
      invoiceId: inv.id,
      version: inv.version,
      method: "etransfer",
      paidDate: TODAY,
      amount: 113,
      reference: "orig",
    });

    const before = await paymentRows(inv.id);
    const paymentId = before[0].id as string;

    // The parent invoice is now `paid` (frozen). The payment row must still be editable —
    // it is deliberately outside the immutability triggers (I7).
    const upd = await admin
      .from("invoice_payments")
      .update({ reference: "corrected" })
      .eq("id", paymentId);
    expect(upd.error).toBeNull();

    const { data: after } = await admin
      .from("invoice_payments")
      .select("reference")
      .eq("id", paymentId)
      .maybeSingle();
    expect(after?.reference).toBe("corrected");

    // And deletable — still no immutability trigger on this table.
    const del = await admin
      .from("invoice_payments")
      .delete()
      .eq("id", paymentId);
    expect(del.error).toBeNull();
    expect((await paymentRows(inv.id)).length).toBe(0);
  });
});
