import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { mutate, type MutateIdentity } from "@/lib/data/mutate";
import { filterSeedRows } from "@/lib/schema/validator";
import { normalizeTableName } from "@/lib/utils";
import type { SchemaDefinition } from "@/types/db";

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
      name: `SnapBusy Session ${shortId}`,
      slug: `session-${shortId}`,
    },
    { onConflict: "id" },
  );
  if (error) {
    throw new Error(`Failed to mint session org: ${error.message}`);
  }
  return id;
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

  // Persist the schema BEFORE any rows — a bad seed batch must never prevent the
  // visitor from landing on a populated (or at least structured) view.
  await upsertSchema(admin, orgId, input.schema);

  const identity: MutateIdentity = {
    client: admin,
    actorId: SYSTEM_ACTOR_ID,
    orgId,
  };

  for (const table of input.schema.tables) {
    const rows = filterSeedRows(table, seedRowsForTable(input.seedRows, table.key));
    for (let i = 0; i < rows.length; i += 1) {
      const result = await mutate(identity, "insert", table.key, rows[i], {
        idempotencyKey: `gen-seed-${table.key}-${i}`,
      });
      // A single bad row must not abort provisioning — skip and continue.
      if (result.error) {
        continue;
      }
    }
  }

  return { orgId, schema: input.schema };
}
