import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { normalizeTableName } from "@/lib/utils";

/**
 * Guarded tenant write layer (Story 1.2) — the single path every tenant write
 * flows through (NFR-FC1). It is identity-agnostic:
 *
 *   - `identity.client` is a caller-supplied Supabase client (an RLS-scoped
 *     user client, or the bootstrap admin client for seeding). Every write
 *     runs through THIS client — `mutate` never reads `cookies()`, so an
 *     out-of-band worker can call the identical layer (NFR-FC3).
 *   - `identity.actorId` is written to `records.actor_id` for attribution.
 *   - `identity.orgId` scopes the write. RLS enforces the caller may only
 *     write its own org; the admin client is trusted by the bootstrap contract.
 *
 * Guarantees:
 *   - inserts de-dupe on an optional `idempotencyKey` (single logical write);
 *   - updates/deletes are gated on `expectedVersion` (0 rows → 409-style
 *     concurrency error), and bump `version` on success;
 *   - delete is a soft-delete (`deleted_at`), retaining the data.
 *
 * Errors are surfaced through the `ApiResponse` envelope as an `AppError`'s
 * `userMessage`; raw SQL is never leaked.
 */

export type MutateIdentity = {
  client: SupabaseClient;
  actorId: string;
  orgId: string;
};

export type MutateOp = "insert" | "update" | "delete";

export type MutateOptions = {
  /** For `update`/`delete`: the version the caller last read. Required there. */
  expectedVersion?: number;
  /** For `insert`: de-dupes retries into a single logical write. */
  idempotencyKey?: string;
  /** For `update`/`delete`: the target row's id. Required there. */
  recordId?: string;
};

export type MutateResult = { id: string; version: number };

/**
 * Apply a single guarded write. `data` is the full row payload for `insert`
 * and the fields to merge for `update`; it is ignored for `delete`.
 */
export async function mutate(
  identity: MutateIdentity,
  op: MutateOp,
  tableKey: string,
  data: Record<string, unknown>,
  opts: MutateOptions = {},
): Promise<ApiResponse<MutateResult>> {
  try {
    const normalizedTableKey = normalizeTableName(tableKey);
    if (!normalizedTableKey) {
      throw new AppError(400, "A valid table is required.");
    }

    switch (op) {
      case "insert":
        return {
          data: await insertRecord(identity, normalizedTableKey, data, opts),
          error: null,
        };
      case "update":
        return {
          data: await updateRecord(identity, data, opts),
          error: null,
        };
      case "delete":
        return {
          data: await deleteRecord(identity, opts),
          error: null,
        };
      default: {
        // Exhaustiveness guard.
        const _never: never = op;
        throw new AppError(400, "Unsupported operation.", `Unknown op: ${_never}`);
      }
    }
  } catch (err) {
    if (err instanceof AppError) {
      return { data: null, error: err.userMessage };
    }
    return { data: null, error: "The write could not be completed." };
  }
}

async function insertRecord(
  identity: MutateIdentity,
  tableKey: string,
  data: Record<string, unknown>,
  opts: MutateOptions,
): Promise<MutateResult> {
  const { client, actorId, orgId } = identity;

  // Idempotency: if this key already produced a row for (org, table_key),
  // return that row rather than writing a duplicate.
  if (opts.idempotencyKey) {
    const { data: existing, error: lookupError } = await client
      .from("records")
      .select("id, version")
      .eq("organization_id", orgId)
      .eq("table_key", tableKey)
      .eq("idempotency_key", opts.idempotencyKey)
      .maybeSingle();

    if (lookupError) {
      throw new AppError(500, "The write could not be completed.", lookupError.message);
    }
    if (existing) {
      return { id: existing.id as string, version: existing.version as number };
    }
  }

  const { data: inserted, error } = await client
    .from("records")
    .insert({
      organization_id: orgId,
      table_key: tableKey,
      data,
      actor_id: actorId,
      idempotency_key: opts.idempotencyKey ?? null,
    })
    .select("id, version")
    .single();

  if (error) {
    // A unique-violation on the idempotency index means a concurrent retry won
    // the race; treat as success by reading the winning row.
    if (opts.idempotencyKey && isUniqueViolation(error.code)) {
      const { data: winner } = await client
        .from("records")
        .select("id, version")
        .eq("organization_id", orgId)
        .eq("table_key", tableKey)
        .eq("idempotency_key", opts.idempotencyKey)
        .maybeSingle();
      if (winner) {
        return { id: winner.id as string, version: winner.version as number };
      }
    }
    throw new AppError(500, "The write could not be completed.", error.message);
  }

  return { id: inserted.id as string, version: inserted.version as number };
}

async function updateRecord(
  identity: MutateIdentity,
  data: Record<string, unknown>,
  opts: MutateOptions,
): Promise<MutateResult> {
  const { client, actorId, orgId } = identity;
  const { recordId, expectedVersion } = requireVersioned(opts);

  const { data: updated, error } = await client
    .from("records")
    .update({
      data,
      actor_id: actorId,
      version: expectedVersion + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", recordId)
    .eq("organization_id", orgId)
    .eq("version", expectedVersion)
    .is("deleted_at", null)
    .select("id, version")
    .maybeSingle();

  if (error) {
    throw new AppError(500, "The write could not be completed.", error.message);
  }
  if (!updated) {
    throw concurrencyError();
  }

  return { id: updated.id as string, version: updated.version as number };
}

async function deleteRecord(
  identity: MutateIdentity,
  opts: MutateOptions,
): Promise<MutateResult> {
  const { client, actorId, orgId } = identity;
  const { recordId, expectedVersion } = requireVersioned(opts);

  const { data: deleted, error } = await client
    .from("records")
    .update({
      deleted_at: new Date().toISOString(),
      actor_id: actorId,
      version: expectedVersion + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", recordId)
    .eq("organization_id", orgId)
    .eq("version", expectedVersion)
    .is("deleted_at", null)
    .select("id, version")
    .maybeSingle();

  if (error) {
    throw new AppError(500, "The write could not be completed.", error.message);
  }
  if (!deleted) {
    throw concurrencyError();
  }

  return { id: deleted.id as string, version: deleted.version as number };
}

function requireVersioned(opts: MutateOptions): {
  recordId: string;
  expectedVersion: number;
} {
  if (!opts.recordId) {
    throw new AppError(400, "A record id is required for this operation.");
  }
  if (typeof opts.expectedVersion !== "number") {
    throw new AppError(400, "An expected version is required for this operation.");
  }
  return { recordId: opts.recordId, expectedVersion: opts.expectedVersion };
}

/** 409-style optimistic-concurrency error: the caller must re-read and retry. */
function concurrencyError(): AppError {
  return new AppError(
    409,
    "This record changed since you loaded it. Please refresh and try again.",
  );
}

function isUniqueViolation(code: string | undefined): boolean {
  return code === "23505";
}
