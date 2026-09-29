import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ApiResponse } from "@/types/api";
import type { InvoiceLineItemRow, InvoiceRow } from "@/types/db";
import { getSchema } from "@/lib/data/records";
import { resolvedDisplayFieldKey } from "@/lib/schema/relations";

/**
 * Invoice read layer (Story 12.2).
 *
 * Identity-agnostic: the caller supplies the RLS-scoped Supabase client, so a
 * cross-org invoice simply never comes back. Reads never surface raw SQL;
 * failures are returned as an error string in the `ApiResponse` envelope.
 *
 * The customer display label is resolved at READ time from the linked record's
 * `resolvedDisplayFieldKey` (Invariant I6 — the id is a back-reference, never a
 * stored render source). A missing / soft-deleted linked record degrades to a
 * null label so the caller renders the translated "unavailable" note (no crash).
 */

/** An invoice plus its ordered line items and the resolved customer label. */
export type InvoiceWithLineItems = {
  invoice: InvoiceRow;
  lineItems: InvoiceLineItemRow[];
  /** The linked customer record's display label, or null (standalone / missing). */
  customerLabel: string | null;
};

/**
 * List the org's invoices, most-recently-updated first — matching the list view's
 * "Last updated" column so the sort key and the displayed date agree. RLS scopes
 * visibility to the caller's org. Returns the `{ data, error }` envelope; raw SQL never leaks.
 */
export async function listInvoices(
  client: SupabaseClient,
  orgId: string,
): Promise<ApiResponse<InvoiceRow[]>> {
  const { data, error } = await client
    .from("invoices")
    .select("*")
    .eq("organization_id", orgId)
    .order("updated_at", { ascending: false });

  if (error) {
    return { data: null, error: "Failed to load invoices." };
  }

  return { data: (data ?? []) as InvoiceRow[], error: null };
}

/**
 * Load one invoice with its ordered line items and the resolved customer display
 * label. Returns `null` data when the invoice does not exist under the caller's
 * org (RLS-hidden or unknown id). The label resolves via `getSchema` +
 * `resolvedDisplayFieldKey` at read time and degrades to null when the linked
 * record is missing / soft-deleted (Invariant I6; graceful, never a crash).
 */
export async function getInvoiceWithLineItems(
  client: SupabaseClient,
  orgId: string,
  invoiceId: string,
): Promise<ApiResponse<InvoiceWithLineItems | null>> {
  const { data: invoice, error: invoiceError } = await client
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (invoiceError) {
    return { data: null, error: "Failed to load invoice." };
  }
  if (!invoice) {
    return { data: null, error: null };
  }

  const invoiceRow = invoice as InvoiceRow;

  const { data: lines, error: linesError } = await client
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", invoiceId)
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: true });

  if (linesError) {
    return { data: null, error: "Failed to load invoice line items." };
  }

  const customerLabel = await resolveCustomerLabel(
    client,
    orgId,
    invoiceRow.customer_record_id,
  );

  return {
    data: {
      invoice: invoiceRow,
      lineItems: (lines ?? []) as InvoiceLineItemRow[],
      customerLabel,
    },
    error: null,
  };
}

/**
 * Resolve the display label for a linked customer record. Reads the record under
 * RLS, finds its logical table in the org schema, and returns the value of that
 * table's `resolvedDisplayFieldKey`. Returns null for a standalone draft (no id),
 * a missing / soft-deleted record, or any table/field that no longer resolves —
 * the caller renders the translated "unavailable" note (FR82: schema-agnostic).
 */
async function resolveCustomerLabel(
  client: SupabaseClient,
  orgId: string,
  customerRecordId: string | null,
): Promise<string | null> {
  if (!customerRecordId) {
    return null;
  }

  // Read the linked record (live only — a soft-deleted record yields no row).
  const { data: record, error: recordError } = await client
    .from("records")
    .select("table_key, data")
    .eq("id", customerRecordId)
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (recordError || !record) {
    return null;
  }

  const tableKey = record.table_key as string;
  const recordData = (record.data ?? {}) as Record<string, unknown>;

  const schemaResult = await getSchema(client, orgId);
  if (schemaResult.error || !schemaResult.data) {
    return null;
  }
  const table = schemaResult.data.tables.find((t) => t.key === tableKey);
  if (!table) {
    return null;
  }
  const displayFieldKey = resolvedDisplayFieldKey(table);
  if (!displayFieldKey) {
    return null;
  }

  const value = recordData[displayFieldKey];
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  return String(value);
}

/**
 * Verify a `customerRecordId` belongs to the caller's org before a draft write
 * (the matrix's cross-org-link row). Reads the record under the caller's RLS
 * client scoped `id + org + deleted_at IS NULL`; a foreign / dangling / deleted id
 * simply does not come back. Returns true only for a live record in this org.
 */
export async function customerRecordBelongsToOrg(
  client: SupabaseClient,
  orgId: string,
  customerRecordId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("records")
    .select("id")
    .eq("id", customerRecordId)
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    return false;
  }
  return data !== null;
}
