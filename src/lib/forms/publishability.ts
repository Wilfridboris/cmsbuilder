import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { FormRow } from "@/types/db";
import { getSchema } from "@/lib/data/records";
import { visibleTables } from "@/lib/schema/overrides";
import { intakeFields } from "@/lib/intake/target";

/**
 * The single source of truth for the Forms publish gate (Epic 14, Story 14.3).
 *
 * A form may be published ONLY when it has a VALID target table — exactly the predicate
 * the 14.2 public resolver (`resolvePublicFormTarget`) requires to render:
 *   - `target_table_key` is non-null, AND
 *   - it names a currently-VISIBLE table (a stale key naming a deleted/hidden table
 *     fails), AND
 *   - that table has at least one eligible intake field (`intakeFields` non-empty).
 *
 * Enforcing the same predicate here means a published form can never land in an
 * immediate "form not available" state on its public URL.
 *
 * Shared by the `publishForm` mutation (the authority on the write) and the editor
 * loader (so the toggle renders disabled with a reason). Returns a coarse,
 * non-technical `reason` — never a provider/DB internal. A schema READ error is
 * treated as not-publishable (`invalid-target`) rather than surfaced, since the gate
 * must fail closed.
 */
export type PublishabilityReason = "ok" | "no-target" | "invalid-target";

export type Publishability = {
  publishable: boolean;
  reason: PublishabilityReason;
};

/**
 * Evaluate whether `form` may be published within `orgId`, under the caller's RLS
 * client. Never throws — every failure path degrades to a not-publishable result so
 * the gate fails closed.
 */
export async function evaluateFormPublishability(
  client: SupabaseClient,
  orgId: string,
  form: FormRow,
): Promise<Publishability> {
  // A null target table (the org had no visible tables at create time) — nothing to
  // collect into.
  if (!form.target_table_key) {
    return { publishable: false, reason: "no-target" };
  }

  const schemaResult = await getSchema(client, orgId);
  if (schemaResult.error || !schemaResult.data) {
    // Fail closed: a schema we cannot read cannot prove a valid target.
    return { publishable: false, reason: "invalid-target" };
  }

  // The target must still name a CURRENTLY-visible table (a stale key naming a
  // deleted/now-hidden table is invalid — `visibleTables` excludes hidden tables).
  const table = visibleTables(schemaResult.data).find(
    (t) => t.key === form.target_table_key,
  );
  if (!table) {
    return { publishable: false, reason: "invalid-target" };
  }

  // The table must have at least one eligible, non-relation intake field.
  if (intakeFields(table).length === 0) {
    return { publishable: false, reason: "invalid-target" };
  }

  return { publishable: true, reason: "ok" };
}
