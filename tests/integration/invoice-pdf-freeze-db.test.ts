import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  saveInvoiceDraft,
  issueInvoice,
  ensureInvoicePdf,
  type InvoiceMutateIdentity,
} from "@/lib/data/invoice-mutate";
import { INVOICE_PDF_BUCKET, invoicePdfObjectKey } from "@/lib/invoicing/storage";

/**
 * Real-DB integration test for the invoice PDF FREEZE path (Story 12.5) against the
 * Supabase test project. Exercises `issueInvoice` (which now calls `ensureInvoicePdf`)
 * + the private `invoice-pdfs` bucket + the one-time `null->value` pdf_path relaxation
 * of the immutability trigger under RLS-scoped clients:
 *   - issuing a draft sets `pdf_path` and the object downloads as a `%PDF`;
 *   - a second `ensureInvoicePdf` is a no-op (pdf_path unchanged);
 *   - the trigger permits the `null->value` write once and rejects a subsequent
 *     `value->value` pdf_path change on the issued invoice (invoice_immutable);
 *   - a cross-org client cannot read the object.
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
  lineItems: { description: string; quantity: number; unitPrice: number }[],
) {
  return {
    invoiceId: null,
    customerRecordId: null,
    province: "ON",
    language: "en" as const,
    version: null,
    lineItems,
    referenceDate: TODAY,
  };
}

describeDb("invoice PDF freeze path (real Supabase)", () => {
  const admin = HAS_ENV ? adminClient() : (null as unknown as SupabaseClient);

  let orgId = "";
  let userId = "";
  let identity: InvoiceMutateIdentity;

  // A second org + user for the cross-org read assertion.
  let otherOrgId = "";
  let otherUserId = "";
  let otherClient: SupabaseClient;

  const adminEmail = `invoice-pdf-${runId}@invoice-test.scheza.local`;
  const otherEmail = `invoice-pdf-other-${runId}@invoice-test.scheza.local`;
  const password = `Pw-${runId}-Aa1!`;

  async function newRegisteredDraft() {
    const res = await saveInvoiceDraft(
      identity,
      draft([{ description: "Work", quantity: 1, unitPrice: 100 }]),
    );
    if (res.error || !res.data) throw new Error("draft save failed");
    return res.data;
  }

  async function pdfPathOf(invoiceId: string): Promise<string | null> {
    const { data } = await admin
      .from("invoices")
      .select("pdf_path")
      .eq("id", invoiceId)
      .maybeSingle();
    return (data?.pdf_path as string | null) ?? null;
  }

  beforeAll(async () => {
    if (!HAS_ENV) return;

    // Primary org + admin.
    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({ name: `PDF Org ${runId}`, slug: `pdf-org-${runId}` })
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

    // Registered ON supplier effective yesterday, so tax applies today (a full PDF
    // with the HST line + payment block).
    const { error: profErr } = await admin.from("business_profiles").upsert(
      {
        organization_id: orgId,
        legal_name: `PDF Org ${runId}`,
        operating_name: "PDF Ops",
        gst_hst_number: "123456789RT0001",
        gst_hst_effective_date: YESTERDAY,
        business_address: "1 King St W, Toronto, ON",
        default_payment_terms: "Net 30",
        payment_etransfer_email: "pay@pdf.example",
      },
      { onConflict: "organization_id" },
    );
    if (profErr) throw profErr;

    // Second org + member for the cross-org read test.
    const { data: org2, error: org2Err } = await admin
      .from("organizations")
      .insert({ name: `PDF Org2 ${runId}`, slug: `pdf-org2-${runId}` })
      .select("id")
      .single();
    if (org2Err) throw org2Err;
    otherOrgId = org2!.id as string;

    const created2 = await admin.auth.admin.createUser({
      email: otherEmail,
      password,
      email_confirm: true,
    });
    if (created2.error) throw created2.error;
    otherUserId = created2.data.user!.id;

    const { error: mem2Err } = await admin
      .from("org_members")
      .insert({ organization_id: otherOrgId, user_id: otherUserId, role: "admin" });
    if (mem2Err) throw mem2Err;

    const anonAuth2 = createClient(URL as string, ANON as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signIn2 = await anonAuth2.auth.signInWithPassword({
      email: otherEmail,
      password,
    });
    if (signIn2.error) throw signIn2.error;
    otherClient = userClient(signIn2.data.session!.access_token);
  }, 60_000);

  afterAll(async () => {
    if (!HAS_ENV) return;
    // Remove stored PDF objects for both orgs, then the org rows + users.
    if (orgId) {
      const { data: objs } = await admin.storage
        .from(INVOICE_PDF_BUCKET)
        .list(orgId);
      if (objs && objs.length > 0) {
        await admin.storage
          .from(INVOICE_PDF_BUCKET)
          .remove(objs.map((o) => `${orgId}/${o.name}`));
      }
      await admin.from("organizations").delete().eq("id", orgId);
    }
    if (otherOrgId) await admin.from("organizations").delete().eq("id", otherOrgId);
    if (userId) await admin.auth.admin.deleteUser(userId);
    if (otherUserId) await admin.auth.admin.deleteUser(otherUserId);
  }, 60_000);

  it("issuing a draft freezes the PDF: pdf_path is set and the object downloads as a %PDF", async () => {
    const d = await newRegisteredDraft();
    const issued = await issueInvoice(identity, {
      invoiceId: d.id,
      version: d.version,
    });
    expect(issued.error).toBeNull();

    const key = invoicePdfObjectKey(orgId, d.id);
    const pdfPath = await pdfPathOf(d.id);
    expect(pdfPath).toBe(key);

    // The object exists at {org}/{id}.pdf and is a valid %PDF (download via admin).
    const { data: blob, error: dlErr } = await admin.storage
      .from(INVOICE_PDF_BUCKET)
      .download(key);
    expect(dlErr).toBeNull();
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(0);
    const magic = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
    expect(magic).toBe("%PDF-");
  }, 60_000);

  it("a second ensureInvoicePdf is a no-op (pdf_path unchanged, no re-write)", async () => {
    const d = await newRegisteredDraft();
    await issueInvoice(identity, { invoiceId: d.id, version: d.version });
    const first = await pdfPathOf(d.id);
    expect(first).toBeTruthy();

    // Re-run the freeze under the RLS client. Idempotent: no throw, path unchanged.
    await ensureInvoicePdf(identity, d.id);
    const second = await pdfPathOf(d.id);
    expect(second).toBe(first);
  }, 60_000);

  it("the immutability trigger permits the null->value pdf_path write once and rejects a later value->value change", async () => {
    const d = await newRegisteredDraft();
    await issueInvoice(identity, { invoiceId: d.id, version: d.version });
    const path = await pdfPathOf(d.id);
    expect(path).toBeTruthy(); // the one-time null->value write already succeeded

    // A value->value overwrite of pdf_path on the issued invoice is blocked.
    const overwrite = await admin
      .from("invoices")
      .update({ pdf_path: `${orgId}/tampered.pdf` })
      .eq("id", d.id);
    expect(overwrite.error).not.toBeNull();
    expect(overwrite.error?.message).toContain("invoice_immutable");

    // A null overwrite (value->null) of pdf_path is also blocked.
    const clear = await admin
      .from("invoices")
      .update({ pdf_path: null })
      .eq("id", d.id);
    expect(clear.error).not.toBeNull();
    expect(clear.error?.message).toContain("invoice_immutable");

    // pdf_path is unchanged.
    expect(await pdfPathOf(d.id)).toBe(path);
  }, 60_000);

  it("a cross-org client cannot read another org's PDF object", async () => {
    const d = await newRegisteredDraft();
    await issueInvoice(identity, { invoiceId: d.id, version: d.version });
    const key = invoicePdfObjectKey(orgId, d.id);
    expect(await pdfPathOf(d.id)).toBe(key);

    // A member of the OTHER org attempts to download org A's object under RLS. The
    // bucket policies scope reads to the caller's own org prefix, so this is denied
    // (an error) or returns no bytes.
    const { data: blob, error } = await otherClient.storage
      .from(INVOICE_PDF_BUCKET)
      .download(key);

    if (error) {
      expect(error).not.toBeNull();
    } else {
      // Some storage configs return an empty/opaque body rather than an error; either
      // way the cross-org caller never obtains the real %PDF bytes.
      const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
      const magic = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
      expect(magic).not.toBe("%PDF-");
    }
  }, 60_000);
});
