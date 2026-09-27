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
 *   - rejects a normalized key that is, as a whole word, a blocked SQL verb
 *     (`BLOCKED_KEYWORDS`); labels are NOT keyword-checked — they are stored as
 *     inert, auto-escaped JSONB text and never concatenated into SQL, so a
 *     substring match there only false-rejects legitimate business vocabulary
 *     (e.g. "Deleted?", "Grants", "Drop-off time"). See Story 2.5 / retro F7;
 *   - accepts a `relation` field ONLY on the strict-JSON generation path (Story
 *     1.8): its `relationConfig.targetTable` must resolve to a table key in the
 *     SAME batch (a two-pass check — collect all table keys first, then validate
 *     targets); self-reference and cycles are legal. It rejects `cardinality:
 *     'many'` and any non-`llm` source unless `phase === 'growth'`. Any type
 *     outside the MVP set (plus `relation`) is still rejected;
 *   - accepts a table `displayField` only when it names a non-hidden field of
 *     that table; a missing/hidden target is rejected, and an absent
 *     `displayField` is left unset (provisioning defaults it);
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

/**
 * Blocked SQL verbs, matched as whole words against the *normalized* key only.
 *
 * The old punctuation entries (`--`, `;`, `/*`) are intentionally gone: keys are
 * normalized to `[a-z0-9_]` by `normalizeTableName`, so punctuation can never
 * survive into a key, and labels are no longer keyword-checked at all. What
 * remains is a whole-word guard so a bare reserved verb used as a standalone key
 * (`drop`, `delete`) still rejects, while `dropoff` / `backdrop` do not.
 */
export const BLOCKED_KEYWORDS = [
  "DROP",
  "GRANT",
  "TRUNCATE",
  "DELETE",
  "EXEC",
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
  /**
   * The lifecycle phase (Story 1.8). `'generation'` (default) is the anonymous
   * strict-JSON generation path: single-reference relations only. `'growth'`
   * (Epic 9) unlocks `cardinality:'many'` and the editor `source`.
   */
  phase?: "generation" | "growth";
  /**
   * Who proposed the schema (Story 1.8). `'llm'` (default) is the strict-JSON
   * generation path — the only path that may emit relations at MVP. A `'ui'`
   * (editor-created) relation is rejected unless `phase === 'growth'`.
   */
  source?: "llm" | "ui";
};

/**
 * Whole-word match of a blocked SQL verb against a normalized key. Because the
 * key is already `[a-z0-9_]`, and `_` is a regex word char, `\b`-boundaries make
 * `drop` (bare) match while `dropoff` / `drop_off` / `backdrop` do not.
 */
const BLOCKED_KEYWORD_RE = new RegExp(
  `\\b(${BLOCKED_KEYWORDS.join("|")})\\b`,
  "i",
);

function keyIsBlockedVerb(normalizedKey: string): boolean {
  return BLOCKED_KEYWORD_RE.test(normalizedKey);
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

  const phase = context.phase ?? "generation";
  const source = context.source ?? "llm";
  // A relation is accepted at MVP only on the strict-JSON generation path (an
  // `llm` source in the `generation` phase). `cardinality:'many'` and the
  // editor `ui` source unlock only at `phase === 'growth'` (Epic 9).
  const relationsAllowed = source === "llm" || phase === "growth";
  const manyAllowed = phase === "growth";
  const uiSourceAllowed = phase === "growth";

  // Pass 1 — collect + validate every table key, so relation targets can be
  // resolved against the FULL batch regardless of declaration order (two-pass).
  const seenTableKeys = new Set<string>();
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
    const tableKey = normalizeTableName(String(t.key));
    if (!tableKey) {
      return reject(genericError, `table key normalized to empty: "${String(t.key)}"`);
    }
    if (keyIsBlockedVerb(tableKey)) {
      return reject(genericError, `table key is a blocked SQL verb: "${tableKey}"`);
    }
    if (RESERVED_KEYS.includes(tableKey)) {
      return reject(genericError, `table key collides with reserved key: "${tableKey}"`);
    }
    if (seenTableKeys.has(tableKey)) {
      return reject(genericError, `duplicate table key: "${tableKey}"`);
    }
    seenTableKeys.add(tableKey);
  }

  // Pass 2 — validate + sanitize fields (including relation targets against the
  // batch keys collected above) and the table `displayField`.
  const sanitizedTables: TableDefinition[] = [];

  for (const table of tables) {
    const t = table as Record<string, unknown>;
    const tableKey = normalizeTableName(String(t.key));

    const rawFields = t.fields;
    if (!Array.isArray(rawFields) || rawFields.length === 0) {
      return reject(genericError, `table "${tableKey}" has no fields`);
    }

    const seenFieldKeys = new Set<string>();
    // Track which normalized field keys arrived hidden — `hidden` is stripped
    // from the sanitized fields (generation output is never hidden), so the
    // displayField check below reads this to reject a hidden-named display label.
    const hiddenFieldKeys = new Set<string>();
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
      const type = f.type;
      // A `relation` is now accepted (gated below); anything outside the MVP
      // set plus `relation` is still rejected.
      const isSupported =
        type === "relation" ||
        (typeof type === "string" &&
          (GENERATION_FIELD_TYPES as readonly string[]).includes(type));
      if (typeof type !== "string" || !isSupported) {
        return reject(
          genericError,
          `field "${String(f.key)}" has an unsupported type: "${String(type)}"`,
        );
      }

      const fieldKey = normalizeTableName(String(f.key));
      if (!fieldKey) {
        return reject(genericError, `field key normalized to empty: "${String(f.key)}"`);
      }
      if (keyIsBlockedVerb(fieldKey)) {
        return reject(genericError, `field key is a blocked SQL verb: "${fieldKey}"`);
      }
      if (RESERVED_KEYS.includes(fieldKey)) {
        return reject(genericError, `field key collides with reserved key: "${fieldKey}"`);
      }
      if (seenFieldKeys.has(fieldKey)) {
        return reject(genericError, `duplicate field key in "${tableKey}": "${fieldKey}"`);
      }
      seenFieldKeys.add(fieldKey);
      if (f.hidden === true) {
        hiddenFieldKeys.add(fieldKey);
      }

      const sanitizedField: FieldDefinition = {
        key: fieldKey,
        label: f.label.trim(),
        type: type as FieldDefinition["type"],
      };

      // Relation gate (Story 1.8). Accept only when the source/phase allow it,
      // the target resolves within the batch, and the cardinality is permitted.
      if (type === "relation") {
        if (!relationsAllowed || (source === "ui" && !uiSourceAllowed)) {
          return reject(
            genericError,
            `relation field "${fieldKey}" not allowed for source "${source}" in phase "${phase}"`,
          );
        }
        const cfg = f.relationConfig;
        if (!cfg || typeof cfg !== "object") {
          return reject(
            genericError,
            `relation field "${fieldKey}" is missing relationConfig`,
          );
        }
        const rc = cfg as Record<string, unknown>;
        if (!isNonEmptyString(rc.targetTable)) {
          return reject(
            genericError,
            `relation field "${fieldKey}" is missing relationConfig.targetTable`,
          );
        }
        const targetTable = normalizeTableName(String(rc.targetTable));
        if (!seenTableKeys.has(targetTable)) {
          return reject(
            genericError,
            `relation field "${fieldKey}" targets an unknown table: "${String(rc.targetTable)}"`,
          );
        }
        const cardinality = rc.cardinality;
        if (cardinality === "many") {
          if (!manyAllowed) {
            return reject(
              genericError,
              `relation field "${fieldKey}" uses cardinality:'many' outside phase 'growth'`,
            );
          }
        } else if (cardinality !== undefined && cardinality !== "one") {
          return reject(
            genericError,
            `relation field "${fieldKey}" has an invalid cardinality: "${String(cardinality)}"`,
          );
        }
        sanitizedField.relationConfig = {
          targetTable,
          cardinality: cardinality === "many" ? "many" : "one",
        };
      }

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
      // Pass 1 already confirmed `t.label` is a non-empty string.
      label: String(t.label).trim(),
      fields: sanitizedFields,
    };
    if (isNonEmptyString(t.reason)) {
      sanitizedTable.reason = t.reason.trim();
    }

    // Validate `displayField` (Story 1.8): when present it must name a
    // non-hidden, non-relation field of this table. A relation stores a target
    // id (never a label), so it can't be a display label; a missing/hidden/
    // relation target is rejected. An absent displayField is left unset
    // (provisioning defaults it).
    if (t.displayField !== undefined) {
      if (!isNonEmptyString(t.displayField)) {
        return reject(
          genericError,
          `table "${tableKey}" has a non-string displayField`,
        );
      }
      const displayKey = normalizeTableName(String(t.displayField));
      const target = sanitizedFields.find((field) => field.key === displayKey);
      if (!target || hiddenFieldKeys.has(displayKey)) {
        return reject(
          genericError,
          `table "${tableKey}" displayField "${String(t.displayField)}" is not a visible field`,
        );
      }
      if (target.type === "relation") {
        return reject(
          genericError,
          `table "${tableKey}" displayField "${String(t.displayField)}" is a relation field, which cannot be a display label`,
        );
      }
      sanitizedTable.displayField = displayKey;
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
