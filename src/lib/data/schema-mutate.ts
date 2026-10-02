import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { ViewDefinition } from "@/types/db";
import { getSchema } from "@/lib/data/records";
import {
  addField as addFieldTransform,
  addRelationField as addRelationFieldTransform,
  addTable as addTableTransform,
  addView as addViewTransform,
  removeView as removeViewTransform,
  canHideTable,
  hideField,
  hideTable,
  showField,
  showTable,
} from "@/lib/schema/overrides";
import {
  validateAddField,
  validateAddTable,
  validateAddView,
  validateRelationField,
  type AddFieldInput,
  type AddTableInput,
  type AddViewInput,
} from "@/lib/schema/validator";
import { normalizeTableName } from "@/lib/utils";

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

/**
 * Append an Admin-added single-reference relation field to a table (Story 3.7).
 *
 * Mirrors `setFieldVisibility`'s guarded read-modify-write contract exactly:
 *   - read the org's CURRENT authoritative definition under the RLS client;
 *   - run the focused `validateRelationField` against the stored schema (NOT the
 *     whole-schema generation validator, which strips `hidden`) → 400 on reject,
 *     no write;
 *   - apply the pure `addRelationField` transform (append-only, cardinality
 *     forced to `"one"`);
 *   - write the full definition back under the RLS client (tenant-isolation
 *     policy scopes the UPDATE to the caller's own org).
 *
 * A client can never post an arbitrary schema — the definition is always
 * re-derived from the stored one and only a validated relation field is added.
 * Returns the created field's `{ key, targetTable }`; raw SQL is never leaked.
 */
export async function addRelationField(
  identity: SchemaMutateIdentity,
  tableKey: string,
  input: { label: string; targetTable: string },
): Promise<ApiResponse<{ tableKey: string; fieldKey: string; targetTable: string }>> {
  try {
    const { client, orgId } = identity;

    // 1. Read the org's CURRENT authoritative definition under the RLS client.
    const current = await getSchema(client, orgId);
    if (current.error || !current.data) {
      throw new AppError(500, "writeFailed");
    }
    const schema = current.data;

    // Normalize the incoming table key on read, mirroring the read layer, so an
    // un-normalized key (e.g. "Clients") still matches the stored table key.
    const normalizedTableKey = normalizeTableName(tableKey);

    // 2. Focused validation against the stored schema. A bad target, colliding/
    //    reserved/blocked key, or empty label → 400 with NO write.
    const result = validateRelationField(schema, normalizedTableKey, input);
    if (!result.valid) {
      throw new AppError(400, result.reason);
    }

    // 3. Apply the pure, immutable append (only the target table's fields grow).
    const next = addRelationFieldTransform(schema, normalizedTableKey, result.field);

    // 4. Persist the full definition back under the RLS client.
    const { error } = await client
      .from("org_schemas")
      .update({ definition: next, updated_at: new Date().toISOString() })
      .eq("organization_id", orgId);

    if (error) {
      throw new AppError(500, "writeFailed", error.message);
    }

    return {
      data: {
        tableKey: normalizedTableKey,
        fieldKey: result.field.key,
        targetTable: result.field.relationConfig.targetTable,
      },
      error: null,
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}

/**
 * Append an Admin-added scalar field to a table (Story 5.1 — add a column via
 * chat). Mirrors `addRelationField`'s guarded read-validate-write contract exactly:
 *   - read the org's CURRENT authoritative definition under the RLS client;
 *   - run the focused `validateAddField` against the stored schema (NOT the
 *     whole-schema generation validator, which strips `hidden`) → a validator
 *     rejection is `AppError(400, "addFieldFailed")` with NO write, and is logged
 *     to Sentry with the org id + raw LLM output (the `context` the caller passes);
 *   - apply the pure `addField` transform (append-only; existing `records` rows are
 *     never touched — a new field simply starts absent from existing rows' `data`);
 *   - write the full definition back under the RLS client (tenant-isolation policy
 *     scopes the UPDATE to the caller's own org).
 *
 * A client can never post an arbitrary schema — the definition is always
 * re-derived from the stored one and only a validated scalar field is added.
 * Returns the created field's `{ tableKey, fieldKey }`; raw SQL is never leaked.
 */
export async function addField(
  identity: SchemaMutateIdentity,
  tableKey: string,
  input: AddFieldInput,
  context: { rawOutput?: unknown } = {},
): Promise<ApiResponse<{ tableKey: string; fieldKey: string }>> {
  try {
    const { client, orgId } = identity;

    // 1. Read the org's CURRENT authoritative definition under the RLS client.
    const current = await getSchema(client, orgId);
    if (current.error || !current.data) {
      throw new AppError(500, "writeFailed");
    }
    const schema = current.data;

    // Normalize the incoming table key on read, mirroring the read layer.
    const normalizedTableKey = normalizeTableName(tableKey);

    // 2. Focused validation against the stored schema. A reserved/blocked/
    //    colliding key, non-scalar type, missing label, or unknown/hidden table →
    //    400 with NO write. The rejection is logged with the org id + raw output.
    const result = validateAddField(schema, normalizedTableKey, input, {
      id: orgId,
      rawOutput: context.rawOutput,
    });
    if (!result.valid) {
      throw new AppError(400, result.reason);
    }

    // 3. Apply the pure, immutable append (only the target table's fields grow;
    //    existing records rows are never migrated or mutated).
    const next = addFieldTransform(schema, normalizedTableKey, result.field);

    // 4. Persist the full definition back under the RLS client.
    const { error } = await client
      .from("org_schemas")
      .update({ definition: next, updated_at: new Date().toISOString() })
      .eq("organization_id", orgId);

    if (error) {
      throw new AppError(500, "writeFailed", error.message);
    }

    return {
      data: { tableKey: normalizedTableKey, fieldKey: result.field.key },
      error: null,
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}

/**
 * Append an Admin-added new table to the org schema (Story 5.2 — add a table via
 * chat). Mirrors `addField`'s guarded read-validate-write contract exactly:
 *   - read the org's CURRENT authoritative definition under the RLS client;
 *   - run the focused `validateAddTable` against the stored schema (NOT the
 *     whole-schema generation validator, which strips `hidden`) → a validator
 *     rejection is `AppError(400, "addTableFailed")` with NO write, and is logged
 *     to Sentry with the org id + raw LLM output (the `context` the caller passes).
 *     Collisions with reserved keys or existing tables (visible or hidden) are
 *     disambiguated inside the validator (never overwritten);
 *   - apply the pure `addTable` transform (append-only; existing tables and every
 *     `records` row are untouched — the new table starts with zero rows);
 *   - write the full definition back under the RLS client (tenant-isolation policy
 *     scopes the UPDATE to the caller's own org).
 *
 * A client can never post an arbitrary schema — the definition is always re-derived
 * from the stored one and only a validated table is appended. Returns the created
 * table's `{ tableKey }`; raw SQL is never leaked.
 */
export async function addTable(
  identity: SchemaMutateIdentity,
  input: AddTableInput,
  context: { rawOutput?: unknown } = {},
): Promise<ApiResponse<{ tableKey: string }>> {
  try {
    const { client, orgId } = identity;

    // 1. Read the org's CURRENT authoritative definition under the RLS client.
    const current = await getSchema(client, orgId);
    if (current.error || !current.data) {
      throw new AppError(500, "writeFailed");
    }
    const schema = current.data;

    // 2. Focused validation against the stored schema. A blocked/empty key,
    //    non-scalar field type, or empty table/field label → 400 with NO write.
    //    Reserved/existing-table and duplicate-field collisions are disambiguated.
    //    The rejection is logged with the org id + raw output.
    const result = validateAddTable(schema, input, {
      id: orgId,
      rawOutput: context.rawOutput,
    });
    if (!result.valid) {
      throw new AppError(400, result.reason);
    }

    // 3. Apply the pure, immutable append (only a new table is added; existing
    //    tables and every records row are never migrated or mutated).
    const next = addTableTransform(schema, result.table);

    // 4. Persist the full definition back under the RLS client.
    const { error } = await client
      .from("org_schemas")
      .update({ definition: next, updated_at: new Date().toISOString() })
      .eq("organization_id", orgId);

    if (error) {
      throw new AppError(500, "writeFailed", error.message);
    }

    return { data: { tableKey: result.table.key }, error: null };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}

/**
 * Append an Admin-created view to the org schema (Story 5.3 — create a view via
 * chat). Mirrors `addTable`'s guarded read-validate-write contract exactly:
 *   - read the org's CURRENT authoritative definition under the RLS client;
 *   - run the focused `validateAddView` against the stored schema → a validator
 *     rejection is `AppError(400, "addViewFailed")` with NO write, and is logged to
 *     Sentry with the org id + raw LLM output (the `context` the caller passes).
 *     Collisions with reserved keys, existing tables, or existing views are
 *     disambiguated inside the validator (never overwritten);
 *   - apply the pure `addView` transform (append-only presentation metadata; every
 *     table and `records` row is untouched — a view renders live source rows);
 *   - write the full definition back under the RLS client (tenant-isolation policy
 *     scopes the UPDATE to the caller's own org).
 *
 * A client can never post an arbitrary schema — the definition is always re-derived
 * from the stored one and only a validated view is appended. Returns the created
 * view's `{ viewKey }`; raw SQL is never leaked.
 */
export async function addView(
  identity: SchemaMutateIdentity,
  input: AddViewInput,
  context: { rawOutput?: unknown } = {},
): Promise<ApiResponse<{ viewKey: string }>> {
  try {
    const { client, orgId } = identity;

    // 1. Read the org's CURRENT authoritative definition under the RLS client.
    const current = await getSchema(client, orgId);
    if (current.error || !current.data) {
      throw new AppError(500, "writeFailed");
    }
    const schema = current.data;

    // 2. Focused validation against the stored schema. An unknown/hidden source
    //    table, blocked/empty key, bad filter field/operator/value, bad sort, or a
    //    degenerate (no filter + no sort) view → 400 with NO write. Reserved/
    //    existing-table/existing-view key collisions are disambiguated. The
    //    rejection is logged with the org id + raw output.
    const result = validateAddView(schema, input, {
      id: orgId,
      rawOutput: context.rawOutput,
    });
    if (!result.valid) {
      throw new AppError(400, result.reason);
    }

    // 3. Apply the pure, immutable append (only a new view is added; every table
    //    and records row is never migrated or mutated).
    const next = addViewTransform(schema, result.view);

    // 4. Persist the full definition back under the RLS client.
    const { error } = await client
      .from("org_schemas")
      .update({ definition: next, updated_at: new Date().toISOString() })
      .eq("organization_id", orgId);

    if (error) {
      throw new AppError(500, "writeFailed", error.message);
    }

    return { data: { viewKey: result.view.key }, error: null };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}

/**
 * Remove an Admin-named view from the org schema (Story 5.6 — remove a view via
 * chat, and the tab-surface "Remove view" control). Mirrors `addView`'s guarded
 * read-validate-write contract:
 *   - read the org's CURRENT authoritative definition under the RLS client;
 *   - a missing/empty `viewKey`, or a `viewKey` that resolves to no stored view,
 *     is `AppError(400, "removeViewFailed")` with NO write — the server never
 *     trusts a client-supplied key and never removes a view that is not there;
 *   - apply the pure `removeView` transform (true removal — a view holds no rows,
 *     so no `records` row is ever touched; every table is untouched);
 *   - write the full definition back under the RLS client (tenant-isolation policy
 *     scopes the UPDATE to the caller's own org).
 *
 * A client can never post an arbitrary schema — the definition is always
 * re-derived from the stored one and only an EXISTING view is removed. Returns the
 * REMOVED `ViewDefinition` so a restore/Undo can re-add it unchanged through
 * `addView` (the freed key re-derives identically). Raw SQL is never leaked.
 */
export async function removeView(
  identity: SchemaMutateIdentity,
  viewKey: string,
): Promise<ApiResponse<{ view: ViewDefinition }>> {
  try {
    const { client, orgId } = identity;

    // 1. Read the org's CURRENT authoritative definition under the RLS client.
    const current = await getSchema(client, orgId);
    if (current.error || !current.data) {
      throw new AppError(500, "writeFailed");
    }
    const schema = current.data;

    // 2. Verify the targeted view actually exists. A missing/empty key, or a key
    //    that names no stored view, is a 400 with NO write — the server never
    //    trusts a client-supplied identifier and never removes a phantom view.
    const key = typeof viewKey === "string" ? viewKey.trim() : "";
    const removed = (schema.views ?? []).find((view) => view.key === key);
    if (!key || !removed) {
      throw new AppError(400, "removeViewFailed");
    }

    // 3. Apply the pure, immutable transform (only the one view is dropped; every
    //    table and every records row is untouched).
    const next = removeViewTransform(schema, key);

    // 4. Persist the full definition back under the RLS client.
    const { error } = await client
      .from("org_schemas")
      .update({ definition: next, updated_at: new Date().toISOString() })
      .eq("organization_id", orgId);

    if (error) {
      throw new AppError(500, "writeFailed", error.message);
    }

    return { data: { view: removed }, error: null };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}

/**
 * Set a whole table's visibility for the org (append-only table-level `hidden`
 * flag) — the persisted mutator behind Story 5.7's "hide a table" (in place of
 * delete) and its restore. Mirrors `setFieldVisibility`'s guarded read-verify-
 * transform-write contract exactly, at the table grain:
 *   - read the org's CURRENT authoritative definition under the RLS client;
 *   - verify the `tableKey` actually exists → `AppError(400)` with NO write (the
 *     server never trusts a client-supplied identifier);
 *   - when HIDING, re-check `canHideTable` (the real guard, not only the offer-time
 *     check): hiding the LAST visible table would empty the dashboard, so it is
 *     `AppError(400, "tableHideLast")` with NO write;
 *   - apply the pure `hideTable`/`showTable` transform (append-only flag);
 *   - write the full definition back under the RLS client (tenant-isolation policy
 *     scopes the UPDATE to the caller's own org).
 *
 * A client can never post an arbitrary schema — the definition is always re-derived
 * from the stored one. The change is non-destructive and fully reversible: the table
 * definition and every `records.data` row are preserved and simply drop out of /
 * reappear in the existing `!hidden` render filters. Returns `{ tableKey, hidden }`;
 * raw SQL is never leaked.
 */
export async function setTableVisibility(
  identity: SchemaMutateIdentity,
  tableKey: string,
  hidden: boolean,
): Promise<ApiResponse<{ tableKey: string; hidden: boolean }>> {
  try {
    const { client, orgId } = identity;

    // 1. Read the org's CURRENT authoritative definition under the RLS client.
    const current = await getSchema(client, orgId);
    if (current.error || !current.data) {
      throw new AppError(500, "writeFailed");
    }
    const schema = current.data;

    // 2. Verify the targeted table actually exists. A body referencing a missing
    //    table is a 400 with no write — the server never trusts a client key.
    const table = schema.tables.find((t) => t.key === tableKey);
    if (!table) {
      throw new AppError(400, "genericError");
    }

    // 2b. When hiding, re-check the "never empty the dashboard" guard HERE (the
    //     real backstop, not only the offer-time check): hiding the last visible
    //     table is refused with a reassuring, translatable code and NO write.
    if (hidden && !canHideTable(schema)) {
      throw new AppError(400, "tableHideLast");
    }

    // 3. Apply the pure, immutable transform (only the `hidden` flag changes;
    //    every `records` row is retained).
    const next = hidden
      ? hideTable(schema, tableKey)
      : showTable(schema, tableKey);

    // 4. Persist the full definition back under the RLS client. RLS + the
    //    tenant-isolation policy scope the UPDATE to the caller's own org.
    const { error } = await client
      .from("org_schemas")
      .update({ definition: next, updated_at: new Date().toISOString() })
      .eq("organization_id", orgId);

    if (error) {
      throw new AppError(500, "writeFailed", error.message);
    }

    return { data: { tableKey, hidden }, error: null };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}
