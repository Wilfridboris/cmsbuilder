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

/** GET the authoritative non-deleted rows for a logical table. */
export async function fetchRecords(
  slug: string,
  tableKey: string,
): Promise<RecordData[]> {
  const params = new URLSearchParams({ slug, table: tableKey });
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
