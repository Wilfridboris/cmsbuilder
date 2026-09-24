import { describe, expect, it, vi } from "vitest";

import {
  BLOCKED_KEYWORDS,
  RESERVED_KEYS,
  filterSeedRows,
  validateGeneratedSchema,
} from "@/lib/schema/validator";
import type { TableDefinition } from "@/types/db";

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
  it("rejects the relation field type", () => {
    const raw = validSchema();
    raw.schema.tables[0].fields[0].type = "relation";
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

  it("rejects a blocked keyword in a field label or key", () => {
    for (const kw of BLOCKED_KEYWORDS) {
      const raw = validSchema();
      raw.schema.tables[0].fields[0].label = `Notes ${kw} here`;
      const result = validateGeneratedSchema(raw);
      expect(result.valid, `blocked keyword ${kw} must reject`).toBe(false);
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
