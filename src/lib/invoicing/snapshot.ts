import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import type { CustomerSnapshot, SupplierSnapshot } from "@/types/db";

/**
 * Snapshot builders (Invariant I6) — shared by the invoice and credit-note issue paths
 * (retro [A1], extracted from the two byte-identical copies in the mutation layers).
 *
 * At issue time the supplier identity + payment instructions and the linked customer are
 * FROZEN into the document row so all later rendering reads the snapshot, never the live
 * profile/record. Both builders run under the caller's RLS client.
 */

/**
 * Freeze the supplier identity + payment instructions from the org's Business Profile row
 * (I6). The caller must have already guaranteed a profile with a non-blank legal name (the
 * issuance gate does this), so `profile` is the non-null `business_profiles` row.
 */
export function buildSupplierSnapshot(
  profile: Record<string, unknown>,
): SupplierSnapshot {
  return {
    legal_name: String(profile.legal_name),
    operating_name: (profile.operating_name as string | null) ?? null,
    entity_type:
      (profile.entity_type as SupplierSnapshot["entity_type"]) ?? null,
    jurisdiction: (profile.jurisdiction as string | null) ?? null,
    gst_hst_number: (profile.gst_hst_number as string | null) ?? null,
    gst_hst_effective_date:
      (profile.gst_hst_effective_date as string | null) ?? null,
    logo_path: (profile.logo_path as string | null) ?? null,
    business_address: (profile.business_address as string | null) ?? null,
    mailing_address: (profile.mailing_address as string | null) ?? null,
    default_payment_terms:
      (profile.default_payment_terms as string | null) ?? null,
    payment_etransfer_email:
      (profile.payment_etransfer_email as string | null) ?? null,
    payment_cheque_payable_to:
      (profile.payment_cheque_payable_to as string | null) ?? null,
    payment_cheque_address:
      (profile.payment_cheque_address as string | null) ?? null,
    payment_card_link: (profile.payment_card_link as string | null) ?? null,
    language:
      (profile.default_language as SupplierSnapshot["language"]) ?? "en",
  };
}

/**
 * Freeze the linked customer (I6), or return null for a standalone document (no linked
 * record id). The record's `data` is read under the caller's RLS client so a cross-org id
 * never leaks. A genuine read error is SURFACED (rather than silently freezing an empty
 * customer identity into an immutable document); a legitimately absent/soft-deleted record
 * (no row) degrades to a snapshot with the resolved `display_label` and empty data.
 */
export async function buildCustomerSnapshot(
  client: SupabaseClient,
  orgId: string,
  customerRecordId: string | null,
  customerLabel: string | null,
): Promise<CustomerSnapshot | null> {
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
  if (recordError) {
    throw new AppError(500, "writeFailed", recordError.message);
  }

  return {
    record_id: customerRecordId,
    table_key: (record?.table_key as string | null) ?? "",
    display_label: customerLabel,
    data: ((record?.data as Record<string, unknown> | null) ?? {}) as Record<
      string,
      unknown
    >,
  };
}
