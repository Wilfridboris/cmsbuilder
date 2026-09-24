import "server-only";

import type {
  FieldDefinition,
  SchemaDefinition,
  TableDefinition,
} from "@/types/db";
import { GENERATION_FIELD_TYPES } from "@/lib/gemini/prompts";
import { reportRejection } from "@/lib/observability/report";
import { normalizeTableName } from "@/lib/utils";

/**
 * Schema Validator (Story 1.4) — the synchronous pre-persist safety gate.
 *
 * Runs on the LLM's proposed schema BEFORE anything is persisted. In this
 * architecture the LLM emits a JSON metadata shape (never SQL/DDL), so this is
 * structural allowlist validation, not SQL-injection defense — a categorically
 * smaller surface. It:
 *   - accepts only append-only ops (implicitly: only `add_table`/`add_field`
 *     are expressible in the generation shape; no other op can appear);
 *   - rejects reserved-column collisions (`RESERVED_KEYS`);
 *   - rejects any label/key containing a blocked keyword (`BLOCKED_KEYWORDS`,
 *     defense-in-depth on names);
 *   - never accepts the `relation` field type (nor any type outside the MVP set);
 *   - normalizes every `table_key` and field `key` via `normalizeTableName()`;
 *   - logs every rejection through the observability seam with the org/session
 *     id + raw output (FR45).
 *
 * A rejection is total: nothing is partially persisted. (Malformed SEED ROWS are
 * handled separately by `filterSeedRows` — a bad row must not sink a valid
 * schema.)
 */

// Append-only allowlisting is enforced by SHAPE, not by a checked op list: the
// generation contract can only express tables/fields (add_table/add_field), so no
// destructive op is representable in the first place. (No `PERMITTED_OPERATIONS`
// constant — it would imply a runtime check that does not, and need not, exist.)

/** Max seed rows persisted per table — the generation contract promises 5–8. */
export const MAX_SEED_ROWS = 8;

/** Columns owned by the `records`/`org_schemas` model — a field key may not shadow them. */
export const RESERVED_KEYS = [
  "id",
  "organization_id",
  "table_key",
  "data",
  "created_at",
  "updated_at",
  "deleted_at",
];

/** Blocked keywords, checked against raw labels/keys (defense-in-depth). */
export const BLOCKED_KEYWORDS = [
  "DROP",
  "GRANT",
  "TRUNCATE",
  "DELETE",
  "EXEC",
  "--",
  ";",
  "/*",
];

export type ValidationResult =
  | { valid: true; sanitized: SchemaDefinition }
  | { valid: false; error: string };

/** Context threaded into rejection logs (never returned to the client). */
export type ValidationContext = {
  /** Org or anonymous-session id the generation belongs to. */
  id?: string;
  /** The raw LLM output, for debugging a rejection (FR45). */
  rawOutput?: unknown;
};

function containsBlockedKeyword(value: string): boolean {
  const upper = value.toUpperCase();
  return BLOCKED_KEYWORDS.some((kw) => upper.includes(kw.toUpperCase()));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate + sanitize the LLM's proposed schema. On success returns a schema
 * with every `table_key`/field `key` normalized and types confirmed to be in
 * the MVP set (`relation` can never appear). On the first structural problem it
 * rejects, logs, and returns a plain-language error.
 */
export function validateGeneratedSchema(
  raw: unknown,
  context: ValidationContext = {},
): ValidationResult {
  const reject = (error: string, detail: string): ValidationResult => {
    reportRejection(detail, { id: context.id, rawOutput: context.rawOutput });
    return { valid: false, error };
  };

  const genericError =
    "We couldn't build a valid structure from that description. Please try again.";

  // Accept both the raw `{ schema: {...} }` envelope and a bare `{ tables: [] }`.
  const schemaNode =
    raw && typeof raw === "object" && "schema" in raw
      ? (raw as { schema?: unknown }).schema
      : raw;

  if (!schemaNode || typeof schemaNode !== "object") {
    return reject(genericError, "schema node missing or not an object");
  }

  const tables = (schemaNode as { tables?: unknown }).tables;
  if (!Array.isArray(tables) || tables.length === 0) {
    return reject(genericError, "schema.tables missing, not an array, or empty");
  }

  const seenTableKeys = new Set<string>();
  const sanitizedTables: TableDefinition[] = [];

  for (const table of tables) {
    if (!table || typeof table !== "object") {
      return reject(genericError, "a table entry is not an object");
    }
    const t = table as Record<string, unknown>;

    if (!isNonEmptyString(t.label)) {
      return reject(genericError, "a table is missing a label");
    }
    if (!isNonEmptyString(t.key)) {
      return reject(genericError, "a table is missing a key");
    }
    if (containsBlockedKeyword(String(t.key)) || containsBlockedKeyword(t.label)) {
      return reject(genericError, `blocked keyword in table "${t.label}"`);
    }

    const tableKey = normalizeTableName(String(t.key));
    if (!tableKey) {
      return reject(genericError, `table key normalized to empty: "${String(t.key)}"`);
    }
    if (RESERVED_KEYS.includes(tableKey)) {
      return reject(genericError, `table key collides with reserved key: "${tableKey}"`);
    }
    if (seenTableKeys.has(tableKey)) {
      return reject(genericError, `duplicate table key: "${tableKey}"`);
    }
    seenTableKeys.add(tableKey);

    const rawFields = t.fields;
    if (!Array.isArray(rawFields) || rawFields.length === 0) {
      return reject(genericError, `table "${tableKey}" has no fields`);
    }

    const seenFieldKeys = new Set<string>();
    const sanitizedFields: FieldDefinition[] = [];

    for (const field of rawFields) {
      if (!field || typeof field !== "object") {
        return reject(genericError, `a field in "${tableKey}" is not an object`);
      }
      const f = field as Record<string, unknown>;

      if (!isNonEmptyString(f.label)) {
        return reject(genericError, `a field in "${tableKey}" is missing a label`);
      }
      if (!isNonEmptyString(f.key)) {
        return reject(genericError, `a field in "${tableKey}" is missing a key`);
      }
      if (containsBlockedKeyword(String(f.key)) || containsBlockedKeyword(f.label)) {
        return reject(genericError, `blocked keyword in field "${f.label}"`);
      }

      const type = f.type;
      // `relation` (and anything outside the MVP set) is never accepted.
      if (
        typeof type !== "string" ||
        !(GENERATION_FIELD_TYPES as readonly string[]).includes(type)
      ) {
        return reject(
          genericError,
          `field "${String(f.key)}" has an unsupported type: "${String(type)}"`,
        );
      }

      const fieldKey = normalizeTableName(String(f.key));
      if (!fieldKey) {
        return reject(genericError, `field key normalized to empty: "${String(f.key)}"`);
      }
      if (RESERVED_KEYS.includes(fieldKey)) {
        return reject(genericError, `field key collides with reserved key: "${fieldKey}"`);
      }
      if (seenFieldKeys.has(fieldKey)) {
        return reject(genericError, `duplicate field key in "${tableKey}": "${fieldKey}"`);
      }
      seenFieldKeys.add(fieldKey);

      const sanitizedField: FieldDefinition = {
        key: fieldKey,
        label: f.label.trim(),
        type: type as FieldDefinition["type"],
      };
      if (isNonEmptyString(f.reason)) {
        sanitizedField.reason = f.reason.trim();
      }
      if (typeof f.sensitive === "boolean") {
        sanitizedField.sensitive = f.sensitive;
      }
      sanitizedFields.push(sanitizedField);
    }

    const sanitizedTable: TableDefinition = {
      key: tableKey,
      label: t.label.trim(),
      fields: sanitizedFields,
    };
    if (isNonEmptyString(t.reason)) {
      sanitizedTable.reason = t.reason.trim();
    }
    sanitizedTables.push(sanitizedTable);
  }

  return { valid: true, sanitized: { tables: sanitizedTables } };
}

/**
 * Filter the LLM's `seedRows` for a validated table down to well-formed rows.
 * A malformed `seedRows` section must NOT invalidate a valid schema — bad rows
 * are silently dropped (FR: "persist the schema, skip bad rows, proceed").
 *
 * A row is kept when it is a plain object; each cell is projected onto the
 * table's known field keys (extra/unknown keys are ignored, so a stray key can
 * never smuggle a value into `records.data`). Rows with zero recognized fields
 * are dropped.
 */
export function filterSeedRows(
  table: TableDefinition,
  rawRows: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(rawRows)) {
    return [];
  }
  const fieldKeys = table.fields.map((field) => field.key);

  const kept: Array<Record<string, unknown>> = [];
  for (const row of rawRows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const source = row as Record<string, unknown>;
    const projected: Record<string, unknown> = {};
    for (const key of fieldKeys) {
      if (source[key] !== undefined && source[key] !== null) {
        projected[key] = source[key];
      }
    }
    if (Object.keys(projected).length > 0) {
      kept.push(projected);
    }
    // Cap at the contract's upper bound — a model that over-produces must not
    // blow past the <5s provisioning budget with an unbounded insert loop.
    if (kept.length >= MAX_SEED_ROWS) {
      break;
    }
  }
  return kept;
}
