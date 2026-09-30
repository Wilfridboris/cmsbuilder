import "server-only";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { InvoiceLanguage } from "@/types/db";
import {
  computeInvoiceTotals,
  computeLineAmount,
  formatInvoiceNumber,
  isRegistrationEffective,
} from "@/lib/invoicing/tax";
import {
  assertIssuableCreditNote,
  type CreditNoteCeiling,
} from "@/lib/invoicing/validate";
import { mintShareToken } from "@/lib/invoicing/share-token";
import {
  buildSupplierSnapshot,
  buildCustomerSnapshot,
} from "@/lib/invoicing/snapshot";
import {
  getCreditNoteWithLineItems,
  sumIssuedCreditNoteTotals,
} from "@/lib/data/credit-notes";
import { renderInvoicePdf, type InvoiceDocumentModel } from "@/lib/invoicing/pdf";
import { uploadCreditNotePdf } from "@/lib/invoicing/storage";
import { downloadLogoDataUrl } from "@/lib/storage/logo";
import { reportError } from "@/lib/observability/report";
import type { InvoiceMutateIdentity } from "@/lib/data/invoice-mutate";

/**
 * Guarded credit-note mutation layer (Story 12.8) — mirrors `invoice-mutate.ts`.
 *
 * A credit note corrects an issued invoice (FR88) without ever mutating the original. It
 * mirrors the invoice pipeline: a guarded draft save (`saveCreditNoteDraft`), an atomic
 * `issueCreditNote` that mints a gap-free number in its OWN namespace (I1) inside the
 * status-flip transaction, freezes supplier/customer snapshots + the original invoice
 * number (I6), and freezes a PDF rendered through the one shared render path (I8).
 *
 * Every write runs under the caller's RLS client (never the service-role key, NFR-FC1);
 * identity is passed explicitly and `actor_id` recorded. The original invoice is never
 * written by any function here.
 */

/** The line items a credit-note draft save carries (amount computed here, I2). */
export type WritableCreditNoteLine = {
  description: string;
  quantity: number;
  unitPrice: number;
};

/** The editable fields a credit-note draft save consumes (no due date, plus the source). */
export type WritableCreditNoteDraft = {
  /** The source invoice this credit note corrects (set on create; fixed thereafter). */
  invoiceId: string;
  customerRecordId: string | null;
  province: string | null;
  language: InvoiceLanguage;
  version: number | null;
  lineItems: WritableCreditNoteLine[];
};

/** The result of a credit-note draft save: its id + resulting version. */
export type SaveCreditNoteResult = { id: string; version: number };

/** The distinguishable Postgres error text raised by `save_credit_note_draft`. */
const DRAFT_CONFLICT_MARKER = "credit_note_draft_conflict";

/**
 * Save (create or update) a credit-note draft with its line items, totals, and tax
 * line(s) atomically. Mirrors `saveInvoiceDraft`.
 *
 * `input.version` null → create a new draft (storing `invoiceId` as the source link);
 * set → a version-gated update. Each line `amount` is computed with `computeLineAmount`
 * (I2), and the subtotal/tax_total/total plus tax line(s) with `computeInvoiceTotals`
 * (I2/I3) before the RPC call. Tax applies when the business is GST/HST-registered
 * (evaluated with the SHARED predicate against `referenceDate`) AND the province has an
 * active rate. A stale version OR a non-`draft` row makes the RPC raise
 * `credit_note_draft_conflict` (P0001), mapped to 409 `versionConflict` here.
 */
export async function saveCreditNoteDraft(
  identity: InvoiceMutateIdentity,
  input: WritableCreditNoteDraft & {
    creditNoteId: string | null;
    referenceDate: string;
  },
): Promise<ApiResponse<SaveCreditNoteResult>> {
  try {
    const { client, actorId, orgId } = identity;

    const lineItems = input.lineItems.map((item, index) => ({
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      amount: computeLineAmount(item.quantity, item.unitPrice),
      sort_order: index,
    }));

    // Load this org's GST/HST registration under the caller's RLS client to decide
    // whether tax applies. A genuine read error is SURFACED; an absent profile yields no tax.
    let taxApplies = false;
    {
      const { data: profile, error: profileError } = await client
        .from("business_profiles")
        .select("gst_hst_number, gst_hst_effective_date")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (profileError) {
        throw new AppError(500, "writeFailed", profileError.message);
      }
      const hasNumber =
        typeof profile?.gst_hst_number === "string" &&
        profile.gst_hst_number.trim() !== "";
      taxApplies =
        hasNumber &&
        isRegistrationEffective(
          (profile?.gst_hst_effective_date as string | null) ?? null,
          input.referenceDate,
        );
    }

    const totals = computeInvoiceTotals({
      lineItems: input.lineItems.map((item) => ({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
      province: input.province,
      taxApplies,
    });

    const taxLines = totals.taxLines.map((line, index) => ({
      label: line.label,
      rate: line.rate,
      base: line.base,
      tax_amount: line.tax_amount,
      sort_order: index,
    }));

    const { data, error } = await client.rpc("save_credit_note_draft", {
      p_org: orgId,
      p_credit_note_id: input.creditNoteId,
      p_invoice_id: input.invoiceId,
      p_expected_version: input.version,
      p_customer_record_id: input.customerRecordId,
      p_province: input.province,
      p_language: input.language,
      p_actor: actorId,
      p_line_items: lineItems,
      p_subtotal: totals.subtotal,
      p_tax_total: totals.taxTotal,
      p_total: totals.total,
      p_tax_lines: taxLines,
    });

    if (error) {
      if (error.message?.includes(DRAFT_CONFLICT_MARKER)) {
        throw new AppError(409, "versionConflict");
      }
      throw new AppError(500, "writeFailed", error.message);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      throw new AppError(500, "writeFailed");
    }

    return {
      data: { id: row.id as string, version: row.version as number },
      error: null,
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}

/** The result of issuing a credit note: its id, resulting version, and minted number. */
export type IssueCreditNoteResult = {
  id: string;
  version: number;
  credit_note_number: number;
};

/** The distinguishable Postgres error text raised by `issue_credit_note`. */
const ISSUE_CONFLICT_MARKER = "credit_note_issue_conflict";

/**
 * Source-invoice statuses that may be credited (retro [X4]) — mirrors the create route.
 * A correction is valid regardless of payment; a `draft` or `void` source cannot be
 * credited. Re-checked at issue time because the create-time check can go stale.
 */
const CREDITABLE_STATUSES = new Set(["issued", "paid", "overdue"]);

/**
 * Issue a validated credit-note draft (Story 12.8): the deliberate, validated,
 * irreversible step that mints a gap-free per-org credit-note number in its OWN namespace
 * (I1), freezes supplier/customer snapshots + the original invoice number + a one-time
 * share token (I4/I6), and flips `status` to `issued` in one transaction. It never
 * mutates the original invoice (FR88).
 *
 * The flow (all under the caller's RLS client):
 *   1. Load the credit-note draft (+ children + resolved customer label) and the org's
 *      Business Profile. A missing draft is 404; a non-draft row is 409.
 *   2. Load the source invoice's frozen `invoice_number` (the reference frozen at issue).
 *   3. Compute the SERVER-AUTHORITATIVE `issue_date` = TODAY and `taxApplies` via the
 *      SHARED predicate.
 *   4. Run `assertIssuableCreditNote` (reuses every invoice predicate) — blocks with a
 *      specific translated code; nothing is written.
 *   5. Build snapshots (I6) + mint the share token (I4).
 *   6. Call `issue_credit_note` (version + status='draft' + org gated); a 0-row conflict
 *      raises `credit_note_issue_conflict` -> 409 `versionConflict`.
 *   7. Freeze the PDF (best-effort, non-fatal).
 */
export async function issueCreditNote(
  identity: InvoiceMutateIdentity,
  input: { creditNoteId: string; version: number; invoiceId: string },
): Promise<ApiResponse<IssueCreditNoteResult>> {
  try {
    const { client, actorId, orgId } = identity;

    // 1. Load the credit-note draft under RLS.
    const loaded = await getCreditNoteWithLineItems(
      client,
      orgId,
      input.creditNoteId,
    );
    if (loaded.error) {
      throw new AppError(500, "loadFailed", loaded.error);
    }
    if (!loaded.data) {
      throw new AppError(404, "notFound");
    }
    const { creditNote, lineItems, taxLines, customerLabel } = loaded.data;

    if (creditNote.status !== "draft") {
      throw new AppError(409, "notDraft");
    }

    // The credit note must belong to the invoice named in the route path (retro [X4]).
    // A mismatch means [cnId] does not sit under [id]; treat it as not found rather than
    // silently issuing a credit note against a different invoice than the URL claims.
    if (creditNote.invoice_id !== input.invoiceId) {
      throw new AppError(404, "notFound");
    }

    // 2. Load the source invoice and RE-CHECK its creditability at issue time (retro [X4]):
    // the create-time check can go stale, so the source must still exist and be creditable
    // (issued/paid/overdue). The same query reads the frozen `invoice_number` (the reference,
    // I6) and `total` (the credit ceiling, retro [X1]). A missing or non-creditable source
    // blocks with 409 notIssued — which also guarantees the ceiling below is enforceable.
    let originalInvoiceNumber: number | null = null;
    let ceiling: CreditNoteCeiling | null = null;
    {
      const { data: sourceInvoice, error: sourceError } = await client
        .from("invoices")
        .select("invoice_number, total, status")
        .eq("id", creditNote.invoice_id)
        .eq("organization_id", orgId)
        .maybeSingle();
      if (sourceError) {
        throw new AppError(500, "writeFailed", sourceError.message);
      }
      if (!sourceInvoice) {
        throw new AppError(409, "notIssued");
      }
      if (!CREDITABLE_STATUSES.has(sourceInvoice.status as string)) {
        throw new AppError(409, "notIssued");
      }

      const raw = sourceInvoice.invoice_number as number | string | null;
      if (raw !== null && raw !== undefined) {
        const n = Number(raw);
        originalInvoiceNumber = Number.isFinite(n) ? n : null;
      }

      // Compute the credit ceiling: the source invoice total, against which the sum of
      // OTHER issued credit notes plus this one must not exceed (retro [X1]).
      const invoiceTotal = Number(sourceInvoice.total);
      if (Number.isFinite(invoiceTotal)) {
        const credited = await sumIssuedCreditNoteTotals(
          client,
          orgId,
          creditNote.invoice_id,
          input.creditNoteId,
        );
        if (credited.error) {
          throw new AppError(500, "writeFailed", credited.error);
        }
        ceiling = {
          invoiceTotal,
          alreadyCredited: credited.data ?? 0,
        };
      }
    }

    // 1b. Load the org's full Business Profile (the snapshot source) under RLS.
    const { data: profile, error: profileError } = await client
      .from("business_profiles")
      .select("*")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (profileError) {
      throw new AppError(500, "writeFailed", profileError.message);
    }

    // 3. Server-authoritative issue date (TODAY).
    const issueDate = new Date().toISOString().slice(0, 10);

    // 4. The synchronous compliance gate (reuses every invoice predicate).
    assertIssuableCreditNote({
      invoice: {
        place_of_supply_province: creditNote.place_of_supply_province,
        subtotal: creditNote.subtotal,
        tax_total: creditNote.tax_total,
        total: creditNote.total,
      },
      lineItems: lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        amount: item.amount,
      })),
      taxLines: taxLines.map((line) => ({
        label: line.label,
        rate: line.rate,
        base: line.base,
        tax_amount: line.tax_amount,
      })),
      profile: profile
        ? {
            legal_name: (profile.legal_name as string | null) ?? null,
            gst_hst_number: (profile.gst_hst_number as string | null) ?? null,
            gst_hst_effective_date:
              (profile.gst_hst_effective_date as string | null) ?? null,
          }
        : null,
      issueDate,
      ceiling,
    });

    // 5. Freeze the supplier identity + payment instructions and the linked customer (I6);
    // a standalone credit note (no linked record) freezes a null customer snapshot.
    const supplierSnapshot = buildSupplierSnapshot(profile!);
    const customerSnapshot = await buildCustomerSnapshot(
      client,
      orgId,
      creditNote.customer_record_id,
      customerLabel,
    );

    const shareToken = mintShareToken();

    // 6. The atomic issue transaction (version + status='draft' + org gated).
    const { data, error } = await client.rpc("issue_credit_note", {
      p_org: orgId,
      p_credit_note_id: input.creditNoteId,
      p_expected_version: input.version,
      p_actor: actorId,
      p_issue_date: issueDate,
      p_original_invoice_number: originalInvoiceNumber,
      p_supplier_snapshot: supplierSnapshot,
      p_customer_snapshot: customerSnapshot,
      p_share_token: shareToken,
    });

    if (error) {
      if (error.message?.includes(ISSUE_CONFLICT_MARKER)) {
        throw new AppError(409, "versionConflict");
      }
      throw new AppError(500, "writeFailed", error.message);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      throw new AppError(500, "writeFailed");
    }

    // 7. Freeze the PDF (best-effort; the issue is already committed and irreversible).
    await ensureCreditNotePdf(identity, input.creditNoteId);

    return {
      data: {
        id: row.id as string,
        version: row.version as number,
        credit_note_number: Number(row.credit_note_number),
      },
      error: null,
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}

/**
 * Idempotently render and freeze an issued credit note's PDF to private storage (Story
 * 12.8, I5/I6/I8) and record its bucket-relative `pdf_path`. Mirrors `ensureInvoicePdf`.
 *
 * NEVER throws: the issue transaction is already committed, so any render/upload/write
 * failure is reported through the observability seam and swallowed (pdf_path stays null,
 * the one-time `null->value` write remains available for a retry).
 */
export async function ensureCreditNotePdf(
  identity: InvoiceMutateIdentity,
  creditNoteId: string,
): Promise<void> {
  const { client, orgId } = identity;

  try {
    const loaded = await getCreditNoteWithLineItems(client, orgId, creditNoteId);
    if (loaded.error || !loaded.data) {
      if (loaded.error) {
        reportError(new Error(`ensureCreditNotePdf load: ${loaded.error}`), {
          creditNoteId,
          orgId,
          stage: "ensureCreditNotePdf",
        });
      }
      return;
    }

    const { creditNote, lineItems, taxLines } = loaded.data;

    if (creditNote.status === "draft") {
      return;
    }
    if (typeof creditNote.pdf_path === "string" && creditNote.pdf_path !== "") {
      return;
    }

    const supplier = creditNote.supplier_snapshot;
    if (!supplier) {
      reportError(new Error("ensureCreditNotePdf: missing supplier snapshot"), {
        creditNoteId,
        orgId,
        stage: "ensureCreditNotePdf",
      });
      return;
    }

    const language: InvoiceLanguage = creditNote.language === "fr" ? "fr" : "en";
    const taxLine = taxLines.length === 1 ? taxLines[0] : null;
    const logoDataUrl = await downloadLogoDataUrl(client, supplier.logo_path);

    const model: InvoiceDocumentModel = {
      documentType: "creditNote",
      number: formatInvoiceNumber(
        creditNote.credit_note_number === null
          ? null
          : Number(creditNote.credit_note_number),
      ),
      creditNoteReference: formatInvoiceNumber(
        creditNote.original_invoice_number === null
          ? null
          : Number(creditNote.original_invoice_number),
      ),
      issueDate: creditNote.issue_date ?? "",
      language,
      supplier: {
        legalName: supplier.legal_name,
        operatingName: supplier.operating_name,
        gstHstNumber: supplier.gst_hst_number,
        businessAddress: supplier.business_address,
        logoDataUrl,
        paymentTerms: supplier.default_payment_terms,
        paymentEtransferEmail: supplier.payment_etransfer_email,
        paymentChequePayableTo: supplier.payment_cheque_payable_to,
        paymentChequeAddress: supplier.payment_cheque_address,
        paymentCardLink: supplier.payment_card_link,
      },
      customer: creditNote.customer_snapshot
        ? { displayLabel: creditNote.customer_snapshot.display_label }
        : null,
      lineItems: lineItems.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unit_price),
        amount: Number(item.amount),
      })),
      taxLine: taxLine
        ? {
            label: taxLine.label,
            rate: Number(taxLine.rate),
            amount: Number(taxLine.tax_amount),
          }
        : null,
      subtotal: Number(creditNote.subtotal),
      total: Number(creditNote.total),
    };

    const pdf = await renderInvoicePdf(model);
    const { pdfPath } = await uploadCreditNotePdf(
      client,
      orgId,
      creditNoteId,
      new Uint8Array(pdf),
    );

    const { error: updateError } = await client
      .from("credit_notes")
      .update({ pdf_path: pdfPath, updated_at: new Date().toISOString() })
      .eq("id", creditNoteId)
      .eq("organization_id", orgId)
      .is("pdf_path", null);

    if (updateError) {
      reportError(
        new Error(`ensureCreditNotePdf write: ${updateError.message}`),
        { creditNoteId, orgId, stage: "ensureCreditNotePdf" },
      );
    }
  } catch (err) {
    reportError(err, { creditNoteId, orgId, stage: "ensureCreditNotePdf" });
  }
}

/**
 * Discard (hard-delete) a credit-note draft. Only a `draft` row may be discarded — an
 * issued/void credit note is immutable, so a non-draft row is rejected with `notDraft`.
 * The delete is scoped `id + org + status='draft'` under the caller's RLS client; the
 * `ON DELETE CASCADE` removes the children. Mirrors `discardInvoiceDraft`.
 */
export async function discardCreditNoteDraft(
  identity: InvoiceMutateIdentity,
  creditNoteId: string,
): Promise<ApiResponse<{ id: string }>> {
  try {
    const { client, orgId } = identity;

    const { data, error } = await client
      .from("credit_notes")
      .delete()
      .eq("id", creditNoteId)
      .eq("organization_id", orgId)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();

    if (error) {
      throw new AppError(500, "writeFailed", error.message);
    }
    if (!data) {
      throw new AppError(409, "notDraft");
    }

    return { data: { id: data.id as string }, error: null };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}
