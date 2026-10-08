import { describe, expect, it, vi } from "vitest";

import {
  filterSeedRows,
  scrubEmDash,
  validateGeneratedSchema,
} from "@/lib/schema/validator";
import type { TableDefinition } from "@/types/db";

/**
 * Unit coverage for the Story 15.3 em-dash guard. The pure `scrubEmDash` helper
 * replaces em/en-dashes with a hyphen-minus and collapses any doubled space, and
 * the whole-schema validator applies it to sanitized table/field/select-option
 * labels so a model that returns `—` never persists one. The seed path
 * (`filterSeedRows`) scrubs string cells while leaving non-string cells untouched.
 * The observability seam is mocked so a rejection never touches Sentry/console.
 */

vi.mock("@/lib/observability/report", () => ({
  reportRejection: vi.fn(),
  reportError: vi.fn(),
}));

describe("scrubEmDash", () => {
  it("replaces an em-dash (U+2014) with a hyphen-minus", () => {
    expect(scrubEmDash("Drop-off — time")).toBe("Drop-off - time");
  });

  it("replaces an en-dash (U+2013) with a hyphen-minus", () => {
    expect(scrubEmDash("Mon–Fri")).toBe("Mon-Fri");
  });

  it("collapses a doubled space the removal may leave", () => {
    // An em-dash flanked by spaces replaced by a hyphen must not leave `  `.
    expect(scrubEmDash("A  B")).toBe("A B");
    expect(scrubEmDash("A — B").includes("  ")).toBe(false);
  });

  it("leaves a string with no dash untouched", () => {
    expect(scrubEmDash("Status")).toBe("Status");
  });

  it("returns a non-string value unchanged (numbers/booleans pass through)", () => {
    expect(scrubEmDash(1234.5)).toBe(1234.5);
    expect(scrubEmDash(true)).toBe(true);
    expect(scrubEmDash(null)).toBe(null);
  });

  it("output never contains an em-dash given an em-dash input", () => {
    expect(scrubEmDash("Quote — total").includes("—")).toBe(false);
  });
});

describe("validateGeneratedSchema em-dash guard", () => {
  it("scrubs em-dashes from table, field, and select-option labels", () => {
    const raw = {
      schema: {
        tables: [
          {
            key: "jobs",
            label: "Jobs — all",
            fields: [
              { key: "title", label: "Title — name", type: "text" },
              {
                key: "status",
                label: "Status — state",
                type: "select",
                options: [{ label: "In — progress", value: "in_progress" }],
              },
            ],
          },
        ],
      },
    };

    const result = validateGeneratedSchema(raw);
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    const table = result.sanitized.tables[0];
    expect(table.label.includes("—")).toBe(false);
    expect(table.label).toBe("Jobs - all");

    const textField = table.fields[0];
    expect(textField.label.includes("—")).toBe(false);

    const selectField = table.fields[1];
    expect(selectField.label.includes("—")).toBe(false);
    expect(selectField.options?.[0].label.includes("—")).toBe(false);
    // No doubled space introduced by the replacement.
    expect(selectField.options?.[0].label.includes("  ")).toBe(false);
  });
});

describe("filterSeedRows em-dash guard", () => {
  const table: TableDefinition = {
    key: "jobs",
    label: "Jobs",
    fields: [
      { key: "title", label: "Title", type: "text" },
      { key: "quoted", label: "Quoted", type: "currency" },
    ],
  };

  it("scrubs em-dashes from string seed values before persist", () => {
    const rows = filterSeedRows(table, [
      { title: "Install — repair", quoted: 1234.5 },
    ]);
    expect(rows).toHaveLength(1);
    expect(String(rows[0].title).includes("—")).toBe(false);
    expect(rows[0].title).toBe("Install - repair");
    // A numeric cell is untouched (not stringified).
    expect(rows[0].quoted).toBe(1234.5);
  });
});
