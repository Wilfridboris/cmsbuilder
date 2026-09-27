import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { FieldDefinition, TableDefinition } from "@/types/db";
import { normalizeTableName } from "@/lib/utils";
import { getSchema } from "@/lib/data/records";

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
          data: await updateRecord(identity, normalizedTableKey, data, opts),
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

  // Referential integrity (Story 3.8): every relation id in the payload must
  // point at a live row under the same org + target table. Rejects foreign,
  // dangling, or wrong-table ids before persisting.
  await assertRelationReferencesExist(identity, tableKey, data);

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
  tableKey: string,
  data: Record<string, unknown>,
  opts: MutateOptions,
): Promise<MutateResult> {
  const { client, actorId, orgId } = identity;
  const { recordId, expectedVersion } = requireVersioned(opts);

  // Referential integrity (Story 3.8): an edit replaces `records.data` wholesale,
  // so every relation id in the merged payload must resolve to a live row under the
  // same org + target table. Rejects foreign / dangling / wrong-table ids first.
  await assertRelationReferencesExist(identity, tableKey, data);

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

/**
 * Referential-integrity guard (Story 3.8, AC5). Loads the table's field
 * definitions from the org schema, collects every non-empty relation id in
 * `data`, and batch-verifies — per target table — that each id exists as a live
 * row (`.in("id", ids)` scoped `org` + `table_key` + `deleted_at IS NULL`). Any
 * id that is missing, soft-deleted, foreign-org (RLS hides it), or in the wrong
 * table fails the check and the whole write is rejected with a 400-class
 * `invalidReference` — the optimistic UI rolls back.
 *
 * A record picker normally only offers valid ids, so this guards API-direct and
 * stale-target writes. It runs under the caller's RLS-scoped client (never the
 * service role), so a cross-org id simply does not come back. A table with no
 * relation fields, or a payload with no relation values, does no work.
 */
async function assertRelationReferencesExist(
  identity: MutateIdentity,
  tableKey: string,
  data: Record<string, unknown>,
): Promise<void> {
  const { client, orgId } = identity;

  const schemaResult = await getSchema(client, orgId);
  if (schemaResult.error || !schemaResult.data) {
    throw new AppError(500, "The write could not be completed.");
  }

  const table: TableDefinition | undefined = schemaResult.data.tables.find(
    (t) => t.key === tableKey,
  );
  // Unknown table (e.g. the delete placeholder key) → nothing to verify. The
  // insert/update itself still fails downstream if the table is truly invalid.
  if (!table) {
    return;
  }

  const relationFields = table.fields.filter(
    (field): field is FieldDefinition & {
      relationConfig: NonNullable<FieldDefinition["relationConfig"]>;
    } => field.type === "relation" && Boolean(field.relationConfig),
  );
  if (relationFields.length === 0) {
    return;
  }

  // Group the referenced ids by target table so each target is verified in ONE
  // batched `.in("id", ids)` query.
  const idsByTarget = new Map<string, Set<string>>();
  for (const field of relationFields) {
    const raw = data[field.key];
    if (raw === undefined || raw === null) {
      continue;
    }
    const id = String(raw).trim();
    if (id === "") {
      continue;
    }
    const target = normalizeTableName(field.relationConfig.targetTable);
    let set = idsByTarget.get(target);
    if (!set) {
      set = new Set<string>();
      idsByTarget.set(target, set);
    }
    set.add(id);
  }

  for (const [targetTable, idSet] of idsByTarget) {
    const ids = Array.from(idSet);
    const { data: rows, error } = await client
      .from("records")
      .select("id")
      .eq("organization_id", orgId)
      .eq("table_key", targetTable)
      .is("deleted_at", null)
      .in("id", ids);

    if (error) {
      throw new AppError(500, "The write could not be completed.", error.message);
    }

    const found = new Set((rows ?? []).map((row) => row.id as string));
    if (found.size !== ids.length) {
      // At least one referenced id does not resolve to a live row under this org
      // and target table — reject the whole write.
      throw new AppError(400, "invalidReference");
    }
  }
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
