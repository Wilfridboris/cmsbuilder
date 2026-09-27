import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ApiResponse } from "@/types/api";
import type { RecordData, SchemaDefinition } from "@/types/db";
import { normalizeTableName } from "@/lib/utils";
import { REFERENCE_COUNT_CAP } from "@/lib/data/records-client";
import {
  enumerateInboundRelations,
  type InboundRelation,
} from "@/lib/data/relations";

// Re-export so existing server importers keep resolving the cap from `records.ts`;
// the constant itself lives in the client-safe `records-client.ts`.
export { REFERENCE_COUNT_CAP };

// Re-export the pure relation enumeration (extracted to the client-safe
// `relations.ts` in Story 3.9) so existing importers — `countReferencingRecords`
// below, the references route, and the safe-delete tests — keep resolving the
// symbols from `records.ts` unchanged.
export { enumerateInboundRelations };
export type { InboundRelation };

/**
 * A relation filter applied server-side to a `listRecords` query (Story 3.8):
 * keep only rows whose `data[field]` equals `targetId`, evaluated as a JSONB
 * containment (`data @> {field: targetId}`, GIN-indexed) — never `data->>field`.
 */
export type RelationFilter = { field: string; targetId: string };

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
  relationFilters: RelationFilter[] = [],
): Promise<ApiResponse<RecordData[]>> {
  let builder = client
    .from("records")
    .select("id, version, data")
    .eq("organization_id", orgId)
    // Normalize on read as `mutate.ts` does on write, so a caller passing an
    // un-normalized key (e.g. "Clients") still matches the stored table_key.
    .eq("table_key", normalizeTableName(tableKey))
    .is("deleted_at", null);

  // Filter-by-relationship (Story 3.8): each relation filter narrows the set to
  // rows whose JSONB `data` CONTAINS `{ field: targetId }`. `.contains` emits the
  // index-backed `@>` operator (served by the existing `records_data_gin_idx`),
  // never a `data->>field` text extraction. Multiple filters chain (AND).
  for (const { field, targetId } of relationFilters) {
    builder = builder.contains("data", { [field]: targetId });
  }

  const { data, error } = await builder.order("created_at", {
    ascending: true,
  });

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
 * on `.tables` being an array. Other top-level definition fields (e.g. the
 * Story 1.5 `isFallback` flag) are preserved verbatim, so the flag stored at
 * provisioning survives read-back and claim.
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
  // Preserve every top-level definition field (e.g. `isFallback`) and only
  // normalize `tables` to an array — reconstructing `{ tables }` alone would
  // silently drop the persisted fallback flag on read-back.
  const definition: SchemaDefinition = raw
    ? { ...raw, tables: raw.tables ?? [] }
    : { tables: [] };

  return { data: definition, error: null };
}

/** One candidate / resolved label: the target row's id and its display label. */
export type RecordLabel = { id: string; label: string };

/** The default bound on typeahead candidates returned per search request. */
export const RELATION_SEARCH_LIMIT = 20;

/**
 * Escape the special characters in an ILIKE pattern (Story 3.7). A user query is
 * matched as a substring (`%query%`), so `%`, `_`, and the escape char `\` in the
 * query itself must be treated literally rather than as wildcards — otherwise a
 * query of "50%" would match everything. PostgREST passes the pattern straight
 * to SQL `ILIKE`, so we escape here.
 */
function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Bounded server-side typeahead over a target table's `displayField` (Story 3.7).
 *
 * Returns up to `limit` candidates whose display label contains `query`
 * (case-insensitive), ordered by label for a stable list. Every read filters
 * `organization_id` + `table_key` + `deleted_at IS NULL` (soft-deleted targets
 * never surface). Identity-agnostic: the caller supplies the RLS-scoped client.
 * Rows whose display value is missing/blank are dropped (nothing to show).
 *
 * The bounded ILIKE + LIMIT meets the p95 <500ms budget at MVP scale; a per-table
 * `pg_trgm` index for the >10k-row case is a scale follow-up (deferred-work), not
 * this path. Returns the `{ data, error }` envelope; raw SQL is never surfaced.
 */
export async function searchRelationRecords(
  client: SupabaseClient,
  orgId: string,
  targetTableKey: string,
  displayFieldKey: string,
  query: string,
  limit: number = RELATION_SEARCH_LIMIT,
): Promise<ApiResponse<RecordLabel[]>> {
  let builder = client
    .from("records")
    .select("id, data")
    .eq("organization_id", orgId)
    .eq("table_key", normalizeTableName(targetTableKey))
    .is("deleted_at", null);

  const trimmed = query.trim();
  if (trimmed !== "") {
    // Match the label as a case-insensitive substring on the JSONB text value.
    builder = builder.ilike(
      `data->>${displayFieldKey}`,
      `%${escapeIlike(trimmed)}%`,
    );
  }

  const { data, error } = await builder
    .order(`data->>${displayFieldKey}`, { ascending: true })
    .limit(limit);

  if (error) {
    return { data: null, error: "Failed to search records." };
  }

  const results: RecordLabel[] = [];
  for (const row of data ?? []) {
    const value = (row.data as Record<string, unknown> | null)?.[displayFieldKey];
    if (value === undefined || value === null || String(value).trim() === "") {
      continue;
    }
    results.push({ id: row.id as string, label: String(value) });
  }

  return { data: results, error: null };
}

/**
 * Resolve display labels for a set of target ids in ONE batched query (Story
 * 3.7) — the read-time label display for table/card cells. Filters
 * `organization_id` + `table_key` + `deleted_at IS NULL` and `id IN (ids)`, so a
 * soft-deleted or foreign id simply does not come back (the caller renders the
 * translated "archived" placeholder for any id absent from the returned map).
 *
 * Never a per-row query: one `.in("id", ids)` per target table per page. An empty
 * `ids` short-circuits to an empty result. Identity-agnostic (RLS-scoped client).
 */
export async function resolveRecordLabels(
  client: SupabaseClient,
  orgId: string,
  targetTableKey: string,
  displayFieldKey: string,
  ids: string[],
): Promise<ApiResponse<RecordLabel[]>> {
  const uniqueIds = Array.from(new Set(ids.filter((id) => id)));
  if (uniqueIds.length === 0) {
    return { data: [], error: null };
  }

  const { data, error } = await client
    .from("records")
    .select("id, data")
    .eq("organization_id", orgId)
    .eq("table_key", normalizeTableName(targetTableKey))
    .is("deleted_at", null)
    .in("id", uniqueIds);

  if (error) {
    return { data: null, error: "Failed to resolve labels." };
  }

  const labels: RecordLabel[] = [];
  for (const row of data ?? []) {
    const value = (row.data as Record<string, unknown> | null)?.[displayFieldKey];
    if (value === undefined || value === null || String(value).trim() === "") {
      continue;
    }
    labels.push({ id: row.id as string, label: String(value) });
  }

  return { data: labels, error: null };
}

/**
 * Count the non-deleted rows across the org that reference `targetId` (Story 3.8
 * safe-delete guard). Enumerates the schema's inbound `(table_key, field)` relation
 * pairs and, for each, runs a `count: "exact", head: true` containment query
 * (`org` + `table_key` + `deleted_at IS NULL` + `.contains("data", { field: id })`),
 * summing the counts. Containment (`@>`) is served by the existing GIN index — never
 * a `data->>field` text extraction.
 *
 * Short-circuits at `cap`: once the running total reaches the cap we stop issuing
 * further queries and return `cap` (the caller renders "cap+"). Identity-agnostic
 * (RLS-scoped client). Returns the `{ data, error }` envelope; raw SQL is never
 * surfaced. A pair with no matching rows contributes 0; an unresolved target simply
 * yields 0 total.
 */
export async function countReferencingRecords(
  client: SupabaseClient,
  orgId: string,
  schema: SchemaDefinition,
  targetTableKey: string,
  targetId: string,
  cap: number = REFERENCE_COUNT_CAP,
): Promise<ApiResponse<number>> {
  const pairs = enumerateInboundRelations(schema, targetTableKey);

  let total = 0;
  for (const { tableKey, fieldKey } of pairs) {
    const { count, error } = await client
      .from("records")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("table_key", normalizeTableName(tableKey))
      .is("deleted_at", null)
      .contains("data", { [fieldKey]: targetId });

    if (error) {
      return { data: null, error: "Failed to count references." };
    }

    total += count ?? 0;
    if (total >= cap) {
      return { data: cap, error: null };
    }
  }

  return { data: total, error: null };
}
