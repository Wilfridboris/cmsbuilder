import type { ApiResponse } from "@/types/api";
import type { RecordData } from "@/types/db";

/**
 * Client-side fetch wrappers for the `/api/records` family (Story 3.2).
 *
 * Each parses the `{ data, error }` envelope and, on failure, throws a
 * `RecordApiError` carrying the server's translated error CODE (e.g.
 * `versionConflict`, `writeFailed`). The mutation hooks catch this and map the
 * code to a translated message — a raw error, stack, or SQL never reaches here.
 */

/** Carries the server error code so callers can resolve a translated message. */
export class RecordApiError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "RecordApiError";
    this.code = code;
  }
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  let body: ApiResponse<T>;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new RecordApiError("genericError");
  }
  if (!res.ok || body.error !== null || body.data === null) {
    throw new RecordApiError(body.error ?? "genericError");
  }
  return body.data;
}

/**
 * One relation filter applied server-side (Story 3.8): keep rows where the given
 * relation field equals the chosen target id (JSONB containment on the server).
 */
export type RelationFilter = { field: string; targetId: string };

/**
 * The default cap on the delete-guard reference count (Story 3.8). Counting stops
 * once this many referencing rows are found; the caller renders "500+". Lives in
 * this client-safe module so the confirm dialog can import it without pulling in
 * the server-only `records.ts` data layer.
 */
export const REFERENCE_COUNT_CAP = 500;

/**
 * GET the authoritative non-deleted rows for a logical table. When
 * `relationFilters` are supplied (Story 3.8) they are serialized as repeatable
 * `rel=field:id` params so the server narrows the set via JSONB containment before
 * returning; scalar filters/sort stay a client-side concern over the result.
 */
export async function fetchRecords(
  slug: string,
  tableKey: string,
  relationFilters: RelationFilter[] = [],
): Promise<RecordData[]> {
  const params = new URLSearchParams({ slug, table: tableKey });
  for (const { field, targetId } of relationFilters) {
    params.append("rel", `${field}:${targetId}`);
  }
  const res = await fetch(`/api/records?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  return parseEnvelope<RecordData[]>(res);
}

/** POST a new record; returns the created row reconciled to its server id/version. */
export async function createRecord(
  slug: string,
  tableKey: string,
  data: Record<string, unknown>,
  idempotencyKey: string,
): Promise<RecordData> {
  const res = await fetch("/api/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, table: tableKey, data, idempotencyKey }),
  });
  return parseEnvelope<RecordData>(res);
}

/**
 * PATCH a record's full merged `data`, gated on its current version; returns the
 * row reconciled to its server id/version (Story 3.3 inline edit). The route
 * echoes `{ id, version, data }`, which is exactly a `RecordData`.
 */
export async function updateRecord(
  slug: string,
  id: string,
  table: string,
  data: Record<string, unknown>,
  expectedVersion: number,
): Promise<RecordData> {
  const res = await fetch(`/api/records/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, table, data, expectedVersion }),
  });
  return parseEnvelope<RecordData>(res);
}

/** One relation candidate / resolved label: a target id and its display label. */
export type RelationRecordLabel = { id: string; label: string };

/**
 * GET the server-side typeahead candidates for a relation field (Story 3.7): up
 * to N target rows whose `displayField` label matches `query`, by label. An empty
 * `query` lists the first N. Parses `{ data: { results } }`; throws
 * `RecordApiError(code)` on failure so the picker can show a translated error.
 */
export async function searchRelationRecords(
  slug: string,
  table: string,
  query: string,
): Promise<RelationRecordLabel[]> {
  const params = new URLSearchParams({ slug, table, query });
  const res = await fetch(`/api/records/search?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const body = await parseEnvelope<{ results: RelationRecordLabel[] }>(res);
  return body.results;
}

/**
 * Client-side batch size for label resolution. MUST stay `<=` the server's
 * `MAX_LABEL_IDS` (200) in `api/records/labels/schemas.ts` — a page can reference
 * more distinct target ids than that (records are unpaginated), so we chunk the id
 * list here rather than 400 the whole batch.
 */
const LABEL_ID_BATCH = 200;

/**
 * GET batched display labels for a set of relation target ids (Story 3.7). One
 * request per chunk of up to `LABEL_ID_BATCH` ids per target table (`id IN (...)`
 * server-side); a page referencing more than the server cap is split across
 * requests and merged. Parses `{ data: { labels } }`; an id that is
 * soft-deleted/foreign simply won't appear in the returned array (the caller
 * renders the "archived" placeholder for it).
 */
export async function fetchRelationLabels(
  slug: string,
  table: string,
  ids: string[],
): Promise<RelationRecordLabel[]> {
  const unique = Array.from(new Set(ids.filter((id) => id)));
  if (unique.length === 0) {
    return [];
  }

  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += LABEL_ID_BATCH) {
    batches.push(unique.slice(i, i + LABEL_ID_BATCH));
  }

  const chunks = await Promise.all(
    batches.map(async (batch) => {
      const params = new URLSearchParams({ slug, table, ids: batch.join(",") });
      const res = await fetch(`/api/records/labels?${params.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const body = await parseEnvelope<{ labels: RelationRecordLabel[] }>(res);
      return body.labels;
    }),
  );

  return chunks.flat();
}

/**
 * GET the count of non-deleted rows that reference `id` (Story 3.8 safe-delete
 * guard). Parses `{ data: { count } }`; throws `RecordApiError(code)` on failure so
 * the confirm dialog can show its neutral "couldn't verify references" fallback
 * (a failure here never blocks the delete).
 */
export async function fetchReferenceCount(
  slug: string,
  table: string,
  id: string,
): Promise<number> {
  const params = new URLSearchParams({ slug, table });
  const res = await fetch(
    `/api/records/${encodeURIComponent(id)}/references?${params.toString()}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  );
  const body = await parseEnvelope<{ count: number }>(res);
  return body.count;
}

/** DELETE (soft) a record by id, gated on its current version. */
export async function deleteRecord(
  slug: string,
  id: string,
  expectedVersion: number,
): Promise<void> {
  const params = new URLSearchParams({
    slug,
    expectedVersion: String(expectedVersion),
  });
  const res = await fetch(
    `/api/records/${encodeURIComponent(id)}?${params.toString()}`,
    {
      method: "DELETE",
      headers: { Accept: "application/json" },
    },
  );
  await parseEnvelope<{ deleted: true }>(res);
}
