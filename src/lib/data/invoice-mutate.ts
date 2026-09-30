import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { InvoiceLanguage, PaymentMethod } from "@/types/db";
import {
  computeInvoiceTotals,
  computeLineAmount,
  formatInvoiceNumber,
  isRegistrationEffective,
} from "@/lib/invoicing/tax";
import { assertIssuable } from "@/lib/invoicing/validate";
import { mintShareToken } from "@/lib/invoicing/share-token";
import {
  buildSupplierSnapshot,
  buildCustomerSnapshot,
} from "@/lib/invoicing/snapshot";
import { getInvoiceWithLineItems } from "@/lib/data/invoices";
import { renderInvoicePdf, type InvoiceDocumentModel } from "@/lib/invoicing/pdf";
import { uploadInvoicePdf } from "@/lib/invoicing/storage";
import { downloadLogoDataUrl } from "@/lib/storage/logo";
import { reportError } from "@/lib/observability/report";
import type { WritableDraft } from "@/app/api/invoices/schemas";

/**
 * Guarded invoice-draft mutation layer (Story 12.2) — the single, targeted path
 * that saves (create/update) and discards an org's invoice drafts.
 *
 * Deliberately mirrors `business-profile-mutate.ts`'s identity-agnostic contract:
 * the caller supplies an RLS-scoped Supabase client and the acting identity, so
 * this layer never reads cookies and never touches the service-role key. Every
 * write runs under the caller's RLS client, so the `invoices` /
 * `invoice_line_items` tenant-isolation policies scope it to the caller's own org
 * — a cross-tenant write is impossible.
 *
 * A draft save spans three tables (invoice + its line items + its tax lines), so
 * the write goes through the `save_invoice_draft` SECURITY INVOKER RPC, which
 * upserts the invoice and REPLACES its line + tax lines in one transaction under
 * the caller's RLS. Each line `amount`, the subtotal/tax/total, and the tax line(s)
 * are computed HERE with the canonical `computeLineAmount` / `computeInvoiceTotals`
 * (Invariants I2/I3) and passed precomputed to the RPC — no SQL re-implements any
 * money math.
 *
 * Tax (Story 12.3): the business's GST/HST registration is loaded under the caller's
 * RLS client and `taxApplies = number present && isRegistrationEffective(effective,
 * referenceDate)` is evaluated with the SHARED predicate. A draft has no issue date,
 * so the route supplies TODAY as the provisional `referenceDate`; Story 12.4
 * recomputes authoritatively against the real issue date. HST is Ontario-only in the
 * MVP (the province/language seam is stored for a later Quebec path).
 *
 * Drafting only: this never freezes a snapshot, mints a number, or transitions
 * status (those are 12.4-12.8). Totals are stored on `draft` rows only.
 */

export type InvoiceMutateIdentity = {
  /** RLS-scoped Supabase client (never the service-role admin client). */
  client: SupabaseClient;
  /** The acting user id, recorded in `actor_id`. */
  actorId: string;
  /** The org whose invoice is being saved; scopes the write. */
  orgId: string;
};

/** The result of a draft save: the invoice's id + its resulting version. */
export type SaveInvoiceResult = { id: string; version: number };

/** The distinguishable Postgres error text raised by `save_invoice_draft`. */
const DRAFT_CONFLICT_MARKER = "invoice_draft_conflict";

/**
 * Save (create or update) an invoice draft with its line items, totals, and tax
 * line(s) atomically.
 *
 * `input.version` null → create a new draft; set → a version-gated update. Each line
 * `amount` is computed with `computeLineAmount` (I2), and the invoice `subtotal` /
 * `tax_total` / `total` plus its tax line(s) are computed with `computeInvoiceTotals`
 * (I2/I3) before the RPC call — the DB stores exactly that output. The business's
 * GST/HST registration is loaded under the caller's RLS client and evaluated with
 * the shared `isRegistrationEffective` predicate against `input.referenceDate`
 * (TODAY for a draft; supplied by the route). A stale version OR a non-`draft` row
 * makes the RPC raise `invoice_draft_conflict` (SQLSTATE P0001), mapped to a 409
 * `versionConflict` here — nothing is written (the RPC body is one transaction).
 * Returns the invoice id + version.
 *
 * `invoiceId` is the target row on an update (null on create). The caller has
 * already verified any `customerRecordId` belongs to the org (route-level, under
 * RLS), so a cross-org id never reaches here.
 */
export async function saveInvoiceDraft(
  identity: InvoiceMutateIdentity,
  input: WritableDraft & { invoiceId: string | null; referenceDate: string },
): Promise<ApiResponse<SaveInvoiceResult>> {
  try {
    const { client, actorId, orgId } = identity;

    // Compute each line amount with the canonical helper (I2) and pass it
    // precomputed to the RPC (the DB never re-implements line amount).
    const lineItems = input.lineItems.map((item, index) => ({
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      amount: computeLineAmount(item.quantity, item.unitPrice),
      sort_order: index,
    }));

    // Load this org's GST/HST registration under the caller's RLS client to decide
    // whether tax applies. A genuine read error is SURFACED (writeFailed) rather than
    // silently understating a registered org's totals to tax_total=0; a legitimately
    // absent profile (no row) is not an error and correctly yields no tax.
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

    // Compute the invoice totals + tax line(s) from the SINGLE canonical function
    // (I2/I3). The DB stores exactly this — no SQL re-implements subtotal or tax.
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

    const { data, error } = await client.rpc("save_invoice_draft", {
      p_org: orgId,
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
      p_due_date: input.dueDate ?? null,
    });

    if (error) {
      // The RPC raises `invoice_draft_conflict` when the update matched 0 rows:
      // a stale version OR a row that is no longer a draft. From 12.2's vantage
      // (drafts only) both collapse to the same "re-read and retry" 409 — the
      // route surfaces `versionConflict`. Match on the stable message marker, never
      // prose or a SQLSTATE: the RPC raises P0001 (a deterministic conflict), NOT
      // 40001, precisely because PostgREST + the pooler auto-retry 40001/40P01 as
      // transient failures — which would stall this instant conflict.
      if (error.message?.includes(DRAFT_CONFLICT_MARKER)) {
        throw new AppError(409, "versionConflict");
      }
      throw new AppError(500, "writeFailed", error.message);
    }

    // The RPC returns a single row { id, version }.
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

/** The result of issuing an invoice: its id, resulting version, and minted number. */
export type IssueInvoiceResult = {
  id: string;
  version: number;
  invoice_number: number;
};

/** The distinguishable Postgres error text raised by `issue_invoice`. */
const ISSUE_CONFLICT_MARKER = "invoice_issue_conflict";

/**
 * Issue a validated draft (Story 12.4): the deliberate, validated, irreversible step
 * that mints a gap-free per-org number, freezes supplier/customer identity + the issue
 * date + a one-time share token, and flips `status` to `issued` in one transaction.
 *
 * The flow (all under the caller's RLS client, never the service role):
 *   1. Load the draft (invoice + line items + tax lines + resolved customer label) and
 *      the org's Business Profile.
 *   2. Compute the SERVER-AUTHORITATIVE `issue_date` = TODAY (never client-supplied,
 *      no back/forward dating) and `taxApplies` via the SHARED `isRegistrationEffective`
 *      predicate against that date (I3).
 *   3. Run the synchronous `assertIssuable` gate (FR87): it recomputes with the same
 *      canonical `computeInvoiceTotals` (I2) and BLOCKS with a specific translated code
 *      on legal-identity/tax-registration/tax-split/totals-mismatch/no-line-items —
 *      nothing is written.
 *   4. Build `supplier_snapshot` / `customer_snapshot` (I6) and mint `share_token` (I4).
 *   5. Call the `issue_invoice` RPC (version + status='draft' + org gated); a 0-row
 *      conflict raises `invoice_issue_conflict` -> mapped to 409 `versionConflict`.
 *
 * `assertIssuable` throws its own 422 `Invoice.error.*`; a missing draft is 404; a
 * stale/non-draft row is 409.
 */
export async function issueInvoice(
  identity: InvoiceMutateIdentity,
  input: { invoiceId: string; version: number },
): Promise<ApiResponse<IssueInvoiceResult>> {
  try {
    const { client, actorId, orgId } = identity;

    // 1a. Load the draft (invoice + line items + tax lines + resolved customer label)
    // under RLS. A missing row (unknown id / RLS-hidden) is a 404.
    const loaded = await getInvoiceWithLineItems(client, orgId, input.invoiceId);
    if (loaded.error) {
      throw new AppError(500, "loadFailed", loaded.error);
    }
    if (!loaded.data) {
      throw new AppError(404, "notFound");
    }
    const { invoice, lineItems, taxLines, customerLabel } = loaded.data;

    // A non-draft invoice cannot be re-issued. Surface a 409 before any further work
    // (the RPC would also reject it, but this gives the precise `notDraft` reason).
    if (invoice.status !== "draft") {
      throw new AppError(409, "notDraft");
    }

    // INVARIANT (retro [X5]): the gate below validates the line items/totals read here,
    // then `issue_invoice` re-checks only `version` + `status='draft'` + org — it does NOT
    // re-validate the children. That is safe ONLY because every writer of the child rows
    // (`save_invoice_draft`) bumps the parent `invoices.version`, so any change between
    // this read and the RPC trips the version gate (409 versionConflict) rather than
    // freezing an unvalidated change. Any future path that mutates invoice_line_items /
    // invoice_tax_lines on a draft MUST bump the parent version to preserve this.

    // 1b. Load the org's full Business Profile (the snapshot source) under RLS.
    const { data: profile, error: profileError } = await client
      .from("business_profiles")
      .select("*")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (profileError) {
      throw new AppError(500, "writeFailed", profileError.message);
    }

    // 2. Server-authoritative issue date (TODAY) + shared registration predicate.
    const issueDate = new Date().toISOString().slice(0, 10);

    // 3. The synchronous compliance gate (FR87). Throws a 422 Invoice.error.* on any
    // failure — nothing is written. It reuses computeInvoiceTotals (I2) to verify the
    // STORED figures reconcile against the real issue date, never rewriting them.
    assertIssuable({
      invoice: {
        place_of_supply_province: invoice.place_of_supply_province,
        subtotal: invoice.subtotal,
        tax_total: invoice.tax_total,
        total: invoice.total,
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
    });

    // 4. Freeze the supplier identity + payment instructions and the linked customer (I6).
    // assertIssuable already guaranteed a profile with a non-blank legal name; a standalone
    // invoice (no linked record) freezes a null customer snapshot.
    const supplierSnapshot = buildSupplierSnapshot(profile!);
    const customerSnapshot = await buildCustomerSnapshot(
      client,
      orgId,
      invoice.customer_record_id,
      customerLabel,
    );

    // Mint the one-time share token (I4) — generated here, passed to the RPC.
    const shareToken = mintShareToken();

    // 5. The atomic issue transaction (version + status='draft' + org gated).
    const { data, error } = await client.rpc("issue_invoice", {
      p_org: orgId,
      p_invoice_id: input.invoiceId,
      p_expected_version: input.version,
      p_actor: actorId,
      p_issue_date: issueDate,
      p_supplier_snapshot: supplierSnapshot,
      p_customer_snapshot: customerSnapshot,
      p_share_token: shareToken,
    });

    if (error) {
      // A 0-row match (stale version OR no longer a draft) raises the distinguishable
      // conflict marker. Match the stable message marker, never a SQLSTATE: the RPC
      // raises P0001 (a deterministic conflict), NOT the retryable 40001 the pooler
      // would auto-retry.
      if (error.message?.includes(ISSUE_CONFLICT_MARKER)) {
        throw new AppError(409, "versionConflict");
      }
      throw new AppError(500, "writeFailed", error.message);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      throw new AppError(500, "writeFailed");
    }

    // 6. Freeze the PDF (Story 12.5). The issue transaction has ALREADY committed and
    // is irreversible; the PDF render/upload/write lives OUTSIDE it and is best-effort.
    // A failure here must NEVER overturn the issued result — it is reported and
    // swallowed, leaving `pdf_path` null and the one-time `null->value` write available
    // for a later retry. Awaited so a fast freeze is visible immediately, but its
    // failure cannot throw to the issue caller.
    await ensureInvoicePdf(identity, input.invoiceId);

    return {
      data: {
        id: row.id as string,
        version: row.version as number,
        invoice_number: Number(row.invoice_number),
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

/** The result of recording a payment: the invoice's id and its resulting version. */
export type RecordPaymentResult = { id: string; version: number };

/** The distinguishable Postgres error text raised by `record_invoice_payment`. */
const PAYMENT_CONFLICT_MARKER = "invoice_payment_conflict";

/** The valid out-of-band payment methods (mirrors the DB CHECK + `PaymentMethod`). */
const PAYMENT_METHODS: readonly PaymentMethod[] = [
  "etransfer",
  "cheque",
  "card",
  "other",
];

/**
 * Record a single out-of-band payment against an ISSUED invoice and flip it to `paid`
 * (Story 12.7). Scheza never processes, holds, or moves money — this only RECORDS what
 * the owner received out of band (method, date, amount, optional reference).
 *
 * All under the caller's RLS client (never the service role, NFR-FC1):
 *   1. Load the invoice under RLS. A missing row is 404; the precise `alreadyPaid` /
 *      `notIssued` reasons are surfaced HERE from the current status before the RPC
 *      (the RPC would also reject them, but this gives the specific 409 reason).
 *   2. Call the `record_invoice_payment` RPC (version + status='issued' + org gated),
 *      which in ONE transaction inserts exactly one `invoice_payments` row and updates
 *      the invoice `status -> 'paid'` with `version`/`updated_at`/`actor_id`.
 *
 * A 0-row gate match (stale version or a status that changed under us) raises
 * `invoice_payment_conflict` -> 409 `versionConflict`; a UNIQUE(invoice_id) race raises
 * 23505 -> 409 `alreadyPaid`. Identity is passed explicitly; `actor_id` is recorded.
 */
export async function recordPayment(
  identity: InvoiceMutateIdentity,
  input: {
    invoiceId: string;
    version: number;
    method: PaymentMethod;
    paidDate: string;
    amount: number;
    reference: string | null;
  },
): Promise<ApiResponse<RecordPaymentResult>> {
  try {
    const { client, actorId, orgId } = identity;

    // Defensive: the method must be one of the closed vocabulary (the zod schema already
    // gates this on the route path, but the mutation layer never trusts its caller).
    if (!PAYMENT_METHODS.includes(input.method)) {
      throw new AppError(400, "methodInvalid");
    }

    // 1. Load the invoice under RLS. A missing row (unknown id / RLS-hidden) is a 404.
    const loaded = await getInvoiceWithLineItems(client, orgId, input.invoiceId);
    if (loaded.error) {
      throw new AppError(500, "loadFailed", loaded.error);
    }
    if (!loaded.data) {
      throw new AppError(404, "notFound");
    }
    const { invoice } = loaded.data;

    // Surface the precise reason from the loaded status before the RPC. An already-paid
    // invoice cannot be paid again; a draft/void/overdue invoice is not payable here
    // (only an issued invoice flips issued->paid).
    if (invoice.status === "paid") {
      throw new AppError(409, "alreadyPaid");
    }
    if (invoice.status !== "issued") {
      throw new AppError(409, "notIssued");
    }

    // 2. The atomic record-payment transaction (version + status='issued' + org gated).
    const { data, error } = await client.rpc("record_invoice_payment", {
      p_org: orgId,
      p_invoice_id: input.invoiceId,
      p_expected_version: input.version,
      p_actor: actorId,
      p_method: input.method,
      p_paid_date: input.paidDate,
      p_amount: input.amount,
      p_reference: input.reference,
    });

    if (error) {
      // A UNIQUE(invoice_id) race (a concurrent mark-paid) surfaces as 23505 -> the
      // invoice is already paid.
      if (error.code === "23505") {
        throw new AppError(409, "alreadyPaid");
      }
      // A 0-row gate match (stale version, or the status changed under us) raises the
      // distinguishable marker. Match the stable message marker, never a SQLSTATE: the
      // RPC raises P0001 (a deterministic conflict), NOT the retryable 40001 the pooler
      // would auto-retry.
      if (error.message?.includes(PAYMENT_CONFLICT_MARKER)) {
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

/**
 * Idempotently render and freeze an issued invoice's PDF to private storage
 * (Story 12.5, I5/I6/I8) and record its bucket-relative `pdf_path`.
 *
 * Runs right after the issue RPC commits (and is safe to call again from a later
 * retry — 12.6 delivery may call it before sending). It:
 *   1. Reloads the issued invoice (invoice + line items + tax line + customer label)
 *      under the caller's RLS client.
 *   2. No-ops when the invoice is missing, still a draft, or already has a `pdf_path`
 *      (idempotent — no re-render, no second write).
 *   3. Builds the neutral {@link InvoiceDocumentModel} from the FROZEN snapshots + the
 *      stored rows only (never live records/business_profiles, I6), renders it via the
 *      single shared `renderInvoicePdf` path (I8), uploads it under the org's prefix,
 *      and writes `pdf_path` with `update ... where id = :id and pdf_path is null`.
 *
 * NEVER throws: the issue transaction is already committed and irreversible, so any
 * render/upload/write failure is reported through the observability seam and swallowed
 * (never un-issues, never rolls back, never fatally fails the issue request). The
 * caller does not depend on the return value.
 */
export async function ensureInvoicePdf(
  identity: InvoiceMutateIdentity,
  invoiceId: string,
): Promise<void> {
  const { client, orgId } = identity;

  try {
    // 1. Reload the issued invoice under RLS.
    const loaded = await getInvoiceWithLineItems(client, orgId, invoiceId);
    if (loaded.error || !loaded.data) {
      // A read failure (or a vanished/RLS-hidden row) leaves pdf_path null and the
      // freeze retryable — never fatal.
      if (loaded.error) {
        reportError(new Error(`ensureInvoicePdf load: ${loaded.error}`), {
          invoiceId,
          orgId,
          stage: "ensureInvoicePdf",
        });
      }
      return;
    }

    const { invoice, lineItems, taxLines } = loaded.data;

    // 2. Idempotency guards: only an issued (non-draft) invoice with no PDF yet.
    if (invoice.status === "draft") {
      return;
    }
    if (typeof invoice.pdf_path === "string" && invoice.pdf_path !== "") {
      // Already frozen — no re-render, no second write.
      return;
    }

    // A non-draft invoice always carries a frozen supplier snapshot; without it there
    // is nothing to render from (I6). Guard defensively rather than throw.
    const supplier = invoice.supplier_snapshot;
    if (!supplier) {
      reportError(new Error("ensureInvoicePdf: missing supplier snapshot"), {
        invoiceId,
        orgId,
        stage: "ensureInvoicePdf",
      });
      return;
    }

    // 3. Build the neutral document model from the FROZEN snapshots + stored rows.
    const language: InvoiceLanguage =
      invoice.language === "fr" ? "fr" : "en";

    const taxLine = taxLines.length === 1 ? taxLines[0] : null;

    // Embed the supplier logo from the FROZEN snapshot's `logo_path` (I6) as a
    // self-contained data URL. Best-effort: a missing/unreadable logo degrades to a
    // logoless PDF rather than failing the freeze.
    const logoDataUrl = await downloadLogoDataUrl(client, supplier.logo_path);

    const model: InvoiceDocumentModel = {
      documentType: "invoice",
      number: formatInvoiceNumber(
        invoice.invoice_number === null ? null : Number(invoice.invoice_number),
      ),
      issueDate: invoice.issue_date ?? "",
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
      // Render from the FROZEN snapshot label ONLY (I6) — never the live read-time
      // label, so a later re-freeze can never inject a post-issue value. Null
      // snapshot => standalone invoice.
      customer: invoice.customer_snapshot
        ? { displayLabel: invoice.customer_snapshot.display_label }
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
      subtotal: Number(invoice.subtotal),
      total: Number(invoice.total),
    };

    // Render (I8) then upload under the org's prefix (I5), both under RLS.
    const pdf = await renderInvoicePdf(model);
    const { pdfPath } = await uploadInvoicePdf(
      client,
      orgId,
      invoiceId,
      new Uint8Array(pdf),
    );

    // Write the one-time null->value pdf_path. The `pdf_path is null` guard makes a
    // concurrent double-freeze a no-op (0 rows), and the immutability trigger permits
    // exactly this single write on a non-draft invoice.
    const { error: updateError } = await client
      .from("invoices")
      .update({ pdf_path: pdfPath, updated_at: new Date().toISOString() })
      .eq("id", invoiceId)
      .eq("organization_id", orgId)
      .is("pdf_path", null);

    if (updateError) {
      reportError(new Error(`ensureInvoicePdf write: ${updateError.message}`), {
        invoiceId,
        orgId,
        stage: "ensureInvoicePdf",
      });
    }
  } catch (err) {
    // Best-effort: the issue is already committed. Report and swallow — pdf_path stays
    // null and the freeze remains retryable.
    reportError(err, { invoiceId, orgId, stage: "ensureInvoicePdf" });
  }
}

/**
 * Discard (hard-delete) an invoice draft. Only a `draft` row may be discarded —
 * immutability of issued/paid/void invoices is Story 12.4, so a non-draft row is
 * rejected with `notDraft` and nothing is deleted. The delete is scoped `id +
 * org + status='draft'` under the caller's RLS client; the `ON DELETE CASCADE` on
 * `invoice_line_items` removes the lines. Returns the discarded id.
 */
export async function discardInvoiceDraft(
  identity: InvoiceMutateIdentity,
  invoiceId: string,
): Promise<ApiResponse<{ id: string }>> {
  try {
    const { client, orgId } = identity;

    const { data, error } = await client
      .from("invoices")
      .delete()
      .eq("id", invoiceId)
      .eq("organization_id", orgId)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();

    if (error) {
      throw new AppError(500, "writeFailed", error.message);
    }
    if (!data) {
      // The row is missing, foreign (RLS-hidden), or not a draft. Immutability of
      // issued/paid/void is 12.4; here a non-draft discard is rejected as notDraft
      // (a 409 the route surfaces). A truly missing id also lands here — safe: a
      // discard of nothing is not a write.
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
