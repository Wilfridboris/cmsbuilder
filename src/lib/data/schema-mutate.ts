import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { SchemaDefinition, ViewDefinition } from "@/types/db";
import { getSchema } from "@/lib/data/records";
import {
  addField as addFieldTransform,
  addRelationField as addRelationFieldTransform,
  addSelectOption as addSelectOptionTransform,
  addTable as addTableTransform,
  addView as addViewTransform,
  archiveSelectOption as archiveSelectOptionTransform,
  removeView as removeViewTransform,
  renameSelectOption as renameSelectOptionTransform,
  canHideTable,
  hideField,
  hideTable,
  showField,
  showTable,
} from "@/lib/schema/overrides";
import {
  validateAddField,
  validateAddSelectOption,
  validateAddTable,
  validateAddView,
  validateArchiveSelectOption,
  validateRelationField,
  validateRenameSelectOption,
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
 * Every mutator shares one read-validate-transform-write-catch shape, owned by
 * `withSchemaWrite` below:
 *   - read the org's CURRENT definition server-side (`getSchema`);
 *   - validate/transform the stored definition (pure, synchronous) → a bad
 *     target is `AppError(400, ...)` with NO write;
 *   - write the full definition back under the RLS client.
 *
 * A client can therefore never post an arbitrary schema — the definition is
 * always re-derived from the stored one. The changes are non-destructive and
 * fully reversible: field/table definitions and every `records.data` value are
 * preserved and simply drop out of / reappear in the existing `!hidden` render
 * filters.
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
 * The guarded read-modify-write skeleton every schema mutator shares:
 *   1. read the org's CURRENT authoritative definition under the RLS client
 *      (a read failure is `AppError(500, "writeFailed")`, no detail leaked);
 *   2. hand the stored definition to the caller's pure `compute`, which
 *      validates + transforms it and returns the full `next` definition plus the
 *      mutator's result value — `compute` throws `AppError(400, ...)` with NO
 *      write for any rejected/missing target;
 *   3. persist the full definition back under the RLS client — RLS + the
 *      tenant-isolation policy scope the UPDATE to the caller's own org;
 *   4. any non-`AppError` is wrapped as `AppError(500, "writeFailed")` so raw
 *      SQL / driver detail is never leaked to the caller.
 *
 * Because `next` is always re-derived from the stored definition, a client can
 * never post an arbitrary schema.
 */
async function withSchemaWrite<T>(
  identity: SchemaMutateIdentity,
  compute: (schema: SchemaDefinition) => { next: SchemaDefinition; result: T },
): Promise<ApiResponse<T>> {
  try {
    const { client, orgId } = identity;

    // 1. Read the org's CURRENT authoritative definition under the RLS client.
    const current = await getSchema(client, orgId);
    if (current.error || !current.data) {
      throw new AppError(500, "writeFailed");
    }

    // 2. Validate + transform the stored definition (pure, synchronous). A bad
    //    target throws AppError(400, ...) with NO write.
    const { next, result } = compute(current.data);

    // 3. Persist the full definition back under the RLS client. RLS + the
    //    tenant-isolation policy scope the UPDATE to the caller's own org.
    const { error } = await client
      .from("org_schemas")
      .update({ definition: next, updated_at: new Date().toISOString() })
      .eq("organization_id", orgId);

    if (error) {
      throw new AppError(500, "writeFailed", error.message);
    }

    return { data: result, error: null };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}

/**
 * Set a single field's visibility for the whole org (append-only `hidden` flag).
 * Returns the persisted `{ tableKey, fieldKey, hidden }` in the `ApiResponse`
 * envelope; raw SQL is never leaked. Verifies the targeted table + field exist
 * (400 with no write otherwise) — the server never trusts a client-supplied
 * identifier.
 */
export async function setFieldVisibility(
  identity: SchemaMutateIdentity,
  tableKey: string,
  fieldKey: string,
  hidden: boolean,
): Promise<ApiResponse<{ tableKey: string; fieldKey: string; hidden: boolean }>> {
  return withSchemaWrite(identity, (schema) => {
    const table = schema.tables.find((t) => t.key === tableKey);
    const field = table?.fields.find((f) => f.key === fieldKey);
    if (!table || !field) {
      throw new AppError(400, "genericError");
    }

    const next = hidden
      ? hideField(schema, tableKey, fieldKey)
      : showField(schema, tableKey, fieldKey);

    return { next, result: { tableKey, fieldKey, hidden } };
  });
}

/**
 * Append an Admin-added single-reference relation field to a table (Story 3.7).
 * Runs the focused `validateRelationField` against the stored schema (NOT the
 * whole-schema generation validator, which strips `hidden`) → 400 on reject, no
 * write; then the pure `addRelationField` transform (append-only, cardinality
 * forced to `"one"`). Returns the created field's `{ tableKey, fieldKey,
 * targetTable }`; raw SQL is never leaked.
 */
export async function addRelationField(
  identity: SchemaMutateIdentity,
  tableKey: string,
  input: { label: string; targetTable: string },
): Promise<ApiResponse<{ tableKey: string; fieldKey: string; targetTable: string }>> {
  return withSchemaWrite(identity, (schema) => {
    // Normalize the incoming table key on read, mirroring the read layer, so an
    // un-normalized key (e.g. "Clients") still matches the stored table key.
    const normalizedTableKey = normalizeTableName(tableKey);

    // Focused validation against the stored schema. A bad target, colliding/
    // reserved/blocked key, or empty label → 400 with NO write.
    const result = validateRelationField(schema, normalizedTableKey, input);
    if (!result.valid) {
      throw new AppError(400, result.reason);
    }

    const next = addRelationFieldTransform(schema, normalizedTableKey, result.field);

    return {
      next,
      result: {
        tableKey: normalizedTableKey,
        fieldKey: result.field.key,
        targetTable: result.field.relationConfig.targetTable,
      },
    };
  });
}

/**
 * Append an Admin-added scalar field to a table (Story 5.1 — add a column via
 * chat). Runs the focused `validateAddField` against the stored schema → a
 * rejection is `AppError(400, "addFieldFailed")` with NO write, logged to Sentry
 * with the org id + raw LLM output (the `context` the caller passes); then the
 * pure `addField` transform (append-only; existing `records` rows are never
 * touched — a new field simply starts absent from existing rows' `data`).
 * Returns the created field's `{ tableKey, fieldKey }`; raw SQL is never leaked.
 */
export async function addField(
  identity: SchemaMutateIdentity,
  tableKey: string,
  input: AddFieldInput,
  context: { rawOutput?: unknown } = {},
): Promise<ApiResponse<{ tableKey: string; fieldKey: string }>> {
  return withSchemaWrite(identity, (schema) => {
    // Normalize the incoming table key on read, mirroring the read layer.
    const normalizedTableKey = normalizeTableName(tableKey);

    // Focused validation against the stored schema. A reserved/blocked/colliding
    // key, non-scalar type, missing label, or unknown/hidden table → 400 with NO
    // write. The rejection is logged with the org id + raw output.
    const result = validateAddField(schema, normalizedTableKey, input, {
      id: identity.orgId,
      rawOutput: context.rawOutput,
    });
    if (!result.valid) {
      throw new AppError(400, result.reason);
    }

    const next = addFieldTransform(schema, normalizedTableKey, result.field);

    return {
      next,
      result: { tableKey: normalizedTableKey, fieldKey: result.field.key },
    };
  });
}

/**
 * Append an Admin-added new table to the org schema (Story 5.2 — add a table via
 * chat). Runs the focused `validateAddTable` against the stored schema → a
 * rejection is `AppError(400, "addTableFailed")` with NO write, logged with the
 * org id + raw LLM output. Collisions with reserved keys or existing tables
 * (visible or hidden) are disambiguated inside the validator (never
 * overwritten); then the pure `addTable` transform (append-only; existing tables
 * and every `records` row are untouched — the new table starts with zero rows).
 * Returns the created table's `{ tableKey }`; raw SQL is never leaked.
 */
export async function addTable(
  identity: SchemaMutateIdentity,
  input: AddTableInput,
  context: { rawOutput?: unknown } = {},
): Promise<ApiResponse<{ tableKey: string }>> {
  return withSchemaWrite(identity, (schema) => {
    // Focused validation against the stored schema. A blocked/empty key,
    // non-scalar field type, or empty table/field label → 400 with NO write.
    // Reserved/existing-table and duplicate-field collisions are disambiguated.
    // The rejection is logged with the org id + raw output.
    const result = validateAddTable(schema, input, {
      id: identity.orgId,
      rawOutput: context.rawOutput,
    });
    if (!result.valid) {
      throw new AppError(400, result.reason);
    }

    const next = addTableTransform(schema, result.table);

    return { next, result: { tableKey: result.table.key } };
  });
}

/**
 * Append an Admin-created view to the org schema (Story 5.3 — create a view via
 * chat). Runs the focused `validateAddView` against the stored schema → a
 * rejection is `AppError(400, "addViewFailed")` with NO write, logged with the
 * org id + raw LLM output. Collisions with reserved keys, existing tables, or
 * existing views are disambiguated inside the validator (never overwritten);
 * then the pure `addView` transform (append-only presentation metadata; every
 * table and `records` row is untouched — a view renders live source rows).
 * Returns the created view's `{ viewKey }`; raw SQL is never leaked.
 */
export async function addView(
  identity: SchemaMutateIdentity,
  input: AddViewInput,
  context: { rawOutput?: unknown } = {},
): Promise<ApiResponse<{ viewKey: string }>> {
  return withSchemaWrite(identity, (schema) => {
    // Focused validation against the stored schema. An unknown/hidden source
    // table, blocked/empty key, bad filter field/operator/value, bad sort, or a
    // degenerate (no filter + no sort) view → 400 with NO write. Reserved/
    // existing-table/existing-view key collisions are disambiguated. The
    // rejection is logged with the org id + raw output.
    const result = validateAddView(schema, input, {
      id: identity.orgId,
      rawOutput: context.rawOutput,
    });
    if (!result.valid) {
      throw new AppError(400, result.reason);
    }

    const next = addViewTransform(schema, result.view);

    return { next, result: { viewKey: result.view.key } };
  });
}

/**
 * Remove an Admin-named view from the org schema (Story 5.6 — remove a view via
 * chat, and the tab-surface "Remove view" control). A missing/empty `viewKey`,
 * or a `viewKey` that resolves to no stored view, is `AppError(400,
 * "removeViewFailed")` with NO write — the server never trusts a client-supplied
 * key and never removes a view that is not there. Applies the pure `removeView`
 * transform (true removal — a view holds no rows, so no `records` row is ever
 * touched; every table is untouched). Returns the REMOVED `ViewDefinition` so a
 * restore/Undo can re-add it unchanged through `addView` (the freed key
 * re-derives identically). Raw SQL is never leaked.
 */
export async function removeView(
  identity: SchemaMutateIdentity,
  viewKey: string,
): Promise<ApiResponse<{ view: ViewDefinition }>> {
  return withSchemaWrite(identity, (schema) => {
    // Verify the targeted view actually exists. A missing/empty key, or a key
    // that names no stored view, is a 400 with NO write.
    const key = typeof viewKey === "string" ? viewKey.trim() : "";
    const removed = (schema.views ?? []).find((view) => view.key === key);
    if (!key || !removed) {
      throw new AppError(400, "removeViewFailed");
    }

    const next = removeViewTransform(schema, key);

    return { next, result: { view: removed } };
  });
}

/**
 * Set a whole table's visibility for the org (append-only table-level `hidden`
 * flag) — the persisted mutator behind Story 5.7's "hide a table" (in place of
 * delete) and its restore. Verifies the `tableKey` exists → `AppError(400)` with
 * NO write; when HIDING, re-checks `canHideTable` (the real guard, not only the
 * offer-time check): hiding the LAST visible table would empty the dashboard, so
 * it is `AppError(400, "tableHideLast")` with NO write. Applies the pure
 * `hideTable`/`showTable` transform (append-only flag; every `records` row is
 * retained). Returns `{ tableKey, hidden }`; raw SQL is never leaked.
 */
export async function setTableVisibility(
  identity: SchemaMutateIdentity,
  tableKey: string,
  hidden: boolean,
): Promise<ApiResponse<{ tableKey: string; hidden: boolean }>> {
  return withSchemaWrite(identity, (schema) => {
    // Verify the targeted table actually exists. A body referencing a missing
    // table is a 400 with no write — the server never trusts a client key.
    const table = schema.tables.find((t) => t.key === tableKey);
    if (!table) {
      throw new AppError(400, "genericError");
    }

    // When hiding, re-check the "never empty the dashboard" guard HERE (the real
    // backstop, not only the offer-time check): hiding the last visible table is
    // refused with a reassuring, translatable code and NO write.
    if (hidden && !canHideTable(schema)) {
      throw new AppError(400, "tableHideLast");
    }

    const next = hidden
      ? hideTable(schema, tableKey)
      : showTable(schema, tableKey);

    return { next, result: { tableKey, hidden } };
  });
}

/**
 * Append a new option to an existing `select` field (Story 13.4 —
 * `add_select_option`). Runs the focused `validateAddSelectOption` against the
 * stored schema → a rejection is `AppError(400, "selectOptionOpFailed")` with NO
 * write, logged with the org id + raw LLM output; then the pure `addSelectOption`
 * transform (append-only; existing options and every `records` row are untouched).
 * Returns the created option's `{ tableKey, fieldKey, value, label }`; raw SQL is
 * never leaked.
 */
export async function addSelectOption(
  identity: SchemaMutateIdentity,
  tableKey: string,
  fieldKey: string,
  input: { label: string },
  context: { rawOutput?: unknown } = {},
): Promise<
  ApiResponse<{ tableKey: string; fieldKey: string; value: string; label: string }>
> {
  return withSchemaWrite(identity, (schema) => {
    const normalizedTableKey = normalizeTableName(tableKey);
    // Normalize the incoming field key on read, mirroring the table key and the
    // add-field path, so a non-normalized key (e.g. "Status") both validates AND
    // matches the stored field in the transform (never a validate-then-no-op).
    const normalizedFieldKey = normalizeTableName(fieldKey);

    const result = validateAddSelectOption(
      schema,
      normalizedTableKey,
      normalizedFieldKey,
      input,
      { id: identity.orgId, rawOutput: context.rawOutput },
    );
    if (!result.valid) {
      throw new AppError(400, result.reason);
    }

    const next = addSelectOptionTransform(
      schema,
      normalizedTableKey,
      normalizedFieldKey,
      result.option,
    );

    return {
      next,
      result: {
        tableKey: normalizedTableKey,
        fieldKey: normalizedFieldKey,
        value: result.option.value,
        label: result.option.label,
      },
    };
  });
}

/**
 * Rename an existing `select` option's LABEL only (Story 13.4 —
 * `rename_select_option`). Runs the focused `validateRenameSelectOption` against
 * the stored schema → a rejection is `AppError(400, "selectOptionOpFailed")` with
 * NO write, logged with the org id + raw LLM output; then the pure
 * `renameSelectOption` transform (the stored `value` is never changed, so existing
 * records are untouched). Returns `{ tableKey, fieldKey, value, label }`; raw SQL
 * is never leaked.
 */
export async function renameSelectOption(
  identity: SchemaMutateIdentity,
  tableKey: string,
  fieldKey: string,
  input: { value: string; label: string },
  context: { rawOutput?: unknown } = {},
): Promise<
  ApiResponse<{ tableKey: string; fieldKey: string; value: string; label: string }>
> {
  return withSchemaWrite(identity, (schema) => {
    const normalizedTableKey = normalizeTableName(tableKey);
    const normalizedFieldKey = normalizeTableName(fieldKey);

    const result = validateRenameSelectOption(
      schema,
      normalizedTableKey,
      normalizedFieldKey,
      input,
      { id: identity.orgId, rawOutput: context.rawOutput },
    );
    if (!result.valid) {
      throw new AppError(400, result.reason);
    }

    const next = renameSelectOptionTransform(
      schema,
      normalizedTableKey,
      normalizedFieldKey,
      result.value,
      result.label,
    );

    return {
      next,
      result: {
        tableKey: normalizedTableKey,
        fieldKey: normalizedFieldKey,
        value: result.value,
        label: result.label,
      },
    };
  });
}

/**
 * Archive (soft-hide) an existing `select` option (Story 13.4 —
 * `archive_select_option`). Runs the focused `validateArchiveSelectOption` against
 * the stored schema → a rejection is `AppError(400, "selectOptionOpFailed")` with
 * NO write (duplicate/last-active/already-archived/unknown), logged with the org
 * id + raw LLM output; then the pure `archiveSelectOption` transform (sets
 * `archived:true`, never removes the option, so existing records still render its
 * label). Returns `{ tableKey, fieldKey, value }`; raw SQL is never leaked.
 */
export async function archiveSelectOption(
  identity: SchemaMutateIdentity,
  tableKey: string,
  fieldKey: string,
  input: { value: string },
  context: { rawOutput?: unknown } = {},
): Promise<ApiResponse<{ tableKey: string; fieldKey: string; value: string }>> {
  return withSchemaWrite(identity, (schema) => {
    const normalizedTableKey = normalizeTableName(tableKey);
    const normalizedFieldKey = normalizeTableName(fieldKey);

    const result = validateArchiveSelectOption(
      schema,
      normalizedTableKey,
      normalizedFieldKey,
      input,
      { id: identity.orgId, rawOutput: context.rawOutput },
    );
    if (!result.valid) {
      throw new AppError(400, result.reason);
    }

    const next = archiveSelectOptionTransform(
      schema,
      normalizedTableKey,
      normalizedFieldKey,
      result.value,
    );

    return {
      next,
      result: {
        tableKey: normalizedTableKey,
        fieldKey: normalizedFieldKey,
        value: result.value,
      },
    };
  });
}
