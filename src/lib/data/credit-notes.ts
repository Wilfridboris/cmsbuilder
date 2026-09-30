import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ApiResponse } from "@/types/api";
import type {
  CreditNoteLineItemRow,
  CreditNoteRow,
  CreditNoteTaxLineRow,
} from "@/types/db";
import { getSchema } from "@/lib/data/records";
import { resolvedDisplayFieldKey } from "@/lib/schema/relations";

/**
 * Credit-note read layer (Story 12.8) — mirrors `invoices.ts`.
 *
 * Identity-agnostic: the caller supplies the RLS-scoped Supabase client, so a
 * cross-org credit note simply never comes back. Reads never surface raw SQL;
 * failures are returned as an error string in the `ApiResponse` envelope.
 *
 * The customer display label is resolved at READ time from the linked record's
 * `resolvedDisplayFieldKey` (Invariant I6 — the id is a back-reference, never a stored
 * render source). A missing / soft-deleted linked record degrades to a null label.
 */

/**
 * A credit note plus its ordered line items, its ordered tax lines (zero or one HST row
 * for the MVP Ontario path), and the resolved customer label.
 */
export type CreditNoteWithLineItems = {
  creditNote: CreditNoteRow;
  lineItems: CreditNoteLineItemRow[];
  taxLines: CreditNoteTaxLineRow[];
  /** The linked customer record's display label, or null (standalone / missing). */
  customerLabel: string | null;
};

/**
 * A credit note summarized for the linked-list on the source invoice's issued view: the
 * fields the list renders (number, total, status, pdf_path presence, share_token).
 */
export type CreditNoteSummary = Pick<
  CreditNoteRow,
  | "id"
  | "status"
  | "credit_note_number"
  | "total"
  | "issue_date"
  | "share_token"
  | "pdf_path"
  | "created_at"
>;

/**
 * List the credit notes linked to one source invoice, newest first. RLS scopes
 * visibility to the caller's org. Returns the `{ data, error }` envelope; raw SQL never
 * leaks.
 */
export async function listCreditNotesForInvoice(
  client: SupabaseClient,
  orgId: string,
  invoiceId: string,
): Promise<ApiResponse<CreditNoteSummary[]>> {
  const { data, error } = await client
    .from("credit_notes")
    .select(
      "id, status, credit_note_number, total, issue_date, share_token, pdf_path, created_at",
    )
    .eq("organization_id", orgId)
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: false });

  if (error) {
    return { data: null, error: "Failed to load credit notes." };
  }

  return { data: (data ?? []) as CreditNoteSummary[], error: null };
}

/**
 * Sum the `total` of every ISSUED credit note already linked to one source invoice
 * (Story 12.8 / retro [X1]), optionally excluding one credit note by id (the one being
 * issued). Void credit notes are cancelled and never count against the creditable
 * balance; drafts are not yet committed and never count — so only `status = 'issued'`
 * rows are summed. RLS scopes visibility to the caller's org. Returns the `{ data, error }`
 * envelope; raw SQL never leaks.
 */
export async function sumIssuedCreditNoteTotals(
  client: SupabaseClient,
  orgId: string,
  invoiceId: string,
  excludeCreditNoteId?: string,
): Promise<ApiResponse<number>> {
  let query = client
    .from("credit_notes")
    .select("id, total")
    .eq("organization_id", orgId)
    .eq("invoice_id", invoiceId)
    .eq("status", "issued");
  if (excludeCreditNoteId) {
    query = query.neq("id", excludeCreditNoteId);
  }

  const { data, error } = await query;
  if (error) {
    return { data: null, error: "Failed to load credit notes." };
  }

  const sum = (data ?? []).reduce((acc, row) => {
    const n = Number((row as { total: number | string }).total);
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);

  return { data: sum, error: null };
}

/**
 * Load one credit note with its ordered line items, ordered tax lines, and the resolved
 * customer display label. Returns `null` data when the credit note does not exist under
 * the caller's org (RLS-hidden or unknown id). The label resolves at read time and
 * degrades to null when the linked record is missing / soft-deleted (Invariant I6).
 */
export async function getCreditNoteWithLineItems(
  client: SupabaseClient,
  orgId: string,
  creditNoteId: string,
): Promise<ApiResponse<CreditNoteWithLineItems | null>> {
  const { data: creditNote, error: cnError } = await client
    .from("credit_notes")
    .select("*")
    .eq("id", creditNoteId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (cnError) {
    return { data: null, error: "Failed to load credit note." };
  }
  if (!creditNote) {
    return { data: null, error: null };
  }

  const creditNoteRow = creditNote as CreditNoteRow;

  const { data: lines, error: linesError } = await client
    .from("credit_note_line_items")
    .select("*")
    .eq("credit_note_id", creditNoteId)
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: true });

  if (linesError) {
    return { data: null, error: "Failed to load credit note line items." };
  }

  const { data: taxLines, error: taxError } = await client
    .from("credit_note_tax_lines")
    .select("*")
    .eq("credit_note_id", creditNoteId)
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: true });

  if (taxError) {
    return { data: null, error: "Failed to load credit note tax lines." };
  }

  const customerLabel = await resolveCustomerLabel(
    client,
    orgId,
    creditNoteRow.customer_record_id,
  );

  return {
    data: {
      creditNote: creditNoteRow,
      lineItems: (lines ?? []) as CreditNoteLineItemRow[],
      taxLines: (taxLines ?? []) as CreditNoteTaxLineRow[],
      customerLabel,
    },
    error: null,
  };
}

/**
 * Resolve the display label for a linked customer record. Reads the record under RLS,
 * finds its logical table in the org schema, and returns the value of that table's
 * `resolvedDisplayFieldKey`. Returns null for a standalone draft (no id), a missing /
 * soft-deleted record, or any table/field that no longer resolves. Mirrors the invoice
 * read layer's helper.
 */
async function resolveCustomerLabel(
  client: SupabaseClient,
  orgId: string,
  customerRecordId: string | null,
): Promise<string | null> {
  if (!customerRecordId) {
    return null;
  }

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
  const table = schemaResult.data.tables.find((tbl) => tbl.key === tableKey);
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
 * Look up one credit note by its exact `share_token` for the PUBLIC `/i/[token]` proxy
 * (Story 12.8, I4/I5). The caller passes the SERVICE-ROLE admin client because the public
 * route has no authenticated session. Mirrors `getInvoiceByShareToken`: an exact token
 * match (a 128-bit non-enumerable secret) is the entire authorization for the read; the
 * route exposes ONLY the frozen PDF bytes it gates on, never any other field.
 */
export async function getCreditNoteByShareToken(
  adminClient: SupabaseClient,
  token: string,
): Promise<CreditNoteRow | null> {
  if (!token) {
    return null;
  }
  const { data, error } = await adminClient
    .from("credit_notes")
    .select("*")
    .eq("share_token", token)
    .maybeSingle();

  if (error || !data) {
    return null;
  }
  return data as CreditNoteRow;
}
