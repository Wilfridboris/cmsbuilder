import { describe, expect, it, vi } from "vitest";

import {
  BLOCKED_KEYWORDS,
  PERMITTED_OPERATIONS,
  RESERVED_KEYS,
  assertEditorOperationAllowed,
  containsRawSql,
  filterSeedRows,
  isPermittedOperation,
  validateAddField,
  validateGeneratedSchema,
} from "@/lib/schema/validator";
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
  it("names exactly the three additive editor ops", () => {
    expect([...PERMITTED_OPERATIONS]).toEqual([
      "add_field",
      "add_table",
      "add_view",
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
