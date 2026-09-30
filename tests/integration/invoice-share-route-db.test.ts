import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  saveInvoiceDraft,
  issueInvoice,
  type InvoiceMutateIdentity,
} from "@/lib/data/invoice-mutate";
import {
  saveCreditNoteDraft,
  issueCreditNote,
} from "@/lib/data/credit-note-mutate";
import { INVOICE_PDF_BUCKET } from "@/lib/invoicing/storage";

/**
 * Real-DB integration test for the PUBLIC `/i/[token]` share route (Story 12.6) against
 * the Supabase test project. Issues + freezes an invoice, then drives the actual route
 * handler's `GET` (with the admin client pointed at the test project) and asserts:
 *   - a valid token for a frozen invoice streams a `%PDF` as application/pdf;
 *   - an unknown token -> 404;
 *   - a matched invoice with a null pdf_path -> 404;
 *   - a voided invoice -> 410 Gone.
 *
 * Credentials come from SUPABASE_TEST_URL / _ANON_KEY / _SERVICE_ROLE_KEY. When absent
 * the suite skips. The route's `createAdminClient()` reads NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY, so those are temporarily pointed at the test project.
 */

const URL_ = process.env.SUPABASE_TEST_URL;
const ANON = process.env.SUPABASE_TEST_ANON_KEY;
const SERVICE = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

const present = [URL_, ANON, SERVICE].filter(Boolean).length;
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
  return createClient(URL_ as string, SERVICE as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function userClient(accessToken: string): SupabaseClient {
  return createClient(URL_ as string, ANON as string, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

function draft(lineItems: { description: string; quantity: number; unitPrice: number }[]) {
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

/** Build a minimal Request context for the GET handler with a token param. */
function ctx(token: string) {
  return { params: Promise.resolve({ token }) };
}
function req(): import("next/server").NextRequest {
  // The share GET does not use the request object beyond typing; a bare stub suffices.
  return {} as import("next/server").NextRequest;
}

describeDb("public /i/[token] share route (real Supabase)", () => {
  const admin = HAS_ENV ? adminClient() : (null as unknown as SupabaseClient);

  let orgId = "";
  let userId = "";
  let identity: InvoiceMutateIdentity;

  // Point the route's createAdminClient() at the test project for the run.
  const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Dynamically import the route AFTER the env is pointed at the test project.
  let GET: (
    r: import("next/server").NextRequest,
    c: { params: Promise<{ token: string }> },
  ) => Promise<Response>;

  const adminEmail = `invoice-share-${runId}@invoice-test.scheza.local`;
  const password = `Pw-${runId}-Aa1!`;

  async function newRegisteredDraft() {
    const res = await saveInvoiceDraft(
      identity,
      draft([{ description: "Work", quantity: 1, unitPrice: 100 }]),
    );
    if (res.error || !res.data) throw new Error("draft save failed");
    return res.data;
  }

  async function shareTokenOf(invoiceId: string): Promise<string> {
    const { data } = await admin
      .from("invoices")
      .select("share_token")
      .eq("id", invoiceId)
      .maybeSingle();
    return (data?.share_token as string | null) ?? "";
  }

  /** Issue a source invoice, then draft + issue a credit note against it; return the CN id. */
  async function newIssuedCreditNote(): Promise<string> {
    const d = await newRegisteredDraft();
    const issued = await issueInvoice(identity, { invoiceId: d.id, version: d.version });
    if (issued.error) throw new Error("source invoice issue failed");
    const cn = await saveCreditNoteDraft(identity, {
      creditNoteId: null,
      invoiceId: d.id,
      customerRecordId: null,
      province: "ON",
      language: "en",
      version: null,
      lineItems: [{ description: "Overcharge", quantity: 1, unitPrice: 40 }],
      referenceDate: TODAY,
    });
    if (cn.error || !cn.data) throw new Error("credit-note draft save failed");
    const issuedCn = await issueCreditNote(identity, {
      creditNoteId: cn.data.id,
      version: cn.data.version,
      invoiceId: d.id,
    });
    if (issuedCn.error) throw new Error("credit-note issue failed");
    return cn.data.id;
  }

  async function creditNoteShareTokenOf(cnId: string): Promise<string> {
    const { data } = await admin
      .from("credit_notes")
      .select("share_token")
      .eq("id", cnId)
      .maybeSingle();
    return (data?.share_token as string | null) ?? "";
  }

  beforeAll(async () => {
    if (!HAS_ENV) return;

    process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;
    ({ GET } = await import("@/app/i/[token]/route"));

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({ name: `Share Org ${runId}`, slug: `share-org-${runId}` })
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

    const anonAuth = createClient(URL_ as string, ANON as string, {
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

    const { error: profErr } = await admin.from("business_profiles").upsert(
      {
        organization_id: orgId,
        legal_name: `Share Org ${runId}`,
        gst_hst_number: "123456789RT0001",
        gst_hst_effective_date: YESTERDAY,
      },
      { onConflict: "organization_id" },
    );
    if (profErr) throw profErr;
  }, 60_000);

  afterAll(async () => {
    if (!HAS_ENV) return;
    if (orgId) {
      const { data: objs } = await admin.storage
        .from(INVOICE_PDF_BUCKET)
        .list(orgId);
      if (objs && objs.length > 0) {
        await admin.storage
          .from(INVOICE_PDF_BUCKET)
          .remove(objs.map((o) => `${orgId}/${o.name}`));
      }
      const { data: cnObjs } = await admin.storage
        .from(INVOICE_PDF_BUCKET)
        .list(`${orgId}/credit-notes`);
      if (cnObjs && cnObjs.length > 0) {
        await admin.storage
          .from(INVOICE_PDF_BUCKET)
          .remove(cnObjs.map((o) => `${orgId}/credit-notes/${o.name}`));
      }
      // Credit notes reference invoices ON DELETE RESTRICT; delete them first so the org
      // cascade can then drop the invoices.
      await admin.from("credit_notes").delete().eq("organization_id", orgId);
      await admin.from("organizations").delete().eq("id", orgId);
    }
    if (userId) await admin.auth.admin.deleteUser(userId);

    // Restore the env we borrowed.
    if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  }, 60_000);

  it("a valid token for a frozen invoice streams a %PDF as application/pdf", async () => {
    const d = await newRegisteredDraft();
    const issued = await issueInvoice(identity, { invoiceId: d.id, version: d.version });
    expect(issued.error).toBeNull();

    const token = await shareTokenOf(d.id);
    expect(token).toBeTruthy();

    const res = await GET(req(), ctx(token));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(res.headers.get("cache-control")).toContain("no-store");

    const bytes = new Uint8Array(await res.arrayBuffer());
    const magic = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
    expect(magic).toBe("%PDF-");
  }, 60_000);

  it("an unknown token -> 404", async () => {
    const res = await GET(req(), ctx("this-token-matches-nothing-000000"));
    expect(res.status).toBe(404);
  }, 30_000);

  it("a matched invoice with a null pdf_path -> 404 (not yet frozen)", async () => {
    // Directly INSERT an issued invoice with pdf_path null (the immutability trigger is
    // BEFORE UPDATE/DELETE only, so a fresh issued INSERT is permitted). This models the
    // real "issued but the freeze has not landed yet" state exactly.
    const token = `null-path-${runId}`;
    const { error: insErr } = await admin.from("invoices").insert({
      organization_id: orgId,
      status: "issued",
      language: "en",
      subtotal: 100,
      tax_total: 0,
      total: 100,
      invoice_number: 900001,
      issue_date: TODAY,
      supplier_snapshot: { legal_name: `Share Org ${runId}` },
      share_token: token,
      pdf_path: null,
      actor_id: userId,
    });
    expect(insErr).toBeNull();

    const res = await GET(req(), ctx(token));
    expect(res.status).toBe(404);
  }, 60_000);

  it("a voided invoice -> 410 Gone", async () => {
    const d = await newRegisteredDraft();
    await issueInvoice(identity, { invoiceId: d.id, version: d.version });
    const token = await shareTokenOf(d.id);

    // Transition to void (the immutability trigger permits issued->void).
    const { error: voidErr } = await admin
      .from("invoices")
      .update({ status: "void" })
      .eq("id", d.id);
    expect(voidErr).toBeNull();

    const res = await GET(req(), ctx(token));
    expect(res.status).toBe(410);
  }, 60_000);

  it("a valid token for a frozen credit note streams a %PDF as application/pdf", async () => {
    const cnId = await newIssuedCreditNote();
    const token = await creditNoteShareTokenOf(cnId);
    expect(token).toBeTruthy();

    const res = await GET(req(), ctx(token));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("credit-note-");

    const bytes = new Uint8Array(await res.arrayBuffer());
    const magic = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
    expect(magic).toBe("%PDF-");
  }, 60_000);

  it("a voided credit note -> 410 Gone", async () => {
    const cnId = await newIssuedCreditNote();
    const token = await creditNoteShareTokenOf(cnId);

    // The credit-note immutability trigger permits issued->void.
    const { error: voidErr } = await admin
      .from("credit_notes")
      .update({ status: "void" })
      .eq("id", cnId);
    expect(voidErr).toBeNull();

    const res = await GET(req(), ctx(token));
    expect(res.status).toBe(410);
  }, 60_000);
});
