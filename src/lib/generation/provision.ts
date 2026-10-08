import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { mutate, type MutateIdentity } from "@/lib/data/mutate";
import { filterSeedRows } from "@/lib/schema/validator";
import {
  displayFieldKey,
  orderTablesByRelations,
  resolveSeedRelationRefs,
} from "@/lib/schema/relations";
import { normalizeTableName } from "@/lib/utils";
import type { SchemaDefinition, TableDefinition } from "@/types/db";

/**
 * Anonymous-generation provisioning (Story 1.4).
 *
 * Mirrors the `/demo` walking-skeleton exactly, but for a per-session org minted
 * at generation time: no `org_members` yet (that is Epic 2 claim), so the row is
 * read back through the admin client scoped to this org id. Writes flow through
 * the guarded `mutate.ts` layer under the bootstrap admin client with a system
 * actor and stable idempotency keys — a single guarded write path, and NO
 * runtime DDL (metadata insert + seed-row inserts only).
 *
 * A malformed `seedRows` section never invalidates the schema: the schema is
 * persisted first, then only well-formed rows (already filtered by
 * `filterSeedRows`) are seeded.
 */

/** System actor for anonymous bootstrap writes (not a real auth user). */
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-0000000000a0";

export type ProvisionInput = {
  /** Existing session org id to reuse (idempotent per session), else a new one is minted. */
  orgId?: string;
  /** The validated, sanitized schema. */
  schema: SchemaDefinition;
  /** Raw `seedRows` map from the LLM (table_key → rows); filtered per table. */
  seedRows: unknown;
  /**
   * Prefix for the per-row idempotency keys (`<prefix>-<table_key>-<i>`).
   * Defaults to `gen-seed` (the real-generation path). The Story 1.5 fallback
   * passes `fallback` so its rows can never collide with a prior real
   * generation's `gen-seed-*` keys when both provision into the SAME reused
   * session org and share a normalized `table_key` (e.g. `clients`).
   */
  idempotencyPrefix?: string;
};

export type ProvisionResult = {
  orgId: string;
  schema: SchemaDefinition;
};

function seedRowsForTable(seedRows: unknown, tableKey: string): unknown {
  if (!seedRows || typeof seedRows !== "object") {
    return undefined;
  }
  const map = seedRows as Record<string, unknown>;
  // Prefer an exact match; fall back to a normalized-key match so a model that
  // keyed seedRows with the raw (un-normalized) table name still lines up with
  // the sanitized `table.key` the schema was persisted under.
  if (tableKey in map) {
    return map[tableKey];
  }
  for (const rawKey of Object.keys(map)) {
    if (normalizeTableName(rawKey) === tableKey) {
      return map[rawKey];
    }
  }
  return undefined;
}

/**
 * Default each table's `displayField` (Story 1.8) when generation omitted it:
 * the first non-hidden `text` field, else the first non-hidden field. A
 * `displayField` the validator already accepted (naming a visible field) is
 * kept as-is. Returns a NEW schema; the input is not mutated.
 */
function withDefaultedDisplayFields(schema: SchemaDefinition): SchemaDefinition {
  return {
    ...schema,
    tables: schema.tables.map((table): TableDefinition => {
      if (table.displayField) {
        return table;
      }
      const defaulted = displayFieldKey(table);
      return defaulted ? { ...table, displayField: defaulted } : table;
    }),
  };
}

/** Mint a fresh anonymous org, or verify/reuse the one the session already has. */
async function resolveOrg(
  admin: SupabaseClient,
  orgId: string | undefined,
): Promise<string> {
  const id = orgId ?? randomUUID();
  const shortId = id.slice(0, 8);
  const { error } = await admin.from("organizations").upsert(
    {
      id,
      name: `Scheza Session ${shortId}`,
      slug: `session-${shortId}`,
    },
    { onConflict: "id" },
  );
  if (error) {
    throw new Error(`Failed to mint session org: ${error.message}`);
  }
  return id;
}

/**
 * Clear a reused session org's prior synthetic reveal rows (Story 15.2).
 *
 * When a session re-generates in the same browser, the org is reused and
 * `upsertSchema` REPLACES the single schema definition — but the prior
 * generation's seed ROWS are still live. `getSchema` returns only the new
 * definition, so a read-back then surfaces stale rows under any table key the
 * two generations share (e.g. `clients`): a mixed, dirty reveal.
 *
 * Fix: before persisting the new schema, HARD-delete every `SYSTEM_ACTOR_ID`
 * row for this org. A hard delete (not the usual soft `deleted_at`) is
 * mandatory because the partial-unique index `records_idempotency_key_idx`
 * (`unique (organization_id, table_key, idempotency_key) where idempotency_key
 * is not null`) still sees a soft-deleted row's `idempotency_key`, so reseeding
 * the same `${prefix}-${table.key}-${i}` key would collide (23505).
 *
 * Scoped to `SYSTEM_ACTOR_ID` ONLY: `INTAKE_ACTOR_ID` intake leads and any
 * claimed org's real rows are never touched. A delete failure throws so the
 * caller surfaces a provisioning error rather than serving a silently-mixed
 * reveal.
 */
async function clearPriorSystemRows(
  admin: SupabaseClient,
  orgId: string,
): Promise<void> {
  const { error } = await admin
    .from("records")
    .delete()
    .eq("organization_id", orgId)
    .eq("actor_id", SYSTEM_ACTOR_ID);
  if (error) {
    throw new Error(`Failed to clear prior session rows: ${error.message}`);
  }
}

async function upsertSchema(
  admin: SupabaseClient,
  orgId: string,
  schema: SchemaDefinition,
): Promise<void> {
  const { error } = await admin.from("org_schemas").upsert(
    {
      organization_id: orgId,
      definition: schema,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  if (error) {
    throw new Error(`Failed to upsert session schema: ${error.message}`);
  }
}

/**
 * Provision a validated generation into a session org: mint/reuse the org, upsert
 * the `org_schemas` definition, then seed 5-8 well-formed rows per table through
 * the guarded write layer with stable idempotency keys (safe to re-run).
 */
export async function provisionGeneration(
  input: ProvisionInput,
  admin: SupabaseClient = createAdminClient(),
): Promise<ProvisionResult> {
  const orgId = await resolveOrg(admin, input.orgId);
  const keyPrefix = input.idempotencyPrefix ?? "gen-seed";

  // Default any omitted `displayField` (Story 1.8) so the persisted schema (and
  // the reveal) always names a canonical label field per table.
  const schema = withDefaultedDisplayFields(input.schema);

  // Reused session org (Story 15.2): hard-delete the prior generation's
  // synthetic rows BEFORE replacing the schema, so the read-back shows ONLY the
  // current generation's tables and rows — never a merge with stale leftovers.
  // A fresh org (no `input.orgId`) has nothing to clear, so we skip the query.
  if (input.orgId) {
    await clearPriorSystemRows(admin, orgId);
  }

  // Persist the schema BEFORE any rows — a bad seed batch must never prevent the
  // visitor from landing on a populated (or at least structured) view.
  await upsertSchema(admin, orgId, schema);

  const identity: MutateIdentity = {
    client: admin,
    actorId: SYSTEM_ACTOR_ID,
    orgId,
  };

  // Insert referenced tables before referencing tables (Story 1.8) so a
  // relation's target rows exist (with ids) before we resolve the referencing
  // rows against them. As each table seeds, record its inserted ids keyed by
  // that table's `displayField` value; later tables' relation seed values are
  // rewritten to those ids via `resolveSeedRelationRefs` before the insert.
  const orderedTables = orderTablesByRelations(schema.tables);
  const insertedIdsByTable = new Map<string, Map<string, string>>();

  for (const table of orderedTables) {
    const filtered = filterSeedRows(
      table,
      seedRowsForTable(input.seedRows, table.key),
    );
    // Rewrite this table's relation cells (display value → target inserted id)
    // using the ids recorded for already-seeded referenced tables.
    const rows = resolveSeedRelationRefs(table, filtered, insertedIdsByTable);

    const displayKey = table.displayField;
    const idsForThisTable = new Map<string, string>();

    for (let i = 0; i < rows.length; i += 1) {
      const result = await mutate(identity, "insert", table.key, rows[i], {
        idempotencyKey: `${keyPrefix}-${table.key}-${i}`,
      });
      // A single bad row must not abort provisioning — skip and continue.
      if (result.error || !result.data) {
        continue;
      }
      // Record this row's inserted id under its display-field value so later
      // tables can resolve relations that reference it. First match wins.
      if (displayKey !== undefined) {
        const displayValue = rows[i][displayKey];
        if (
          displayValue !== undefined &&
          displayValue !== null &&
          String(displayValue).trim() !== ""
        ) {
          const lookup = String(displayValue).trim();
          if (!idsForThisTable.has(lookup)) {
            idsForThisTable.set(lookup, result.data.id);
          }
        }
      }
    }

    insertedIdsByTable.set(table.key, idsForThisTable);
  }

  return { orgId, schema };
}
