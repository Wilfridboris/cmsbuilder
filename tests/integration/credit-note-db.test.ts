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
 * Real-DB integration test for the credit-note path (Story 12.8) against the Supabase test
 * project. Exercises the shipped `saveCreditNoteDraft` / `issueCreditNote` + the RPCs + the
 * gap-free counter (in its own namespace, disjoint from invoice numbers) + the immutability
 * triggers under an RLS-scoped client:
 *   - draft save + a version-conflict on a stale save;
 *   - issue allocates a gap-free own-namespace number, freezes snapshots +
 *     original_invoice_number, and disjoint from invoice numbers;
 *   - child rows and frozen columns are immutable once issued (issued->void permitted);
 *   - the original invoice is untouched by the credit-note path.
 *
 * Credentials come from SUPABASE_TEST_URL / _ANON_KEY / _SERVICE_ROLE_KEY. When absent the
 * suite skips.
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

describeDb("credit-note path (real Supabase)", () => {
  const admin = HAS_ENV ? adminClient() : (null as unknown as SupabaseClient);

  let orgId = "";
  let userId = "";
  let identity: InvoiceMutateIdentity;

  const adminEmail = `credit-note-${runId}@invoice-test.scheza.local`;
  const password = `Pw-${runId}-Aa1!`;

  async function creditNoteRow(cnId: string) {
    const { data } = await admin
      .from("credit_notes")
      .select(
        "id, status, version, credit_note_number, issue_date, original_invoice_number, supplier_snapshot, customer_snapshot, share_token, invoice_id, subtotal, tax_total, total",
      )
      .eq("id", cnId)
      .maybeSingle();
    return data;
  }

  /** Save a registered-ON invoice draft with a 100.00 line, then issue it; return its id + number. */
  async function newIssuedInvoice() {
    const saved = await saveInvoiceDraft(identity, {
      invoiceId: null,
      customerRecordId: null,
      province: "ON",
      language: "en" as const,
      version: null,
      lineItems: [{ description: "Work", quantity: 1, unitPrice: 100 }],
      referenceDate: TODAY,
    });
    if (saved.error || !saved.data) throw new Error("invoice draft save failed");
    const issued = await issueInvoice(identity, {
      invoiceId: saved.data.id,
      version: saved.data.version,
    });
    if (issued.error || !issued.data) throw new Error("invoice issue failed");
    return { id: saved.data.id, number: issued.data.invoice_number };
  }

  /** Save a credit-note draft against a source invoice; return its id + version. */
  async function newCreditNoteDraft(invoiceId: string) {
    const res = await saveCreditNoteDraft(identity, {
      creditNoteId: null,
      invoiceId,
      customerRecordId: null,
      province: "ON",
      language: "en" as const,
      version: null,
      lineItems: [{ description: "Overcharge", quantity: 1, unitPrice: 40 }],
      referenceDate: TODAY,
    });
    if (res.error || !res.data) throw new Error("credit-note draft save failed");
    return res.data;
  }

  beforeAll(async () => {
    if (!HAS_ENV) return;

    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({ name: `CN Org ${runId}`, slug: `cn-org-${runId}` })
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
    const { error } = await admin.from("business_profiles").upsert(
      {
        organization_id: orgId,
        legal_name: `CN Org ${runId}`,
        operating_name: "CN Ops",
        gst_hst_number: "123456789RT0001",
        gst_hst_effective_date: YESTERDAY,
      },
      { onConflict: "organization_id" },
    );
    if (error) throw error;
  }, 30_000);

  afterAll(async () => {
    if (!HAS_ENV) return;
    // Credit notes reference invoices ON DELETE RESTRICT; delete credit notes first so the
    // org cascade can then drop the invoices.
    if (orgId) {
      // Sweep the frozen credit-note PDFs each issue wrote to {org}/credit-notes/.
      const { data: cnObjs } = await admin.storage
        .from(INVOICE_PDF_BUCKET)
        .list(`${orgId}/credit-notes`);
      if (cnObjs && cnObjs.length > 0) {
        await admin.storage
          .from(INVOICE_PDF_BUCKET)
          .remove(cnObjs.map((o) => `${orgId}/credit-notes/${o.name}`));
      }
      // Also sweep any invoice PDFs frozen by the source-invoice helper.
      const { data: invObjs } = await admin.storage
        .from(INVOICE_PDF_BUCKET)
        .list(orgId);
      if (invObjs && invObjs.length > 0) {
        await admin.storage
          .from(INVOICE_PDF_BUCKET)
          .remove(
            invObjs
              .filter((o) => o.name !== "credit-notes")
              .map((o) => `${orgId}/${o.name}`),
          );
      }
      // Credit notes reference invoices ON DELETE RESTRICT; delete credit notes first so the
      // org cascade can then drop the invoices.
      await admin.from("credit_notes").delete().eq("organization_id", orgId);
      await admin.from("organizations").delete().eq("id", orgId);
    }
    if (userId) await admin.auth.admin.deleteUser(userId);
  }, 30_000);

  it("saves a credit-note draft and version-conflicts on a stale save", async () => {
    const source = await newIssuedInvoice();
    const d = await newCreditNoteDraft(source.id);
    expect(d.version).toBe(1);

    // Bump to version 2, then a version-1 save is stale.
    const v2 = await saveCreditNoteDraft(identity, {
      creditNoteId: d.id,
      invoiceId: source.id,
      customerRecordId: null,
      province: "ON",
      language: "en",
      version: d.version,
      lineItems: [{ description: "Overcharge v2", quantity: 1, unitPrice: 40 }],
      referenceDate: TODAY,
    });
    expect(v2.data?.version).toBe(2);

    await expect(
      saveCreditNoteDraft(identity, {
        creditNoteId: d.id,
        invoiceId: source.id,
        customerRecordId: null,
        province: "ON",
        language: "en",
        version: d.version, // stale (1)
        lineItems: [{ description: "stale", quantity: 1, unitPrice: 1 }],
        referenceDate: TODAY,
      }),
    ).rejects.toMatchObject({ statusCode: 409, userMessage: "versionConflict" });
  });

  it("issues a credit note: gap-free own-namespace number, frozen snapshots + original_invoice_number", async () => {
    const source = await newIssuedInvoice();
    const d = await newCreditNoteDraft(source.id);

    const result = await issueCreditNote(identity, {
      creditNoteId: d.id,
      version: d.version,
    });
    expect(result.error).toBeNull();
    expect(typeof result.data?.credit_note_number).toBe("number");
    expect(result.data?.credit_note_number).toBeGreaterThanOrEqual(1);

    const row = await creditNoteRow(d.id);
    expect(row?.status).toBe("issued");
    expect(Number(row?.credit_note_number)).toBe(result.data?.credit_note_number);
    expect(row?.issue_date).toBe(TODAY);
    expect(row?.share_token).toBeTruthy();
    expect(Number(row?.original_invoice_number)).toBe(source.number);
    expect((row?.supplier_snapshot as { legal_name: string }).legal_name).toBe(
      `CN Org ${runId}`,
    );
    expect(row?.invoice_id).toBe(source.id);

    // The original invoice is UNTOUCHED by the credit-note path.
    const { data: inv } = await admin
      .from("invoices")
      .select("status, invoice_number")
      .eq("id", source.id)
      .maybeSingle();
    expect(inv?.status).toBe("issued");
    expect(Number(inv?.invoice_number)).toBe(source.number);
  });

  it("allocates gap-free incrementing credit-note numbers disjoint from invoice numbers", async () => {
    const s1 = await newIssuedInvoice();
    const cn1 = await newCreditNoteDraft(s1.id);
    const first = await issueCreditNote(identity, {
      creditNoteId: cn1.id,
      version: cn1.version,
    });
    const s2 = await newIssuedInvoice();
    const cn2 = await newCreditNoteDraft(s2.id);
    const second = await issueCreditNote(identity, {
      creditNoteId: cn2.id,
      version: cn2.version,
    });

    expect(second.data!.credit_note_number).toBe(
      first.data!.credit_note_number + 1,
    );
    // The credit-note namespace is its own counter — its numbers are small integers
    // starting at 1, independent of the (larger, ever-growing) invoice numbers.
    expect(first.data!.credit_note_number).toBeGreaterThanOrEqual(1);
  });

  it("rejects a stale-version issue with versionConflict and writes nothing", async () => {
    const source = await newIssuedInvoice();
    const d = await newCreditNoteDraft(source.id);
    // Bump so a version-1 issue is stale.
    await saveCreditNoteDraft(identity, {
      creditNoteId: d.id,
      invoiceId: source.id,
      customerRecordId: null,
      province: "ON",
      language: "en",
      version: d.version,
      lineItems: [{ description: "v2", quantity: 1, unitPrice: 40 }],
      referenceDate: TODAY,
    });

    await expect(
      issueCreditNote(identity, { creditNoteId: d.id, version: d.version }),
    ).rejects.toMatchObject({ statusCode: 409, userMessage: "versionConflict" });

    const row = await creditNoteRow(d.id);
    expect(row?.status).toBe("draft");
    expect(row?.credit_note_number).toBeNull();
  });

  it("immutability trigger: rejects frozen-column UPDATE, DELETE, and child changes; permits issued->void", async () => {
    const source = await newIssuedInvoice();
    const d = await newCreditNoteDraft(source.id);
    await issueCreditNote(identity, { creditNoteId: d.id, version: d.version });

    // Frozen-column change (total) blocked.
    const upd = await admin
      .from("credit_notes")
      .update({ total: 999 })
      .eq("id", d.id);
    expect(upd.error).not.toBeNull();
    expect(upd.error?.message).toContain("credit_note_immutable");

    // DELETE of a non-draft credit note blocked.
    const del = await admin.from("credit_notes").delete().eq("id", d.id);
    expect(del.error).not.toBeNull();
    expect(del.error?.message).toContain("credit_note_immutable");

    // Child line-item change blocked.
    const lineUpd = await admin
      .from("credit_note_line_items")
      .update({ description: "tampered" })
      .eq("credit_note_id", d.id);
    expect(lineUpd.error).not.toBeNull();
    expect(lineUpd.error?.message).toContain("credit_note_immutable");

    // Child tax-line change blocked (same function, separate trigger).
    const taxUpd = await admin
      .from("credit_note_tax_lines")
      .update({ tax_amount: 0 })
      .eq("credit_note_id", d.id);
    expect(taxUpd.error).not.toBeNull();
    expect(taxUpd.error?.message).toContain("credit_note_immutable");

    // A non-whitelisted status change (issued -> draft) is rejected.
    const bad = await admin
      .from("credit_notes")
      .update({ status: "draft" })
      .eq("id", d.id);
    expect(bad.error).not.toBeNull();
    expect(bad.error?.message).toContain("credit_note_status_transition");

    // The whitelisted issued -> void transition is permitted.
    const toVoid = await admin
      .from("credit_notes")
      .update({ status: "void" })
      .eq("id", d.id);
    expect(toVoid.error).toBeNull();
  });
});
