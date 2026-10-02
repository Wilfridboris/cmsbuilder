import "server-only";

import type {
  FieldDefinition,
  FilterOperator,
  FilterState,
  SchemaDefinition,
  SortState,
  TableDefinition,
  ViewDefinition,
} from "@/types/db";
import { GENERATION_FIELD_TYPES } from "@/lib/gemini/prompts";
import { operatorsForType } from "@/lib/data/filter-sort";
import { displayFieldKey } from "@/lib/schema/relations";
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

// --- Conversational editor operation allowlist (Story 5.4, extended 5.5) ----
//
// The GENERATION path enforces append-only by SHAPE (its contract can only
// express tables/fields), but the conversational EDITOR path dispatches on an
// LLM-chosen `kind`, so it gets an EXPLICIT, auditable allowlist seam here — the
// clean fence the epic names as the template for a future real-world action
// allowlist. Anything outside this permitted set is rejected + logged before any
// metadata write. The permitted set is the three additive ops (`add_field`,
// `add_table`, `add_view`) plus `hide_field` (Story 5.5): a "delete/remove a
// column" request is satisfied NON-destructively by hiding that one column via
// the append-only visibility flag — it rides the SAME fence rather than being
// exempted, so one uniform allowlist + raw-SQL discard covers every operation the
// model can drive. The two conversational kinds (`needs_clarification`,
// `out_of_scope`) are NOT operations — they are handled upstream and must never
// reach this guard.
export const PERMITTED_OPERATIONS = [
  "add_field",
  "add_table",
  "add_view",
  "hide_field",
  // Story 5.6: the ONE permitted true removal. A view holds no rows, so deleting
  // its definition is inherently non-destructive (there is no view visibility
  // flag; the view is removed outright and re-added on Undo). It rides this same
  // allowlist + raw-SQL fence rather than being exempted. Its op name contains no
  // BLOCKED_KEYWORDS substring, so the blocklist is unchanged.
  "remove_view",
  // Story 5.7: the SAFE answer to "delete/remove a whole TABLE". Like
  // `hide_field`, it sets an append-only table-level `hidden` flag — no table or
  // row is ever dropped, and the hide is fully reversible from Settings or an
  // Undo. Unlike the other ops, its route handler OFFERS rather than applies (a
  // table hide is consequential enough to gate behind an explicit confirm button
  // that drives the write through the direct `/api/schema/tables` path), but it
  // still joins THIS allowlist so one uniform allowlist + raw-SQL fence covers
  // every model-driven operation. Its op name contains no BLOCKED_KEYWORDS
  // substring, so the blocklist is unchanged.
  "hide_table",
] as const;

export type PermittedOperation = (typeof PERMITTED_OPERATIONS)[number];

/** Whether `kind` is one of the permitted editor operations. */
export function isPermittedOperation(kind: unknown): kind is PermittedOperation {
  return (
    typeof kind === "string" &&
    (PERMITTED_OPERATIONS as readonly string[]).includes(kind)
  );
}

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
 * Blocked SQL verbs. They serve TWO distinct guards with different inputs:
 *
 *  1. The whole-word, normalized-KEY guard (`keyIsBlockedVerb`, below): matched
 *     against a key already normalized to `[a-z0-9_]` by `normalizeTableName`, so
 *     punctuation can never survive into a key and labels are NOT keyword-checked
 *     at all. A bare reserved verb used as a standalone key (`drop`, `delete`)
 *     rejects; `dropoff` / `backdrop` do not. (Story 2.5 — do not change.)
 *
 *  2. The raw-SQL discard guard (`containsRawSql`, below, Story 5.4): matched as
 *     SQL-shaped tokens against the RAW LLM OUTPUT (the model's returned operation
 *     object / its stringified JSON), NEVER against a human-typed display label.
 *     This gives literal coverage of the SQL punctuation tokens (`;`, `--`, `/*`)
 *     plus these verbs — the epic's "any LLM response containing SQL is discarded"
 *     rule. Splitting it from guard (1) is deliberate: it leaves Story 2.5's
 *     label-is-free-text / `dropoff`-passes behavior untouched.
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

/**
 * The SQL punctuation tokens that must never appear in raw LLM output. These are
 * the statement terminator / comment markers that, together with the blocked
 * verbs, let `containsRawSql` discard any model response that is shaped like SQL.
 */
const RAW_SQL_PUNCTUATION = [";", "--", "/*"] as const;

/**
 * A case-insensitive match of a blocked SQL verb as a SQL-SHAPED TOKEN in FREE
 * TEXT (the raw LLM output): the verb must be bounded by WHITESPACE or the
 * string ends — the shape of a verb in an actual SQL statement (`DROP TABLE x`,
 * `please DELETE the row`). This deliberately differs from the normalized-key
 * guard (`BLOCKED_KEYWORD_RE`, `\b`-bounded): a label like `"Drop-off time"`
 * binds the verb with a hyphen, not whitespace, so it does NOT match — Story
 * 2.5's label-is-free-text behavior is preserved even though the label rides
 * along inside the raw output. `dropoff` / `granted` (glued) likewise do not
 * match. A JSON string delimiter (`"`) also counts as a boundary so a verb
 * occupying a whole JSON value (`"DROP"`) is still caught.
 */
const RAW_SQL_VERB_RE = new RegExp(
  `(^|[\\s"'])(${BLOCKED_KEYWORDS.join("|")})($|[\\s"'])`,
  "i",
);

/**
 * Raw-SQL discard guard (Story 5.4). Returns `true` when the RAW LLM output (the
 * model's returned operation object, or any string) contains a SQL punctuation
 * token (`;`, `--`, `/*`) or a blocked SQL verb as a whole word.
 *
 * MUST run against raw model output ONLY — never a human-typed display label: a
 * label is inert, auto-escaped JSONB text and is free to say "Drop-off time"
 * (Story 2.5). The model's own output, by contrast, is JSON-only by contract, so
 * any SQL shape there is a security violation and the whole response is discarded.
 *
 * A non-string input is stringified via `JSON.stringify` so a nested value (e.g. a
 * `type` or `value` field smuggling `DROP TABLE`) is still scanned.
 */
export function containsRawSql(rawOutput: unknown): boolean {
  if (rawOutput === undefined || rawOutput === null) {
    return false;
  }
  let text: string;
  if (typeof rawOutput === "string") {
    text = rawOutput;
  } else {
    try {
      text = JSON.stringify(rawOutput);
    } catch {
      // A value that cannot be serialized (e.g. a cycle) cannot be audited for
      // SQL shape — treat it as suspicious and discard rather than pass it.
      return true;
    }
    if (typeof text !== "string") {
      return true;
    }
  }
  // ACCEPTED DEVIATION (Option A, per spec-5-4): this scans the WHOLE serialized
  // output, including benign free-text filter values/labels, so a permitted op
  // whose value contains `;`/`--`/`/*` or a whitespace-bounded blocked verb is
  // rejected too. This is the deliberate, frozen posture — non-destructive and it
  // invites the owner to rephrase. Not a bug; recorded so retros stop re-flagging.
  for (const token of RAW_SQL_PUNCTUATION) {
    if (text.includes(token)) {
      return true;
    }
  }
  return RAW_SQL_VERB_RE.test(text);
}

export type EditorOperationGuardResult =
  | { allowed: true; kind: PermittedOperation }
  | { allowed: false; reason: "operationNotAllowed" | "rawSqlRejected" };

/**
 * The explicit editor-path fence (Story 5.4). Run against the parsed LLM output
 * BEFORE any per-op dispatch / metadata write:
 *   - reject (and log) any `kind` outside `PERMITTED_OPERATIONS`;
 *   - reject (and log) any output whose RAW form contains SQL (`containsRawSql`).
 *
 * Every rejection calls `reportRejection(detail, { id, rawOutput })` (FR45) and
 * returns a reject CODE the caller maps to the single fixed rejection copy — never
 * a raw detail. On success returns the validated permitted `kind`.
 *
 * Note: `needs_clarification` / `out_of_scope` are conversational kinds, NOT
 * operations — they are handled upstream and must never reach this guard (passing
 * one here is itself an out-of-allowlist rejection).
 */
export function assertEditorOperationAllowed(
  output: { kind?: unknown; [key: string]: unknown } | null | undefined,
  context: ValidationContext = {},
): EditorOperationGuardResult {
  const reject = (
    reason: "operationNotAllowed" | "rawSqlRejected",
    detail: string,
  ): EditorOperationGuardResult => {
    reportRejection(detail, { id: context.id, rawOutput: context.rawOutput });
    return { allowed: false, reason };
  };

  const kind = output?.kind;
  if (!isPermittedOperation(kind)) {
    return reject(
      "operationNotAllowed",
      `editor op not in allowlist: "${String(kind)}"`,
    );
  }

  // Defense-in-depth + audit trail: the data layer never generates SQL (JSONB
  // metadata store), but any SQL-shaped model output is discarded on principle.
  if (containsRawSql(context.rawOutput ?? output)) {
    return reject("rawSqlRejected", "editor output contains raw SQL");
  }

  return { allowed: true, kind };
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
 * Focused, targeted relation-field validator (Story 3.7) — the Admin
 * "add relationship field" gate.
 *
 * This is DELIBERATELY separate from `validateGeneratedSchema`. That validator
 * sanitizes the whole-schema *generation* output and, in doing so, strips
 * post-generation metadata such as the Story 3.5 `hidden` flag (it never carries
 * `hidden` onto the sanitized fields). Re-running it against a live claimed-org
 * schema would silently un-hide those columns. So 3.7 validates ONE new relation
 * field against the current stored schema, reusing the same rule primitives
 * (`normalizeTableName`, `keyIsBlockedVerb`, `RESERVED_KEYS`, target-exists) and
 * returns the sanitized field to append — the generation gate is untouched.
 *
 * Accepts only when, against the stored `schema`:
 *   - `tableKey` names an existing table (the table the field is added to);
 *   - `targetTable` (normalized) names an existing, non-hidden table in the org;
 *   - the derived key (from `label`) normalizes non-empty, is unique within the
 *     table, is not a reserved key, and is not a blocked SQL verb;
 *   - `label` is a non-empty string.
 * `cardinality` is forced to `"one"` (no multi-select at MVP — the `growth` gate
 * stays with the generation path). Returns a reject `reason` (an error CODE the
 * caller maps to a translated message) on any failure — never a raw detail.
 */
export type RelationFieldInput = {
  label: string;
  targetTable: string;
};

export type ValidateRelationFieldResult =
  | {
      valid: true;
      field: {
        key: string;
        label: string;
        type: "relation";
        relationConfig: { targetTable: string; cardinality: "one" };
      };
    }
  | { valid: false; reason: "addFieldFailed" };

export function validateRelationField(
  schema: SchemaDefinition,
  tableKey: string,
  input: RelationFieldInput,
): ValidateRelationFieldResult {
  const reject = (): ValidateRelationFieldResult => ({
    valid: false,
    reason: "addFieldFailed",
  });

  const tables = schema.tables ?? [];

  // The table the field is being added to must exist (and be visible).
  const table = tables.find((t) => t.key === tableKey && !t.hidden);
  if (!table) {
    return reject();
  }

  // Label must be a non-empty string.
  if (!isNonEmptyString(input.label)) {
    return reject();
  }
  const label = input.label.trim();

  // The target table must exist in the same org schema and be visible.
  if (!isNonEmptyString(input.targetTable)) {
    return reject();
  }
  const targetTable = normalizeTableName(String(input.targetTable));
  const target = tables.find((t) => t.key === targetTable && !t.hidden);
  if (!target) {
    return reject();
  }

  // Derive the field key from the label (mirrors how generation derives keys)
  // and run it through every key protection.
  const key = normalizeTableName(label);
  if (!key) {
    return reject();
  }
  if (keyIsBlockedVerb(key)) {
    return reject();
  }
  if (RESERVED_KEYS.includes(key)) {
    return reject();
  }
  // Unique within the table — a derived key colliding with an existing field is
  // rejected (never silently overwrite an existing column's definition).
  if (table.fields.some((f) => f.key === key)) {
    return reject();
  }

  return {
    valid: true,
    field: {
      key,
      label,
      type: "relation",
      relationConfig: { targetTable, cardinality: "one" },
    },
  };
}

/**
 * The scalar field types the conversational editor may add via chat (Story 5.1).
 * Mirrors `GENERATION_FIELD_TYPES` but is asserted here as an explicit, local
 * allowlist so the editor path NEVER accepts `relation` (relations have their own
 * dedicated flow, Story 3.7). Any type outside this set is rejected.
 */
export const SCALAR_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "datetime",
  "boolean",
  "currency",
  "email",
  "phone",
] as const;

export type ScalarFieldType = (typeof SCALAR_FIELD_TYPES)[number];

/** The input the conversational add-column path proposes for one scalar field. */
export type AddFieldInput = {
  /** The human-facing label the model derived (e.g. "Warranty date"). */
  label: string;
  /** A scalar field type (never `relation`). */
  type: string;
};

export type ValidateAddFieldResult =
  | { valid: true; field: FieldDefinition }
  | { valid: false; reason: "addFieldFailed" };

/**
 * Focused, targeted scalar `add_field` validator (Story 5.1) — the conversational
 * "add a column via chat" gate.
 *
 * Deliberately separate from `validateGeneratedSchema` (which sanitizes the whole
 * generation batch and strips post-generation `hidden` flags — re-running it on a
 * live schema would silently un-hide columns) and mirrors `validateRelationField`
 * (Story 3.7): it validates ONE new scalar field against the CURRENT stored schema,
 * reusing the shared rule primitives (`normalizeTableName`, `keyIsBlockedVerb`,
 * `RESERVED_KEYS`) and returns the sanitized field to append.
 *
 * Accepts only when, against the stored `schema`:
 *   - `tableKey` (normalized) names an existing, non-hidden table;
 *   - `type` is one of `SCALAR_FIELD_TYPES` (never `relation`, never unknown);
 *   - `label` is a non-empty string;
 *   - the derived key (from `label`) normalizes non-empty, is NOT a reserved key,
 *     is NOT a blocked SQL verb, and does not collide with an existing field key
 *     (including a hidden one — never silently overwrite a definition).
 * Returns the reject CODE `addFieldFailed` (the caller maps it to fixed
 * plain-language rejection copy) on any failure — never a raw detail. Every
 * rejection is logged via `reportRejection` with the org id + raw LLM output.
 */
export function validateAddField(
  schema: SchemaDefinition,
  tableKey: string,
  input: AddFieldInput,
  context: ValidationContext = {},
): ValidateAddFieldResult {
  const reject = (detail: string): ValidateAddFieldResult => {
    reportRejection(detail, { id: context.id, rawOutput: context.rawOutput });
    return { valid: false, reason: "addFieldFailed" };
  };

  const tables = schema.tables ?? [];

  // The table the field is added to must exist and be visible.
  const normalizedTableKey = normalizeTableName(tableKey);
  const table = tables.find((t) => t.key === normalizedTableKey && !t.hidden);
  if (!table) {
    return reject(`add_field: unknown or hidden table "${tableKey}"`);
  }

  // Label must be a non-empty string.
  if (!isNonEmptyString(input.label)) {
    return reject("add_field: missing label");
  }
  const label = input.label.trim();

  // Type must be a scalar type — `relation`/unknown are rejected outright.
  if (
    typeof input.type !== "string" ||
    !(SCALAR_FIELD_TYPES as readonly string[]).includes(input.type)
  ) {
    return reject(`add_field: unsupported type "${String(input.type)}"`);
  }
  const type = input.type as ScalarFieldType;

  // Derive the field key from the label and run every key protection.
  const key = normalizeTableName(label);
  if (!key) {
    return reject("add_field: key normalized to empty");
  }
  if (keyIsBlockedVerb(key)) {
    return reject(`add_field: key is a blocked SQL verb "${key}"`);
  }
  if (RESERVED_KEYS.includes(key)) {
    return reject(`add_field: key collides with reserved key "${key}"`);
  }
  // Unique within the table — a derived key colliding with ANY existing field
  // (including a hidden one) is rejected: never silently overwrite a definition.
  if (table.fields.some((f) => f.key === key)) {
    return reject(`add_field: key collides with existing field "${key}"`);
  }

  return {
    valid: true,
    field: { key, label, type },
  };
}

/** One scalar field the conversational `add_table` path proposes. */
export type AddTableFieldInput = {
  /** The human-facing label the model derived (e.g. "Employee name"). */
  label: string;
  /** A scalar field type (never `relation`). */
  type: string;
};

/** The input the conversational `add_table` path proposes for a new table. */
export type AddTableInput = {
  /** The human-facing table label the model derived (e.g. "Employee timesheets"). */
  label: string;
  /** The starter set of scalar fields (never a `relation`). */
  fields: AddTableFieldInput[];
};

export type ValidateAddTableResult =
  | { valid: true; table: TableDefinition }
  | { valid: false; reason: "addTableFailed" };

/**
 * Focused, targeted `add_table` validator (Story 5.2) — the conversational "add a
 * table via chat" gate.
 *
 * Deliberately separate from `validateGeneratedSchema` (which sanitizes the whole
 * generation batch and strips post-generation `hidden` flags — re-running it on a
 * live schema would silently un-hide tables/columns) and mirrors `validateAddField`
 * (Story 5.1): it validates ONE new table + its starter scalar fields against the
 * CURRENT stored schema, reusing the shared rule primitives (`normalizeTableName`,
 * `keyIsBlockedVerb`, `RESERVED_KEYS`, `SCALAR_FIELD_TYPES`) and returns the
 * sanitized `TableDefinition` to append.
 *
 * Accepts only when, against the stored `schema`:
 *   - `label` is a non-empty string and the derived table key normalizes non-empty,
 *     is NOT a blocked SQL verb, and (after disambiguation) does not collide with a
 *     reserved key or an EXISTING table (visible OR hidden) — a collision is
 *     disambiguated with a numeric suffix (`jobs_2`, `jobs_3`, …), never overwritten;
 *   - at least one field is proposed, and EACH field: has a non-empty label, a scalar
 *     `type` (never `relation`/unknown), a derived key that normalizes non-empty, is
 *     NOT a reserved key and NOT a blocked SQL verb; a field key duplicated within the
 *     new table is disambiguated with a numeric suffix (never dropped silently).
 *   - `displayField` is derived via `displayFieldKey` over the sanitized fields.
 *
 * Returns the reject CODE `addTableFailed` (the caller maps it to fixed plain-language
 * rejection copy) on any failure — never a raw detail. Every rejection is logged via
 * `reportRejection` with the org id + raw LLM output.
 */
export function validateAddTable(
  schema: SchemaDefinition,
  input: AddTableInput,
  context: ValidationContext = {},
): ValidateAddTableResult {
  const reject = (detail: string): ValidateAddTableResult => {
    reportRejection(detail, { id: context.id, rawOutput: context.rawOutput });
    return { valid: false, reason: "addTableFailed" };
  };

  // Table label must be a non-empty string.
  if (!isNonEmptyString(input.label)) {
    return reject("add_table: missing label");
  }
  const label = input.label.trim();

  // Derive the table key from the label and run every key protection. A blocked
  // SQL verb rejects outright (never disambiguated).
  const baseKey = normalizeTableName(label);
  if (!baseKey) {
    return reject("add_table: key normalized to empty");
  }
  if (keyIsBlockedVerb(baseKey)) {
    return reject(`add_table: key is a blocked SQL verb "${baseKey}"`);
  }

  // Disambiguate a key that collides with a reserved key or an existing table
  // (visible OR hidden) with a numeric suffix — never overwrite. The suffixed key
  // is re-checked against the same taken set until it is free.
  const takenTableKeys = new Set<string>([
    ...RESERVED_KEYS,
    ...(schema.tables ?? []).map((t) => t.key),
  ]);
  let tableKey = baseKey;
  if (takenTableKeys.has(tableKey)) {
    let suffix = 2;
    while (takenTableKeys.has(`${baseKey}_${suffix}`)) {
      suffix += 1;
    }
    tableKey = `${baseKey}_${suffix}`;
  }

  // At least one field is required (a table with no columns is not usable).
  if (!Array.isArray(input.fields) || input.fields.length === 0) {
    return reject("add_table: no fields proposed");
  }

  const seenFieldKeys = new Set<string>();
  const sanitizedFields: FieldDefinition[] = [];

  for (const field of input.fields) {
    if (!field || typeof field !== "object") {
      return reject("add_table: a field is not an object");
    }
    if (!isNonEmptyString(field.label)) {
      return reject("add_table: a field is missing a label");
    }
    const fieldLabel = field.label.trim();

    // Type must be a scalar type — `relation`/unknown are rejected outright.
    if (
      typeof field.type !== "string" ||
      !(SCALAR_FIELD_TYPES as readonly string[]).includes(field.type)
    ) {
      return reject(`add_table: unsupported field type "${String(field.type)}"`);
    }
    const type = field.type as ScalarFieldType;

    // Derive the field key from the label and run every key protection.
    const fieldBaseKey = normalizeTableName(fieldLabel);
    if (!fieldBaseKey) {
      return reject("add_table: field key normalized to empty");
    }
    if (keyIsBlockedVerb(fieldBaseKey)) {
      return reject(`add_table: field key is a blocked SQL verb "${fieldBaseKey}"`);
    }
    if (RESERVED_KEYS.includes(fieldBaseKey)) {
      return reject(`add_table: field key collides with reserved key "${fieldBaseKey}"`);
    }

    // Disambiguate a duplicate field key within THIS new table with a numeric
    // suffix (never silently drop a column the owner asked for).
    let fieldKey = fieldBaseKey;
    if (seenFieldKeys.has(fieldKey)) {
      let suffix = 2;
      while (seenFieldKeys.has(`${fieldBaseKey}_${suffix}`)) {
        suffix += 1;
      }
      fieldKey = `${fieldBaseKey}_${suffix}`;
    }
    seenFieldKeys.add(fieldKey);

    sanitizedFields.push({ key: fieldKey, label: fieldLabel, type });
  }

  const table: TableDefinition = {
    key: tableKey,
    label,
    fields: sanitizedFields,
  };
  // Derive the canonical display label (first non-hidden text field, else first
  // field). The starter fields are never hidden, so this always resolves.
  const display = displayFieldKey(table);
  if (display) {
    table.displayField = display;
  }

  return { valid: true, table };
}

/** One filter the conversational `add_view` path proposes. */
export type AddViewFilterInput = {
  /** The source-table field key (or label — normalized) this filter targets. */
  field: string;
  /** The operator, which must be valid for the field's type. */
  operator: string;
  /** The comparison value. */
  value?: unknown;
  /** The upper bound (only used by `between`). */
  value2?: unknown;
};

/** The sort the conversational `add_view` path proposes (or `null` for none). */
export type AddViewSortInput = {
  field: string;
  direction: string;
} | null;

/** The input the conversational `add_view` path proposes for a new view. */
export type AddViewInput = {
  /** The human-facing view label the model derived (e.g. "Unpaid invoices"). */
  label: string;
  /** The key (or label) of the existing, visible source table. */
  sourceTableKey: string;
  /** The saved filters (ANDed), over visible scalar fields of the source. */
  filters: AddViewFilterInput[];
  /** The saved single-field sort, or `null` for none. */
  sort: AddViewSortInput;
};

export type ValidateAddViewResult =
  | { valid: true; view: ViewDefinition }
  | { valid: false; reason: "addViewFailed" };

/**
 * Focused, targeted `add_view` validator (Story 5.3) — the conversational "create
 * a view via chat" gate.
 *
 * Deliberately separate from `validateGeneratedSchema` (which sanitizes the whole
 * generation batch and strips post-generation `hidden` flags) and mirrors
 * `validateAddTable` (Story 5.2): it validates ONE new view against the CURRENT
 * stored schema, reusing the shared rule primitives (`normalizeTableName`,
 * `keyIsBlockedVerb`, `RESERVED_KEYS`, `operatorsForType`) and returns the
 * sanitized `ViewDefinition` to append.
 *
 * A view is pure presentation metadata over an EXISTING visible table's live rows;
 * it never alters that table or any `records` row. Accepts only when, against the
 * stored `schema`:
 *   - `sourceTableKey` (normalized) names an existing, non-hidden table;
 *   - `label` is a non-empty string, its derived key normalizes non-empty, is NOT
 *     a blocked SQL verb, and (after disambiguation with a numeric suffix) does not
 *     collide with a reserved key, an EXISTING table key, OR an existing view key —
 *     never overwritten;
 *   - EACH filter targets a VISIBLE SCALAR field of the source table (never a
 *     relation/hidden/unknown field), with an operator valid for that field's type
 *     (`operatorsForType`) and a non-empty value (`value2` required + used only for
 *     `between`);
 *   - the sort (when present) names a visible scalar field with a valid direction;
 *   - at least one filter OR a sort is present (a view with neither is rejected).
 *
 * Returns the reject CODE `addViewFailed` (the caller maps it to fixed plain-language
 * rejection copy) on any failure — never a raw detail. Every rejection is logged via
 * `reportRejection` with the org id + raw LLM output.
 */
export function validateAddView(
  schema: SchemaDefinition,
  input: AddViewInput,
  context: ValidationContext = {},
): ValidateAddViewResult {
  const reject = (detail: string): ValidateAddViewResult => {
    reportRejection(detail, { id: context.id, rawOutput: context.rawOutput });
    return { valid: false, reason: "addViewFailed" };
  };

  const tables = schema.tables ?? [];
  const views = schema.views ?? [];

  // 1. The source table must exist and be visible.
  if (!isNonEmptyString(input.sourceTableKey)) {
    return reject("add_view: missing sourceTableKey");
  }
  const normalizedSource = normalizeTableName(String(input.sourceTableKey));
  const sourceTable = tables.find((t) => t.key === normalizedSource && !t.hidden);
  if (!sourceTable) {
    return reject(
      `add_view: unknown or hidden source table "${String(input.sourceTableKey)}"`,
    );
  }

  // 2. The view label + derived key. A blocked SQL verb rejects outright (never
  //    disambiguated); a collision with a reserved key, an existing table key, or
  //    an existing view key is disambiguated with a numeric suffix.
  if (!isNonEmptyString(input.label)) {
    return reject("add_view: missing label");
  }
  const label = input.label.trim();
  const baseKey = normalizeTableName(label);
  if (!baseKey) {
    return reject("add_view: key normalized to empty");
  }
  if (keyIsBlockedVerb(baseKey)) {
    return reject(`add_view: key is a blocked SQL verb "${baseKey}"`);
  }

  const takenKeys = new Set<string>([
    ...RESERVED_KEYS,
    ...tables.map((t) => t.key),
    ...views.map((v) => v.key),
  ]);
  let viewKey = baseKey;
  if (takenKeys.has(viewKey)) {
    let suffix = 2;
    while (takenKeys.has(`${baseKey}_${suffix}`)) {
      suffix += 1;
    }
    viewKey = `${baseKey}_${suffix}`;
  }

  // A lookup of the source table's VISIBLE fields (hidden fields are never a view
  // target). Relation fields are excluded here (scalar-only via chat).
  const visibleFieldByKey = new Map<string, FieldDefinition>();
  for (const field of sourceTable.fields) {
    if (!field.hidden) {
      visibleFieldByKey.set(field.key, field);
    }
  }

  // 3. Validate each filter: a visible SCALAR field + a type-valid operator +
  //    required value(s). Never a relation/hidden/unknown field.
  if (!Array.isArray(input.filters)) {
    return reject("add_view: filters is not an array");
  }
  const sanitizedFilters: FilterState[] = [];
  for (const filter of input.filters) {
    if (!filter || typeof filter !== "object") {
      return reject("add_view: a filter is not an object");
    }
    if (!isNonEmptyString(filter.field)) {
      return reject("add_view: a filter is missing a field");
    }
    const fieldKey = normalizeTableName(String(filter.field));
    const field = visibleFieldByKey.get(fieldKey);
    if (!field) {
      return reject(
        `add_view: filter field "${String(filter.field)}" is not a visible field of "${normalizedSource}"`,
      );
    }
    if (field.type === "relation") {
      return reject(
        `add_view: filter field "${fieldKey}" is a relation (scalar-only via chat)`,
      );
    }
    const allowed = operatorsForType(field.type);
    if (
      typeof filter.operator !== "string" ||
      !allowed.includes(filter.operator as FilterOperator)
    ) {
      return reject(
        `add_view: operator "${String(filter.operator)}" is invalid for field type "${field.type}"`,
      );
    }
    const operator = filter.operator as FilterOperator;
    if (!isNonEmptyString(filter.value)) {
      return reject(`add_view: filter on "${fieldKey}" is missing a value`);
    }
    const value = String(filter.value).trim();
    const sanitizedFilter: FilterState = { field: fieldKey, operator, value };
    if (operator === "between") {
      if (!isNonEmptyString(filter.value2)) {
        return reject(
          `add_view: 'between' filter on "${fieldKey}" is missing value2`,
        );
      }
      sanitizedFilter.value2 = String(filter.value2).trim();
    }
    sanitizedFilters.push(sanitizedFilter);
  }

  // 4. Validate the sort (when present): a visible scalar field + a valid direction.
  let sanitizedSort: SortState = null;
  if (input.sort !== null && input.sort !== undefined) {
    if (typeof input.sort !== "object" || !isNonEmptyString(input.sort.field)) {
      return reject("add_view: sort is present but malformed");
    }
    const sortFieldKey = normalizeTableName(String(input.sort.field));
    const sortField = visibleFieldByKey.get(sortFieldKey);
    if (!sortField) {
      return reject(
        `add_view: sort field "${String(input.sort.field)}" is not a visible field of "${normalizedSource}"`,
      );
    }
    if (sortField.type === "relation") {
      return reject(
        `add_view: sort field "${sortFieldKey}" is a relation (scalar-only via chat)`,
      );
    }
    const direction = input.sort.direction;
    if (direction !== "asc" && direction !== "desc") {
      return reject(
        `add_view: invalid sort direction "${String(direction)}"`,
      );
    }
    sanitizedSort = { field: sortFieldKey, direction };
  }

  // 5. A view must carry at least one filter or a sort (a view with neither is a
  //    no-op and is rejected).
  if (sanitizedFilters.length === 0 && sanitizedSort === null) {
    return reject("add_view: a view with no filter and no sort is degenerate");
  }

  return {
    valid: true,
    view: {
      key: viewKey,
      label,
      sourceTableKey: normalizedSource,
      filters: sanitizedFilters,
      sort: sanitizedSort,
    },
  };
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
