import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { LOGO_BUCKET } from "@/lib/storage/logo";

/**
 * The Day-30 offboarding cascade (Story 8.5, FR38). The single non-obvious
 * correctness point of the story: an org's user-data is hard-deleted irreversibly,
 * but the statutorily-retained invoice/credit-note tables and their frozen PDFs
 * (six-year retention — Story 12.5) MUST survive.
 *
 * Because every org-scoped table FKs `organizations ON DELETE CASCADE`, deleting the
 * `organizations` row would cascade-delete the retained invoices too. So the cascade
 * NEVER deletes the org row: it deletes the INCLUDE tables explicitly (each filtered
 * by `organization_id`), removes the org's `business-logos` objects, then writes a
 * surviving `deleted` TOMBSTONE row that still carries the retained invoice tables.
 *
 * Service-role only: this is an allowlisted platform op (the only elevated-privilege
 * write path in this story), run from the offboarding cron with `createAdminClient()`.
 * Never routed through the guarded `mutate.ts` path.
 *
 * Re-entrant: every delete is idempotent (a re-run deletes zero already-gone rows),
 * so a partial failure retries cleanly on the next sweep. The tombstone write is the
 * last step; until it lands, `offboarding_purged_at` stays null and the sweep retries.
 *
 * Purging `records` is safe for the retained docs: `invoices.customer_record_id` /
 * `credit_notes.customer_record_id` are `ON DELETE SET NULL` and issued docs carry a
 * frozen `customer_snapshot`, so a retained invoice loses only the live loose link.
 */

/**
 * The user-data tables the cascade deletes, each filtered by `organization_id`.
 * Exported so a test can assert the purge touches EXACTLY this set.
 */
export const CASCADE_INCLUDE_TABLES = [
  "records",
  "org_schemas",
  "org_members",
  "business_profiles",
  "pending_claims",
  "forms",
] as const;

/**
 * The statutory-retention EXCLUDE list — tables the cascade MUST NOT touch under any
 * path (six-year retention obligation; Story 12.5). Exported so a test can assert the
 * cascade never references any of them. The `invoice-pdfs` storage bucket is likewise
 * never touched (only `business-logos` is removed).
 */
export const CASCADE_EXCLUDE_TABLES = [
  "invoices",
  "invoice_line_items",
  "invoice_tax_lines",
  "invoice_payments",
  "invoice_number_counters",
  "credit_notes",
  "credit_note_line_items",
  "credit_note_tax_lines",
  "credit_note_number_counters",
] as const;

/** The outcome of one cascade run (for the cron summary + observability). */
export type CascadeDeleteResult = {
  /** The org that was purged + tombstoned. */
  orgId: string;
  /** How many logo objects were removed from `business-logos`. */
  logosRemoved: number;
};

/**
 * Irreversibly purge an org's user-data (the INCLUDE set) + its logo object(s), then
 * write the `deleted` tombstone. Throws on any delete/update failure so the cron logs
 * it, leaves `offboarding_purged_at` null, and retries next sweep (re-entrant).
 *
 * `adminClient` MUST be a service-role client (`createAdminClient()`). `orgId` is the
 * org to purge.
 */
export async function cascadeDeleteOrganization(
  adminClient: SupabaseClient,
  orgId: string,
): Promise<CascadeDeleteResult> {
  // 1. Delete every INCLUDE table's rows for this org. Each filtered by
  //    `organization_id` so the delete is tenant-scoped and idempotent (a re-run
  //    deletes zero already-gone rows).
  for (const table of CASCADE_INCLUDE_TABLES) {
    const { error } = await adminClient
      .from(table)
      .delete()
      .eq("organization_id", orgId);
    if (error) {
      throw new Error(
        `cascade purge failed deleting ${table} for org ${orgId}: ${error.message}`,
      );
    }
  }

  // 2. Remove the org's logo object(s) from the private `business-logos` bucket. Keys
  //    are `${orgId}/logo.<ext>` (see storage/logo.ts), so list the org's prefix and
  //    remove exactly those keys. Best-effort on an empty prefix; a storage error is
  //    fatal so the purge retries (no partial tombstone).
  let logosRemoved = 0;
  const { data: objects, error: listError } = await adminClient.storage
    .from(LOGO_BUCKET)
    .list(orgId);
  if (listError) {
    throw new Error(
      `cascade purge failed listing logos for org ${orgId}: ${listError.message}`,
    );
  }
  const keys = (objects ?? []).map((obj) => `${orgId}/${obj.name}`);
  if (keys.length > 0) {
    const { error: removeError } = await adminClient.storage
      .from(LOGO_BUCKET)
      .remove(keys);
    if (removeError) {
      throw new Error(
        `cascade purge failed removing logos for org ${orgId}: ${removeError.message}`,
      );
    }
    logosRemoved = keys.length;
  }

  // 3. Write the terminal tombstone. The org ROW survives (keeping the retained
  //    invoice tables that FK it); it is marked `deleted` and stamped so the sweep
  //    skips it and the cascade is never re-run for it. This is the LAST step: if any
  //    step above fails, `offboarding_purged_at` stays null and the whole purge retries.
  const { error: tombstoneError } = await adminClient
    .from("organizations")
    .update({
      subscription_status: "deleted",
      offboarding_purged_at: new Date().toISOString(),
    })
    .eq("id", orgId);
  if (tombstoneError) {
    throw new Error(
      `cascade purge failed writing tombstone for org ${orgId}: ${tombstoneError.message}`,
    );
  }

  return { orgId, logosRemoved };
}
