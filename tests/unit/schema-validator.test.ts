import { describe, expect, it, vi } from "vitest";

import {
  BLOCKED_KEYWORDS,
  PERMITTED_OPERATIONS,
  RESERVED_KEYS,
  SCALAR_FIELD_TYPES,
  assertEditorOperationAllowed,
  containsRawSql,
  filterSeedRows,
  isPermittedOperation,
  validateAddField,
  validateAddSelectOption,
  validateArchiveSelectOption,
  validateGeneratedSchema,
  validateRenameSelectOption,
} from "@/lib/schema/validator";
import { GENERATION_FIELD_TYPES } from "@/lib/gemini/prompts";
import type { SchemaDefinition, TableDefinition } from "@/types/db";

/**
 * Unit coverage for the pre-persist Schema Validator (Story 1.4). No network, no
 * DB — pure structural allowlist checks against the I/O matrix: each rejection
 * (relation type, reserved key, blocked keyword), key normalization, and the
 * malformed-seed-row skip. The observability seam is mocked so a rejection logs
 * without touching Sentry/console.
 */

vi.mock("@/lib/observability/report", () => ({
  reportRejection: vi.fn(),
  reportError: vi.fn(),
}));

function validSchema() {
  return {
    schema: {
      tables: [
        {
          key: "Client List!",
          label: "Clients",
          reason: "The people you serve.",
          fields: [
            { key: "Client Name", label: "Client", type: "text", reason: "Who." },
            { key: "quoted", label: "Quoted", type: "currency", reason: "Price." },
          ],
        },
      ],
    },
    seedRows: {},
  };
}

describe("validateGeneratedSchema — happy path", () => {
  it("accepts a well-formed schema and normalizes keys", () => {
    const result = validateGeneratedSchema(validSchema());
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    const [table] = result.sanitized.tables;
    // "Client List!" → "client_list"; "Client Name" → "client_name".
    expect(table.key).toBe("client_list");
    expect(table.label).toBe("Clients");
    expect(table.fields.map((f) => f.key)).toEqual(["client_name", "quoted"]);
    expect(table.fields[0].reason).toBe("Who.");
  });

  it("accepts a bare { tables } envelope (no outer schema key)", () => {
    const bare = validSchema().schema;
    const result = validateGeneratedSchema(bare);
    expect(result.valid).toBe(true);
  });

  it("preserves the sensitive flag when present", () => {
    const raw = validSchema();
    raw.schema.tables[0].fields[0] = {
      key: "email",
      label: "Email",
      type: "email",
      reason: "Contact.",
      // @ts-expect-error — exercising the runtime path with an extra flag
      sensitive: true,
    };
    const result = validateGeneratedSchema(raw);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.sanitized.tables[0].fields[0].sensitive).toBe(true);
  });
});

describe("validateGeneratedSchema — rejections", () => {
  it("rejects a relation whose targetTable does not resolve in the batch", () => {
    // Story 1.8: relations are now ACCEPTED on the generation path, but only
    // when the target resolves. A dangling target is rejected.
    const raw = validSchema();
    raw.schema.tables[0].fields[0] = {
      key: "linked",
      label: "Linked",
      type: "relation",
      reason: "Points nowhere.",
      // @ts-expect-error — exercising the runtime relation path
      relationConfig: { targetTable: "does_not_exist", cardinality: "one" },
    };
    const result = validateGeneratedSchema(raw);
    expect(result.valid).toBe(false);
  });

  it("rejects any unsupported field type", () => {
    const raw = validSchema();
    raw.schema.tables[0].fields[0].type = "json";
    const result = validateGeneratedSchema(raw);
    expect(result.valid).toBe(false);
  });

  it("rejects a field key that collides with a reserved column", () => {
    for (const reserved of RESERVED_KEYS) {
      const raw = validSchema();
      raw.schema.tables[0].fields[0].key = reserved;
      const result = validateGeneratedSchema(raw);
      expect(result.valid, `reserved key ${reserved} must reject`).toBe(false);
    }
  });

  it("rejects a table key that normalizes to a reserved column", () => {
    const raw = validSchema();
    raw.schema.tables[0].key = "Data";
    const result = validateGeneratedSchema(raw);
    expect(result.valid).toBe(false);
  });

  it("rejects a key that normalizes to a bare blocked SQL verb", () => {
    // Word-boundary match on the normalized key: a bare verb is refused. Pin
    // BOTH call sites — the field key and the table key — so a regression at
    // either guard (validator.ts) cannot ship with the other's tests green.
    for (const kw of BLOCKED_KEYWORDS) {
      const fieldRaw = validSchema();
      fieldRaw.schema.tables[0].fields[0].key = kw.toLowerCase();
      expect(
        validateGeneratedSchema(fieldRaw).valid,
        `bare field key ${kw} must reject`,
      ).toBe(false);

      const tableRaw = validSchema();
      tableRaw.schema.tables[0].key = kw.toLowerCase();
      expect(
        validateGeneratedSchema(tableRaw).valid,
        `bare table key ${kw} must reject`,
      ).toBe(false);
    }
  });

  it("rejects an empty tables array", () => {
    const result = validateGeneratedSchema({ schema: { tables: [] }, seedRows: {} });
    expect(result.valid).toBe(false);
  });

  it("rejects a table with no fields", () => {
    const raw = validSchema();
    raw.schema.tables[0].fields = [];
    const result = validateGeneratedSchema(raw);
    expect(result.valid).toBe(false);
  });

  it("rejects a completely malformed payload without throwing", () => {
    expect(validateGeneratedSchema(null).valid).toBe(false);
    expect(validateGeneratedSchema("nope").valid).toBe(false);
    expect(validateGeneratedSchema({ schema: 42 }).valid).toBe(false);
  });

  it("logs every rejection through the observability seam", async () => {
    const { reportRejection } = await import("@/lib/observability/report");
    vi.mocked(reportRejection).mockClear();

    const raw = validSchema();
    raw.schema.tables[0].fields[0].type = "relation";
    validateGeneratedSchema(raw, { id: "session-1", rawOutput: raw });

    expect(reportRejection).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportRejection).mock.calls[0][1]).toMatchObject({
      id: "session-1",
    });
  });
});

describe("validateGeneratedSchema — Story 2.5: labels are not keyword-checked", () => {
  // A legitimate label that merely *contains* a blocked keyword as a substring
  // must validate and provision as a real (non-fallback) generation. Labels are
  // inert escaped JSONB text — never SQL — so keyword-checking them only
  // false-rejects ordinary business vocabulary. See retro finding F7.
  it.each([
    ["table label", "Grants"],
    ["table label", "Drop-off time"],
    ["field label", "Deleted?"],
    ["field label", "Delete date"],
    ["field label", "Executive summary"],
    ["field label", "Grant total"],
    ["field label", "Truncated notes"],
  ])("accepts a %s of %j", (where, label) => {
    const raw = validSchema();
    if (where === "table label") {
      raw.schema.tables[0].label = label;
    } else {
      raw.schema.tables[0].fields[0].label = label;
    }
    const result = validateGeneratedSchema(raw);
    expect(result.valid, `${label} must validate`).toBe(true);
  });

  it("accepts keys whose text embeds a blocked verb as a non-word (dropoff, backdrop)", () => {
    // A normalized key passes unless it is exactly a bare verb. The guard uses
    // \b(...)\b, but normalizeTableName maps every separator to "_", which is a
    // regex word char — so no boundary ever forms mid-key. Thus "backdrop"
    // (verb glued inside), "dropoff" (concatenated), and "Drop-off time" →
    // "drop_off_time" (verb joined to the next token by "_") all validate.
    for (const key of ["dropoff", "backdrop", "Drop-off time", "granted", "deleted at source"]) {
      const raw = validSchema();
      raw.schema.tables[0].fields[0].key = key;
      const result = validateGeneratedSchema(raw);
      expect(result.valid, `key ${key} must validate`).toBe(true);
    }
  });

  it("still rejects a reserved-key collision, a relation type, and an empty label", () => {
    const reserved = validSchema();
    reserved.schema.tables[0].fields[0].key = RESERVED_KEYS[0];
    expect(validateGeneratedSchema(reserved).valid).toBe(false);

    const relation = validSchema();
    relation.schema.tables[0].fields[0].type = "relation";
    expect(validateGeneratedSchema(relation).valid).toBe(false);

    const emptyLabel = validSchema();
    emptyLabel.schema.tables[0].fields[0].label = "";
    expect(validateGeneratedSchema(emptyLabel).valid).toBe(false);
  });
});

describe("validateGeneratedSchema — Story 1.8: relation gate", () => {
  // A two-table batch: `clients` and `jobs`, where jobs.client relates to clients.
  function linkedSchema() {
    return {
      schema: {
        tables: [
          {
            key: "clients",
            label: "Clients",
            reason: "People you serve.",
            fields: [
              { key: "name", label: "Name", type: "text", reason: "Who." },
            ],
          },
          {
            key: "jobs",
            label: "Jobs",
            reason: "Work booked.",
            fields: [
              { key: "service", label: "Service", type: "text", reason: "What." },
              {
                key: "client",
                label: "Client",
                type: "relation",
                reason: "For whom.",
                relationConfig: { targetTable: "clients", cardinality: "one" },
              },
            ],
          },
        ],
      },
      seedRows: {},
    };
  }

  it("accepts a valid relation to a batch table and carries relationConfig through", () => {
    const result = validateGeneratedSchema(linkedSchema());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const jobs = result.sanitized.tables.find((t) => t.key === "jobs");
    const rel = jobs?.fields.find((f) => f.key === "client");
    expect(rel?.type).toBe("relation");
    expect(rel?.relationConfig).toEqual({
      targetTable: "clients",
      cardinality: "one",
    });
    expect(rel?.reason).toBe("For whom.");
  });

  it("resolves a target declared LATER in the batch (two-pass)", () => {
    // Reverse the table order so `jobs` (referencing) precedes `clients`.
    const raw = linkedSchema();
    raw.schema.tables.reverse();
    const result = validateGeneratedSchema(raw);
    expect(result.valid).toBe(true);
  });

  it("accepts a self-reference (legal)", () => {
    const raw = linkedSchema();
    raw.schema.tables[0].fields.push({
      key: "referred_by",
      label: "Referred by",
      type: "relation",
      reason: "Referral chain.",
      relationConfig: { targetTable: "clients", cardinality: "one" },
    });
    const result = validateGeneratedSchema(raw);
    expect(result.valid).toBe(true);
  });

  it("accepts a cycle A->B->A (legal)", () => {
    const raw = linkedSchema();
    // clients.latest_job -> jobs, jobs.client -> clients: a cycle.
    raw.schema.tables[0].fields.push({
      key: "latest_job",
      label: "Latest job",
      type: "relation",
      reason: "Most recent work.",
      relationConfig: { targetTable: "jobs", cardinality: "one" },
    });
    const result = validateGeneratedSchema(raw);
    expect(result.valid).toBe(true);
  });

  it("rejects an unknown targetTable", () => {
    const raw = linkedSchema();
    raw.schema.tables[1].fields[1].relationConfig!.targetTable = "nope";
    const result = validateGeneratedSchema(raw);
    expect(result.valid).toBe(false);
  });

  it("rejects cardinality:'many' in the generation phase", () => {
    const raw = linkedSchema();
    raw.schema.tables[1].fields[1].relationConfig!.cardinality = "many";
    const result = validateGeneratedSchema(raw, { phase: "generation" });
    expect(result.valid).toBe(false);
  });

  it("accepts cardinality:'many' in the growth phase", () => {
    const raw = linkedSchema();
    raw.schema.tables[1].fields[1].relationConfig!.cardinality = "many";
    const result = validateGeneratedSchema(raw, { phase: "growth" });
    expect(result.valid).toBe(true);
  });

  it("rejects a relation from a non-llm source in the generation phase", () => {
    const result = validateGeneratedSchema(linkedSchema(), { source: "ui" });
    expect(result.valid).toBe(false);
  });

  it("accepts a relation from a ui source in the growth phase", () => {
    const result = validateGeneratedSchema(linkedSchema(), {
      source: "ui",
      phase: "growth",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a relation missing its relationConfig", () => {
    const raw = linkedSchema();
    // Strip the config entirely.
    delete (raw.schema.tables[1].fields[1] as { relationConfig?: unknown })
      .relationConfig;
    const result = validateGeneratedSchema(raw);
    expect(result.valid).toBe(false);
  });
});

describe("validateGeneratedSchema — Story 1.8: displayField", () => {
  it("accepts a displayField naming a visible field and normalizes it", () => {
    const raw = validSchema();
    (raw.schema.tables[0] as { displayField?: string }).displayField =
      "Client Name";
    const result = validateGeneratedSchema(raw);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.sanitized.tables[0].displayField).toBe("client_name");
  });

  it("rejects a displayField that names no field", () => {
    const raw = validSchema();
    (raw.schema.tables[0] as { displayField?: string }).displayField = "missing";
    const result = validateGeneratedSchema(raw);
    expect(result.valid).toBe(false);
  });

  it("rejects a displayField that names a hidden field", () => {
    const raw = validSchema();
    // Add a hidden field and point displayField at it: it exists but is hidden.
    raw.schema.tables[0].fields.push({
      key: "secret",
      label: "Secret",
      type: "text",
      reason: "Hidden.",
      // @ts-expect-error — exercising the runtime hidden-field path
      hidden: true,
    });
    (raw.schema.tables[0] as { displayField?: string }).displayField = "secret";
    const result = validateGeneratedSchema(raw);
    expect(result.valid).toBe(false);
  });

  it("rejects a displayField that names a relation field (id is not a label)", () => {
    const raw = {
      schema: {
        tables: [
          {
            key: "clients",
            label: "Clients",
            reason: "People you serve.",
            fields: [
              { key: "name", label: "Name", type: "text", reason: "Who." },
            ],
          },
          {
            key: "jobs",
            label: "Jobs",
            reason: "Work booked.",
            // Point the display label at the relation field — must be rejected.
            displayField: "client",
            fields: [
              { key: "service", label: "Service", type: "text", reason: "What." },
              {
                key: "client",
                label: "Client",
                type: "relation",
                reason: "For whom.",
                relationConfig: { targetTable: "clients", cardinality: "one" },
              },
            ],
          },
        ],
      },
      seedRows: {},
    };
    const result = validateGeneratedSchema(raw);
    expect(result.valid).toBe(false);
  });

  it("leaves displayField unset when omitted", () => {
    const result = validateGeneratedSchema(validSchema());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.sanitized.tables[0].displayField).toBeUndefined();
  });
});

describe("filterSeedRows — malformed rows are skipped, not fatal", () => {
  const table: TableDefinition = {
    key: "clients",
    label: "Clients",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "quoted", label: "Quoted", type: "currency" },
    ],
  };

  it("keeps well-formed rows and projects onto known field keys", () => {
    const rows = filterSeedRows(table, [
      { name: "Maple Ridge", quoted: 8400, junk: "ignored" },
      { name: "Bytown", quoted: 1250 },
    ]);
    expect(rows).toEqual([
      { name: "Maple Ridge", quoted: 8400 },
      { name: "Bytown", quoted: 1250 },
    ]);
  });

  it("drops non-object rows and rows with no recognized fields", () => {
    const rows = filterSeedRows(table, [
      { name: "Keep me" },
      "not an object",
      null,
      42,
      { unknown: "nope" },
      ["array"],
    ]);
    expect(rows).toEqual([{ name: "Keep me" }]);
  });

  it("returns an empty array when seedRows is not an array", () => {
    expect(filterSeedRows(table, undefined)).toEqual([]);
    expect(filterSeedRows(table, { not: "an array" })).toEqual([]);
  });
});

/**
 * Story 5.4 — the conversational editor guardrails. Three surfaces, all pinned:
 * (a) the PERMITTED_OPERATIONS allowlist + `assertEditorOperationAllowed` guard;
 * (b) the raw-SQL discard guard (`containsRawSql`) over the RAW model output —
 *     the full 8 tokens (5 verbs + `;`/`--`/`/*`) + a complete SQL string;
 * (c) that every rejection path logs via `reportRejection` with { id, rawOutput };
 * plus the Story 2.5 pins that labels/substrings still PASS and reserved-key
 * collisions still reject.
 */
describe("Story 5.4 — PERMITTED_OPERATIONS allowlist", () => {
  it("names exactly the permitted editor ops (additive + hide_field + remove_view + hide_table + the 3 select-option ops)", () => {
    expect([...PERMITTED_OPERATIONS]).toEqual([
      "add_field",
      "add_table",
      "add_view",
      "hide_field",
      "remove_view",
      "hide_table",
      // Story 13.1 — the three append-only select value-management ops.
      "add_select_option",
      "rename_select_option",
      "archive_select_option",
    ]);
  });

  it("isPermittedOperation accepts each permitted op and rejects everything else", () => {
    for (const op of PERMITTED_OPERATIONS) {
      expect(isPermittedOperation(op)).toBe(true);
    }
    for (const bad of [
      "delete_field",
      "drop_table",
      "rename",
      "add_relation",
      "needs_clarification",
      "out_of_scope",
      "",
      undefined,
      null,
      42,
    ]) {
      expect(isPermittedOperation(bad), `${String(bad)} must not be permitted`).toBe(
        false,
      );
    }
  });

  it("assertEditorOperationAllowed passes each permitted, well-formed op", () => {
    expect(
      assertEditorOperationAllowed({
        kind: "add_field",
        tableKey: "jobs",
        label: "Warranty date",
        type: "date",
      }),
    ).toEqual({ allowed: true, kind: "add_field" });
    expect(
      assertEditorOperationAllowed({
        kind: "add_table",
        label: "Timesheets",
        fields: [{ label: "Hours", type: "number" }],
      }),
    ).toEqual({ allowed: true, kind: "add_table" });
    expect(
      assertEditorOperationAllowed({
        kind: "add_view",
        label: "Unpaid",
        sourceTableKey: "invoices",
        filters: [{ field: "status", operator: "equals", value: "unpaid" }],
      }),
    ).toEqual({ allowed: true, kind: "add_view" });
    // Story 5.5 — hide_field rides the SAME allowlist + raw-SQL fence.
    expect(
      assertEditorOperationAllowed({
        kind: "hide_field",
        tableKey: "jobs",
        fieldKey: "notes",
      }),
    ).toEqual({ allowed: true, kind: "hide_field" });
    // Story 5.6 — remove_view rides the SAME allowlist + raw-SQL fence.
    expect(
      assertEditorOperationAllowed({
        kind: "remove_view",
        viewKey: "unpaid_invoices",
      }),
    ).toEqual({ allowed: true, kind: "remove_view" });
    // Story 5.7 — hide_table rides the SAME allowlist + raw-SQL fence (even though
    // its route handler OFFERS rather than applies).
    expect(
      assertEditorOperationAllowed({
        kind: "hide_table",
        tableKey: "jobs",
      }),
    ).toEqual({ allowed: true, kind: "hide_table" });
  });

  it("discards a hide_table whose raw output carries SQL (same fence as the add ops)", () => {
    const result = assertEditorOperationAllowed({
      kind: "hide_table",
      tableKey: "jobs",
      smuggled: "DROP TABLE records;",
    });
    expect(result).toEqual({ allowed: false, reason: "rawSqlRejected" });
  });

  it("discards a remove_view whose raw output carries SQL (same fence as the add ops)", () => {
    const result = assertEditorOperationAllowed({
      kind: "remove_view",
      viewKey: "unpaid_invoices",
      smuggled: "DROP TABLE records;",
    });
    expect(result).toEqual({ allowed: false, reason: "rawSqlRejected" });
  });

  it("discards a hide_field whose raw output carries SQL (same fence as the add ops)", () => {
    const result = assertEditorOperationAllowed({
      kind: "hide_field",
      tableKey: "jobs",
      fieldKey: "notes",
      smuggled: "DROP TABLE records;",
    });
    expect(result).toEqual({ allowed: false, reason: "rawSqlRejected" });
  });

  it("rejects an out-of-allowlist / unknown / conversational op as operationNotAllowed", () => {
    for (const kind of [
      "delete_field",
      "drop_table",
      "rename",
      "needs_clarification",
      "out_of_scope",
      undefined,
    ]) {
      const result = assertEditorOperationAllowed({ kind });
      expect(result).toEqual({
        allowed: false,
        reason: "operationNotAllowed",
      });
    }
  });

  it("logs an out-of-allowlist rejection via reportRejection with { id, rawOutput }", async () => {
    const { reportRejection } = await import("@/lib/observability/report");
    vi.mocked(reportRejection).mockClear();
    const output = { kind: "delete_everything" };
    const result = assertEditorOperationAllowed(output, {
      id: "org-1",
      rawOutput: output,
    });
    expect(result.allowed).toBe(false);
    expect(reportRejection).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportRejection).mock.calls[0][1]).toEqual({
      id: "org-1",
      rawOutput: output,
    });
  });
});

describe("Story 5.4 — raw-SQL discard guard (containsRawSql)", () => {
  it("detects each SQL punctuation token in raw output", () => {
    for (const token of [";", "--", "/*"]) {
      expect(containsRawSql(`anything ${token} here`), `token ${token}`).toBe(
        true,
      );
    }
  });

  it("detects each blocked SQL verb as a whole word in raw output", () => {
    for (const verb of BLOCKED_KEYWORDS) {
      expect(containsRawSql(`please ${verb} the table`), `verb ${verb}`).toBe(
        true,
      );
      // Mixed case still matches (case-insensitive).
      expect(containsRawSql(`please ${verb.toLowerCase()} the table`)).toBe(true);
    }
  });

  it("detects a complete raw-SQL string (DROP TABLE x;)", () => {
    expect(containsRawSql("DROP TABLE x;")).toBe(true);
    expect(containsRawSql({ kind: "add_field", label: "x", note: "DROP TABLE x;" })).toBe(
      true,
    );
  });

  it("scans a nested value (a verb smuggled into a field), not just the top level", () => {
    expect(
      containsRawSql({
        kind: "add_field",
        tableKey: "jobs",
        label: "ok",
        type: "text",
        value: "0; DELETE FROM records",
      }),
    ).toBe(true);
  });

  it("does NOT flag a benign operation object or label as raw SQL", () => {
    expect(
      containsRawSql({
        kind: "add_field",
        tableKey: "jobs",
        label: "Drop-off time",
        type: "datetime",
      }),
    ).toBe(false);
    // Substrings that merely embed a verb are not whole-word matches.
    expect(containsRawSql("dropoff backdrop granted deleted")).toBe(false);
    expect(containsRawSql(null)).toBe(false);
    expect(containsRawSql(undefined)).toBe(false);
  });

  it("FAILS CLOSED: an unserializable raw output (circular reference) is treated as SQL", () => {
    // A value JSON.stringify cannot audit for SQL shape must be discarded, never
    // waved through — the security fence errs toward rejection.
    const cyclic: Record<string, unknown> = { kind: "add_field" };
    cyclic.self = cyclic;
    expect(containsRawSql(cyclic)).toBe(true);
  });

  it("assertEditorOperationAllowed discards a permitted op whose raw output carries SQL", async () => {
    const { reportRejection } = await import("@/lib/observability/report");
    vi.mocked(reportRejection).mockClear();
    const output = {
      kind: "add_field",
      tableKey: "jobs",
      label: "ok",
      type: "text",
      smuggled: "DROP TABLE records;",
    };
    const result = assertEditorOperationAllowed(output, {
      id: "org-1",
      rawOutput: output,
    });
    expect(result).toEqual({ allowed: false, reason: "rawSqlRejected" });
    expect(reportRejection).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportRejection).mock.calls[0][1]).toEqual({
      id: "org-1",
      rawOutput: output,
    });
  });
});

describe("Story 5.4 — full blocklist on the normalized key (whole-word) + Story 2.5 pins", () => {
  function editorSchema(): SchemaDefinition {
    return {
      tables: [
        {
          key: "jobs",
          label: "Jobs",
          fields: [{ key: "status", label: "Status", type: "text" }],
        },
      ],
    };
  }

  it("rejects each blocked verb as a bare key (lower, UPPER, and mixed case)", () => {
    for (const verb of BLOCKED_KEYWORDS) {
      for (const variant of [
        verb.toLowerCase(),
        verb.toUpperCase(),
        // Mixed case, e.g. DrOp / GrAnt.
        verb.charAt(0) + verb.slice(1).toLowerCase(),
      ]) {
        const result = validateAddField(editorSchema(), "jobs", {
          label: variant,
          type: "text",
        });
        expect(
          result,
          `blocked verb ${variant} must reject`,
        ).toEqual({ valid: false, reason: "addFieldFailed" });
      }
    }
  });

  it("PASSES a label/key that merely embeds a blocked verb as a substring (Story 2.5)", () => {
    for (const label of ["dropoff", "backdrop", "Drop-off time"]) {
      const result = validateAddField(editorSchema(), "jobs", {
        label,
        type: "text",
      });
      expect(result.valid, `${label} must pass`).toBe(true);
    }
  });

  it("rejects a key that collides with EACH reserved key", () => {
    expect(RESERVED_KEYS.length).toBe(7);
    for (const reserved of RESERVED_KEYS) {
      const result = validateAddField(editorSchema(), "jobs", {
        label: reserved,
        type: "text",
      });
      expect(result, `reserved key ${reserved} must reject`).toEqual({
        valid: false,
        reason: "addFieldFailed",
      });
    }
  });
});

/**
 * Story 13.1 — the single-select (`select`) field type in the data model + the
 * Schema Validator. Covers the I/O & Edge-Case Matrix across BOTH validator
 * entry points:
 *  (a) `validateGeneratedSchema` + `validateAddField` accept a `select` field
 *      only with a non-empty list of unique, normalized, labelled options;
 *  (b) empty / duplicate-value / missing-label option lists are rejected on both
 *      paths (never silently deduped);
 *  (c) the three new value-management op names join the allowlist, pass the guard
 *      when well-formed, are discarded under raw SQL, and an unknown op still
 *      rejects;
 *  (d) a pin that `BLOCKED_KEYWORDS` and the whole-word key guard are unchanged.
 */
describe("Story 13.1 — select field: generation path", () => {
  function schemaWithSelect(options: unknown) {
    return {
      schema: {
        tables: [
          {
            key: "invoices",
            label: "Invoices",
            fields: [
              { key: "amount", label: "Amount", type: "currency" },
              { key: "status", label: "Status", type: "select", options },
            ],
          },
        ],
      },
    };
  }

  it("accepts a select field and normalizes + trims its options", () => {
    const result = validateGeneratedSchema(
      schemaWithSelect([
        { value: "Paid", label: "Paid" },
        { value: "Unpaid", label: " Unpaid " },
      ]),
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const field = result.sanitized.tables[0].fields[1];
    expect(field.type).toBe("select");
    expect(field.options).toEqual([
      { value: "paid", label: "Paid" },
      { value: "unpaid", label: "Unpaid" },
    ]);
    // No archived flag carried in on the generation path.
    expect(field.options?.every((o) => !("archived" in o))).toBe(true);
  });

  it("drops an inbound archived flag (new options are never archived)", () => {
    const result = validateGeneratedSchema(
      schemaWithSelect([
        { value: "Paid", label: "Paid", archived: true },
        { value: "Unpaid", label: "Unpaid" },
      ]),
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const field = result.sanitized.tables[0].fields[1];
    expect(field.options).toEqual([
      { value: "paid", label: "Paid" },
      { value: "unpaid", label: "Unpaid" },
    ]);
  });

  it("rejects empty options (missing, [], or not an array)", () => {
    for (const options of [undefined, [], {}, "nope"]) {
      const result = validateGeneratedSchema(schemaWithSelect(options));
      expect(result.valid, `options=${JSON.stringify(options)}`).toBe(false);
    }
  });

  it("rejects options whose normalized values collide (not deduped)", () => {
    const result = validateGeneratedSchema(
      schemaWithSelect([
        { value: "Paid", label: "Paid" },
        { value: "paid", label: "Also paid" },
      ]),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects an option missing its label", () => {
    const result = validateGeneratedSchema(
      schemaWithSelect([
        { value: "Paid", label: "Paid" },
        { value: "Unpaid", label: "" },
      ]),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects an option whose value is missing / empty", () => {
    const result = validateGeneratedSchema(
      schemaWithSelect([
        { value: "Paid", label: "Paid" },
        { value: "", label: "Unpaid" },
      ]),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a displayField that names a select field (stored token is not a label)", () => {
    const raw = schemaWithSelect([
      { value: "Paid", label: "Paid" },
      { value: "Unpaid", label: "Unpaid" },
    ]);
    // Point the table's display label at the select field — like a relation,
    // it stores an opaque token (`paid`), not the label, so it must be rejected.
    (raw.schema.tables[0] as { displayField?: string }).displayField = "status";
    const result = validateGeneratedSchema(raw);
    expect(result.valid).toBe(false);
  });
});

describe("Story 13.1 — select field: add-field path", () => {
  function editorSchema(): SchemaDefinition {
    return {
      tables: [
        {
          key: "invoices",
          label: "Invoices",
          fields: [{ key: "amount", label: "Amount", type: "currency" }],
        },
      ],
    };
  }

  it("accepts a select field with a non-empty, unique, labelled option list", () => {
    const result = validateAddField(editorSchema(), "invoices", {
      label: "Status",
      type: "select",
      options: [
        { value: "Paid", label: "Paid" },
        { value: "Unpaid", label: "Unpaid" },
        { value: "Rejected", label: "Rejected" },
      ],
    });
    expect(result).toEqual({
      valid: true,
      field: {
        key: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "paid", label: "Paid" },
          { value: "unpaid", label: "Unpaid" },
          { value: "rejected", label: "Rejected" },
        ],
      },
    });
  });

  it("rejects empty options", () => {
    for (const options of [undefined, [], "nope"]) {
      const result = validateAddField(editorSchema(), "invoices", {
        label: "Status",
        type: "select",
        options,
      });
      expect(result, `options=${JSON.stringify(options)}`).toEqual({
        valid: false,
        reason: "addFieldFailed",
      });
    }
  });

  it("rejects duplicate normalized option values (not deduped)", () => {
    const result = validateAddField(editorSchema(), "invoices", {
      label: "Status",
      type: "select",
      options: [
        { value: "Paid", label: "Paid" },
        { value: "paid", label: "Also paid" },
      ],
    });
    expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
  });

  it("rejects an option missing its label", () => {
    const result = validateAddField(editorSchema(), "invoices", {
      label: "Status",
      type: "select",
      options: [{ value: "Paid", label: "" }],
    });
    expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
  });

  it("drops an inbound archived flag (same guarantee as the generation path)", () => {
    const result = validateAddField(editorSchema(), "invoices", {
      label: "Status",
      type: "select",
      options: [
        { value: "Paid", label: "Paid", archived: true },
        { value: "Unpaid", label: "Unpaid" },
      ],
    });
    expect(result).toEqual({
      valid: true,
      field: {
        key: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "paid", label: "Paid" },
          { value: "unpaid", label: "Unpaid" },
        ],
      },
    });
  });
});

describe("Story 13.1 — new value-management ops join the allowlist + raw-SQL fence", () => {
  const NEW_OPS = [
    "add_select_option",
    "rename_select_option",
    "archive_select_option",
  ] as const;

  it("PERMITTED_OPERATIONS contains each of the three new op names", () => {
    for (const op of NEW_OPS) {
      expect((PERMITTED_OPERATIONS as readonly string[]).includes(op)).toBe(true);
      expect(isPermittedOperation(op)).toBe(true);
    }
  });

  it("assertEditorOperationAllowed passes each well-formed new op", () => {
    for (const op of NEW_OPS) {
      expect(
        assertEditorOperationAllowed({
          kind: op,
          tableKey: "invoices",
          fieldKey: "status",
          optionValue: "paid",
        }),
      ).toEqual({ allowed: true, kind: op });
    }
  });

  it("discards a new op whose raw output carries SQL (same fence)", () => {
    for (const op of NEW_OPS) {
      const result = assertEditorOperationAllowed({
        kind: op,
        tableKey: "invoices",
        fieldKey: "status",
        smuggled: "DROP TABLE records;",
      });
      expect(result, op).toEqual({ allowed: false, reason: "rawSqlRejected" });
    }
  });

  it("still rejects an unknown select-shaped op as operationNotAllowed", () => {
    const result = assertEditorOperationAllowed({
      kind: "delete_select_option",
      tableKey: "invoices",
      fieldKey: "status",
    });
    expect(result).toEqual({ allowed: false, reason: "operationNotAllowed" });
  });
});

describe("Story 13.1 — blocklist + whole-word key guard unchanged", () => {
  it("pins the BLOCKED_KEYWORDS set verbatim", () => {
    expect([...BLOCKED_KEYWORDS]).toEqual([
      "DROP",
      "GRANT",
      "TRUNCATE",
      "DELETE",
      "EXEC",
    ]);
  });

  it("a select field with a blocked-verb KEY still rejects; a label that merely embeds one still passes", () => {
    const schema: SchemaDefinition = {
      tables: [
        {
          key: "invoices",
          label: "Invoices",
          fields: [{ key: "amount", label: "Amount", type: "currency" }],
        },
      ],
    };
    // Bare blocked verb as the derived key → reject (whole-word guard unchanged).
    expect(
      validateAddField(schema, "invoices", {
        label: "drop",
        type: "select",
        options: [{ value: "a", label: "A" }],
      }),
    ).toEqual({ valid: false, reason: "addFieldFailed" });
    // A label that merely embeds a verb still passes (Story 2.5 unchanged); the
    // option LABEL "Drop-off" is free text and is never keyword-checked.
    const ok = validateAddField(schema, "invoices", {
      label: "Drop-off status",
      type: "select",
      options: [{ value: "Dropped off", label: "Drop-off done" }],
    });
    expect(ok.valid).toBe(true);
  });

  it("keeps `select` OUT of the scalar + generation type sets (model can't emit it until 13.5)", () => {
    // Load-bearing boundary: `select` is accepted only via its own validator
    // branch, never by membership in these sets, so neither the editor
    // response-schema enum nor the generation enum offers it to the model.
    expect([...SCALAR_FIELD_TYPES]).not.toContain("select");
    expect([...GENERATION_FIELD_TYPES]).not.toContain("select");
  });
});

/**
 * Story 13.4 — the three focused append-only value-management validators. Covers
 * the write rows of the I/O & Edge-Case Matrix: accept + each rejection
 * (duplicate, last-active archive, already-archived, unknown field/option,
 * non-select field).
 */
describe("Story 13.4 — select value-management validators", () => {
  function selectSchema(
    options: { value: string; label: string; archived?: boolean }[],
  ): SchemaDefinition {
    return {
      tables: [
        {
          key: "invoices",
          label: "Invoices",
          fields: [
            { key: "amount", label: "Amount", type: "currency" },
            { key: "status", label: "Status", type: "select", options },
            { key: "notes", label: "Notes", type: "text" },
          ],
        },
        {
          key: "hidden_table",
          label: "Hidden",
          hidden: true,
          fields: [
            { key: "state", label: "State", type: "select", options: [{ value: "a", label: "A" }] },
          ],
        },
      ],
    };
  }

  const twoOptions = [
    { value: "paid", label: "Paid" },
    { value: "unpaid", label: "Unpaid" },
  ];

  describe("validateAddSelectOption", () => {
    it("accepts a new value and normalizes its label to a unique value", () => {
      const result = validateAddSelectOption(
        selectSchema(twoOptions),
        "invoices",
        "status",
        { label: "Partial" },
      );
      expect(result).toEqual({
        valid: true,
        option: { value: "partial", label: "Partial" },
      });
    });

    it("rejects a value colliding with an existing ACTIVE option (not deduped)", () => {
      const result = validateAddSelectOption(
        selectSchema(twoOptions),
        "invoices",
        "status",
        { label: "Paid" },
      );
      expect(result).toEqual({ valid: false, reason: "selectOptionOpFailed" });
    });

    it("rejects a value colliding with an existing ARCHIVED option", () => {
      const result = validateAddSelectOption(
        selectSchema([
          { value: "paid", label: "Paid" },
          { value: "draft", label: "Draft", archived: true },
        ]),
        "invoices",
        "status",
        { label: "Draft" },
      );
      expect(result).toEqual({ valid: false, reason: "selectOptionOpFailed" });
    });

    it("rejects an empty label", () => {
      const result = validateAddSelectOption(
        selectSchema(twoOptions),
        "invoices",
        "status",
        { label: "   " },
      );
      expect(result).toEqual({ valid: false, reason: "selectOptionOpFailed" });
    });

    it("rejects a non-select field target", () => {
      const result = validateAddSelectOption(
        selectSchema(twoOptions),
        "invoices",
        "notes",
        { label: "Partial" },
      );
      expect(result).toEqual({ valid: false, reason: "selectOptionOpFailed" });
    });

    it("rejects an unknown field / hidden table", () => {
      expect(
        validateAddSelectOption(selectSchema(twoOptions), "invoices", "ghost", {
          label: "Partial",
        }),
      ).toEqual({ valid: false, reason: "selectOptionOpFailed" });
      expect(
        validateAddSelectOption(selectSchema(twoOptions), "hidden_table", "state", {
          label: "B",
        }),
      ).toEqual({ valid: false, reason: "selectOptionOpFailed" });
    });
  });

  describe("validateRenameSelectOption", () => {
    it("accepts a rename of an existing option; returns the matched value + new label", () => {
      const result = validateRenameSelectOption(
        selectSchema(twoOptions),
        "invoices",
        "status",
        { value: "paid", label: "Settled" },
      );
      expect(result).toEqual({ valid: true, value: "paid", label: "Settled" });
    });

    it("rejects an unknown option value", () => {
      const result = validateRenameSelectOption(
        selectSchema(twoOptions),
        "invoices",
        "status",
        { value: "ghost", label: "Settled" },
      );
      expect(result).toEqual({ valid: false, reason: "selectOptionOpFailed" });
    });

    it("rejects an empty new label", () => {
      const result = validateRenameSelectOption(
        selectSchema(twoOptions),
        "invoices",
        "status",
        { value: "paid", label: "" },
      );
      expect(result).toEqual({ valid: false, reason: "selectOptionOpFailed" });
    });

    it("rejects a non-select field target", () => {
      const result = validateRenameSelectOption(
        selectSchema(twoOptions),
        "invoices",
        "notes",
        { value: "paid", label: "Settled" },
      );
      expect(result).toEqual({ valid: false, reason: "selectOptionOpFailed" });
    });
  });

  describe("validateArchiveSelectOption", () => {
    it("accepts archiving a non-last active option", () => {
      const result = validateArchiveSelectOption(
        selectSchema(twoOptions),
        "invoices",
        "status",
        { value: "paid" },
      );
      expect(result).toEqual({ valid: true, value: "paid" });
    });

    it("rejects archiving the LAST non-archived option", () => {
      const result = validateArchiveSelectOption(
        selectSchema([
          { value: "paid", label: "Paid" },
          { value: "unpaid", label: "Unpaid", archived: true },
        ]),
        "invoices",
        "status",
        { value: "paid" },
      );
      expect(result).toEqual({ valid: false, reason: "selectOptionOpFailed" });
    });

    it("rejects archiving an already-archived option", () => {
      const result = validateArchiveSelectOption(
        selectSchema([
          { value: "paid", label: "Paid" },
          { value: "draft", label: "Draft", archived: true },
        ]),
        "invoices",
        "status",
        { value: "draft" },
      );
      expect(result).toEqual({ valid: false, reason: "selectOptionOpFailed" });
    });

    it("rejects an unknown option value", () => {
      const result = validateArchiveSelectOption(
        selectSchema(twoOptions),
        "invoices",
        "status",
        { value: "ghost" },
      );
      expect(result).toEqual({ valid: false, reason: "selectOptionOpFailed" });
    });

    it("rejects a non-select field target", () => {
      const result = validateArchiveSelectOption(
        selectSchema(twoOptions),
        "invoices",
        "notes",
        { value: "paid" },
      );
      expect(result).toEqual({ valid: false, reason: "selectOptionOpFailed" });
    });
  });
});
