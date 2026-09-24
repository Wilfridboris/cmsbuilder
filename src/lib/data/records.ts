import type { SupabaseClient } from "@supabase/supabase-js";

import type { ApiResponse } from "@/types/api";
import type { RecordData, SchemaDefinition } from "@/types/db";
import { normalizeTableName } from "@/lib/utils";

/**
 * JSONB read layer (Story 1.2).
 *
 * Identity-agnostic: the caller supplies the Supabase client, so the same
 * functions serve an RLS-scoped user client and the bootstrap admin client
 * (pre-auth demo read). Reads never surface raw SQL; failures are returned as
 * an error string in the `ApiResponse` envelope.
 */

/**
 * Return the non-deleted rows for a logical table as `{ id, version, data }`,
 * ordered oldest-first for stable rendering. RLS (or the admin client's
 * explicit org filter) scopes visibility; soft-deleted rows are excluded.
 */
export async function listRecords(
  client: SupabaseClient,
  orgId: string,
  tableKey: string,
): Promise<ApiResponse<RecordData[]>> {
  const { data, error } = await client
    .from("records")
    .select("id, version, data")
    .eq("organization_id", orgId)
    // Normalize on read as `mutate.ts` does on write, so a caller passing an
    // un-normalized key (e.g. "Clients") still matches the stored table_key.
    .eq("table_key", normalizeTableName(tableKey))
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    return { data: null, error: "Failed to load records." };
  }

  const rows: RecordData[] = (data ?? []).map((row) => ({
    id: row.id as string,
    version: row.version as number,
    data: (row.data ?? {}) as Record<string, unknown>,
  }));

  return { data: rows, error: null };
}

/**
 * Return the org's authoritative logical schema (`org_schemas.definition`).
 * A missing row — or a present-but-empty definition (the DB default is
 * `'{}'::jsonb`, which has no `tables` key) — is normalized to `{ tables: [] }`
 * so a freshly-provisioned org degrades gracefully and callers can always rely
 * on `.tables` being an array.
 */
export async function getSchema(
  client: SupabaseClient,
  orgId: string,
): Promise<ApiResponse<SchemaDefinition>> {
  const { data, error } = await client
    .from("org_schemas")
    .select("definition")
    .eq("organization_id", orgId)
    .maybeSingle();

  if (error) {
    return { data: null, error: "Failed to load schema." };
  }

  const raw = data?.definition as Partial<SchemaDefinition> | undefined;
  const definition: SchemaDefinition = { tables: raw?.tables ?? [] };

  return { data: definition, error: null };
}
