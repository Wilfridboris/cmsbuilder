import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { getSchema } from "@/lib/data/records";
import { hideField, showField } from "@/lib/schema/overrides";

/**
 * Guarded schema-visibility write layer (Story 3.5) — the single, targeted path
 * that persists an Admin's column show/hide to `org_schemas.definition`.
 *
 * Deliberately mirrors `mutate.ts`'s identity-agnostic contract: the caller
 * supplies an RLS-scoped Supabase client and the acting identity, so this layer
 * never reads cookies and never touches the service-role key. The `org_schemas`
 * UPDATE runs under the caller's RLS client, and the existing
 * `org_schemas_tenant_isolation` policy scopes it to the caller's own org — no
 * new policy is required.
 *
 * The mutation surface is exactly one boolean flag on one existing field:
 *   - read the org's CURRENT definition server-side (`getSchema`);
 *   - verify the `tableKey`/`fieldKey` actually exist → 400 otherwise, no write;
 *   - apply the pure `hideField`/`showField` transform (append-only flag);
 *   - write the full definition back.
 *
 * A client can therefore never post an arbitrary schema — the definition is
 * always re-derived from the stored one. The change is non-destructive and fully
 * reversible: the field definition and every `records.data` value are preserved
 * and simply drop out of / reappear in the existing `!hidden` render filters.
 */

export type SchemaMutateIdentity = {
  /** RLS-scoped Supabase client (never the service-role admin client). */
  client: SupabaseClient;
  /** The acting user id (kept for parity with `MutateIdentity`). */
  actorId: string;
  /** The org whose schema is being edited; scopes the read and the UPDATE. */
  orgId: string;
};

/**
 * Set a single field's visibility for the whole org (append-only `hidden` flag).
 * Returns the persisted `SchemaDefinition` in the `ApiResponse` envelope; raw
 * SQL is never leaked.
 */
export async function setFieldVisibility(
  identity: SchemaMutateIdentity,
  tableKey: string,
  fieldKey: string,
  hidden: boolean,
): Promise<ApiResponse<{ tableKey: string; fieldKey: string; hidden: boolean }>> {
  try {
    const { client, orgId } = identity;

    // 1. Read the org's CURRENT authoritative definition under the RLS client.
    const current = await getSchema(client, orgId);
    if (current.error || !current.data) {
      throw new AppError(500, "writeFailed");
    }
    const schema = current.data;

    // 2. Verify the targeted table + field actually exist. A body referencing a
    //    missing table/field is a 400 with no write — the server never trusts a
    //    client-supplied identifier.
    const table = schema.tables.find((t) => t.key === tableKey);
    const field = table?.fields.find((f) => f.key === fieldKey);
    if (!table || !field) {
      throw new AppError(400, "genericError");
    }

    // 3. Apply the pure, immutable transform (only the `hidden` flag changes).
    const next = hidden
      ? hideField(schema, tableKey, fieldKey)
      : showField(schema, tableKey, fieldKey);

    // 4. Persist the full definition back under the RLS client. RLS + the
    //    tenant-isolation policy scope the UPDATE to the caller's own org.
    const { error } = await client
      .from("org_schemas")
      .update({ definition: next, updated_at: new Date().toISOString() })
      .eq("organization_id", orgId);

    if (error) {
      throw new AppError(500, "writeFailed", error.message);
    }

    return { data: { tableKey, fieldKey, hidden }, error: null };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}
