import { describe, expect, it } from "vitest";

import type { FieldCatalog, ImportProposal } from "@/types/import";
import {
  initialDecisions,
  unresolvedColumns,
  isReadyToImport,
  resolveFieldLabel,
  type DecisionMap,
} from "@/lib/import/resolve";

/**
 * Unit coverage for the pure resolution helpers (Story 4.3). Exercises the whole
 * I/O matrix: seeding decisions from a proposal (confident vs. flagged), remap,
 * skip, the unresolved gate, readiness, and catalog label lookup + fallback +
 * empty catalog. No React/HTTP harness — this module is framework-free.
 */

/** A proposal with one confident, one low-confidence-flagged, one unmatched column. */
function makeProposal(): ImportProposal {
  return {
    rowCount: 10,
    mappings: [
      {
        sourceColumn: "Full Name",
        target: { table: "clients", field: "name" },
        confidence: 0.95,
        reason: "name-like",
      },
      {
        sourceColumn: "Contact",
        target: { table: "clients", field: "email" },
        confidence: 0.4,
        reason: "maybe email",
      },
      {
        sourceColumn: "Notes",
        target: null,
        confidence: 0,
        reason: "nothing fits",
      },
    ],
    // Contact is below-threshold (tentative target), Notes is unmatched.
    unmapped: ["Contact", "Notes"],
  };
}

const CATALOG: FieldCatalog = [
  {
    tableKey: "clients",
    tableLabel: "Clients",
    fields: [
      { key: "name", label: "Customer Name", type: "text" },
      { key: "email", label: "Email Address", type: "email" },
    ],
  },
];

describe("initialDecisions", () => {
  it("seeds a confident column as a map decision with its target", () => {
    const d = initialDecisions(makeProposal());
    expect(d["Full Name"]).toEqual({
      kind: "map",
      table: "clients",
      field: "name",
    });
  });

  it("seeds a flagged low-confidence column (with tentative target) as unresolved", () => {
    const d = initialDecisions(makeProposal());
    expect(d["Contact"]).toEqual({ kind: "unresolved" });
  });

  it("seeds a flagged unmatched (null target) column as unresolved", () => {
    const d = initialDecisions(makeProposal());
    expect(d["Notes"]).toEqual({ kind: "unresolved" });
  });
});

describe("unresolvedColumns / isReadyToImport", () => {
  it("lists only flagged columns that are still unresolved, in column order", () => {
    const proposal = makeProposal();
    const d = initialDecisions(proposal);
    expect(unresolvedColumns(proposal, d)).toEqual(["Contact", "Notes"]);
    expect(isReadyToImport(proposal, d)).toBe(false);
  });

  it("a confident column never blocks even though it is not in unmapped", () => {
    const proposal = makeProposal();
    const d = initialDecisions(proposal);
    // Full Name is confident and resolved; it never appears as remaining.
    expect(unresolvedColumns(proposal, d)).not.toContain("Full Name");
  });

  it("remapping a flagged column to a field resolves it (drops from remaining)", () => {
    const proposal = makeProposal();
    const d: DecisionMap = {
      ...initialDecisions(proposal),
      Contact: { kind: "map", table: "clients", field: "email" },
    };
    expect(unresolvedColumns(proposal, d)).toEqual(["Notes"]);
    expect(isReadyToImport(proposal, d)).toBe(false);
  });

  it("skipping a flagged column resolves it (drops from remaining)", () => {
    const proposal = makeProposal();
    const d: DecisionMap = {
      ...initialDecisions(proposal),
      Notes: { kind: "skip" },
    };
    expect(unresolvedColumns(proposal, d)).toEqual(["Contact"]);
  });

  it("is ready once every flagged column is mapped or skipped", () => {
    const proposal = makeProposal();
    const d: DecisionMap = {
      ...initialDecisions(proposal),
      Contact: { kind: "map", table: "clients", field: "email" },
      Notes: { kind: "skip" },
    };
    expect(unresolvedColumns(proposal, d)).toEqual([]);
    expect(isReadyToImport(proposal, d)).toBe(true);
  });

  it("a proposal with no flagged columns is ready immediately", () => {
    const proposal: ImportProposal = {
      rowCount: 2,
      mappings: [
        {
          sourceColumn: "Name",
          target: { table: "clients", field: "name" },
          confidence: 0.9,
        },
      ],
      unmapped: [],
    };
    const d = initialDecisions(proposal);
    expect(isReadyToImport(proposal, d)).toBe(true);
  });
});

describe("resolveFieldLabel", () => {
  it("returns the human label when the key is in the catalog", () => {
    expect(resolveFieldLabel(CATALOG, "clients", "name")).toBe("Customer Name");
  });

  it("falls back to the raw field key when the field is not in the catalog", () => {
    expect(resolveFieldLabel(CATALOG, "clients", "unknown")).toBe("unknown");
  });

  it("falls back to the raw field key when the table is not in the catalog", () => {
    expect(resolveFieldLabel(CATALOG, "invoices", "total")).toBe("total");
  });

  it("falls back to the raw field key with an empty catalog", () => {
    expect(resolveFieldLabel([], "clients", "name")).toBe("name");
  });
});
