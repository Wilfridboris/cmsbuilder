import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ApiResponse } from "@/types/api";
import type {
  InvoiceLineItemRow,
  InvoiceRow,
  InvoiceTaxLineRow,
} from "@/types/db";
import { getSchema } from "@/lib/data/records";
import { resolvedDisplayFieldKey } from "@/lib/schema/relations";
import { reportError } from "@/lib/observability/report";

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

/**
 * An invoice plus its ordered line items, its ordered tax lines (Story 12.3; zero
 * or one HST row for the MVP Ontario path), and the resolved customer label.
 */
export type InvoiceWithLineItems = {
  invoice: InvoiceRow;
  lineItems: InvoiceLineItemRow[];
  /** The stored tax line(s), ordered — empty when no tax applies (Story 12.3). */
  taxLines: InvoiceTaxLineRow[];
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
 * Count the org's issued invoices whose `issue_date` falls in the half-open window
 * `[startDate, endDate)` (Story 7.5, FR55). "Issued" means `status in
 * ('issued','paid')` — a draft/void/overdue row never counts toward billing volume
 * (an issued invoice that later lapses to overdue is still a billed issuance; the
 * MVP volume signal counts only the frozen issued+paid states per the spec). The
 * window is half-open so adjacent billing cycles never double-count a boundary day.
 *
 * `startDate`/`endDate` are `YYYY-MM-DD` strings (compared directly against the
 * `issue_date` date column). RLS scopes the count to the caller's org, so a
 * cross-org invoice is never counted. Returns the exact count via PostgREST
 * `head: true` (no rows transferred); a read error degrades to 0 so the caller's
 * advisory prompt never blocks the page on a transient failure, but is logged via
 * `reportError` so a persistently broken count (which would silently disable the
 * FR55 upgrade prompt) is observable rather than failing closed in the dark.
 */
export async function countIssuedInvoicesInPeriod(
  client: SupabaseClient,
  orgId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  const { count, error } = await client
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .in("status", ["issued", "paid"])
    .gte("issue_date", startDate)
    .lt("issue_date", endDate);

  if (error) {
    reportError(error, {
      op: "countIssuedInvoicesInPeriod",
      orgId,
      startDate,
      endDate,
    });
    return 0;
  }
  return count ?? 0;
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

  // The stored tax line(s), ordered (Story 12.3). Zero or one HST row for the MVP
  // Ontario path; loaded so the form/render show the persisted values on reload.
  const { data: taxLines, error: taxError } = await client
    .from("invoice_tax_lines")
    .select("*")
    .eq("invoice_id", invoiceId)
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: true });

  if (taxError) {
    return { data: null, error: "Failed to load invoice tax lines." };
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
      taxLines: (taxLines ?? []) as InvoiceTaxLineRow[],
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
 * Look up one invoice by its exact `share_token` for the PUBLIC `/i/[token]` proxy
 * (Story 12.6, I4/I5). The caller passes the SERVICE-ROLE admin client because the
 * public route has no authenticated session (there is no `auth.uid()`, so an
 * RLS-scoped client would return nothing) — this is a documented narrow bootstrap
 * path (the same category as the pre-auth demo read), and the route exposes ONLY the
 * frozen PDF bytes it gates on, never any other invoice field.
 *
 * Matches on the full token via `.eq("share_token", token).maybeSingle()` (mirroring
 * the `finalizeClaim` token lookup): an unknown/empty token simply returns `null`.
 * The token is a 128-bit non-enumerable secret (I4), so an exact match is the entire
 * authorization for the read.
 */
export async function getInvoiceByShareToken(
  adminClient: SupabaseClient,
  token: string,
): Promise<InvoiceRow | null> {
  if (!token) {
    return null;
  }
  const { data, error } = await adminClient
    .from("invoices")
    .select("*")
    .eq("share_token", token)
    .maybeSingle();

  if (error || !data) {
    return null;
  }
  return data as InvoiceRow;
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
