import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import {
  computeInvoiceTotals,
  computeLineAmount,
  isRegistrationEffective,
} from "@/lib/invoicing/tax";
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
