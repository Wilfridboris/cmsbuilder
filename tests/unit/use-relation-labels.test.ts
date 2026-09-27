import { describe, expect, it } from "vitest";

import { collectRelationIdsByTarget } from "@/components/dashboard/useRelationLabels";
import type { FieldDefinition, RecordData } from "@/types/db";

/**
 * Unit coverage for the pure referenced-id-extraction helper behind
 * `useRelationLabels` (Story 3.7). It collects the DISTINCT, non-empty target ids
 * referenced by a table's relation fields, grouped by `targetTable`, so the hook
 * can issue one batched `id IN (...)` fetch per target table. No React / network.
 */

function field(
  key: string,
  type: FieldDefinition["type"],
  targetTable?: string,
): FieldDefinition {
  return {
    key,
    label: key,
    type,
    ...(targetTable
      ? { relationConfig: { targetTable, cardinality: "one" as const } }
      : {}),
  };
}

function row(data: Record<string, unknown>): RecordData {
  return { id: `r-${Math.random()}`, version: 1, data };
}

describe("collectRelationIdsByTarget", () => {
  it("returns an empty map when there are no relation fields", () => {
    const fields = [field("name", "text"), field("price", "currency")];
    const rows = [row({ name: "A", price: 1 })];
    expect(collectRelationIdsByTarget(fields, rows).size).toBe(0);
  });

  it("collects distinct ids per target table", () => {
    const fields = [
      field("name", "text"),
      field("client", "relation", "clients"),
    ];
    const rows = [
      row({ client: "c1" }),
      row({ client: "c2" }),
      row({ client: "c1" }), // duplicate → deduped
    ];
    const result = collectRelationIdsByTarget(fields, rows);
    expect(result.get("clients")).toEqual(["c1", "c2"]);
  });

  it("groups two relation fields pointing at the same table into one bucket", () => {
    const fields = [
      field("client", "relation", "clients"),
      field("referrer", "relation", "clients"),
    ];
    const rows = [row({ client: "c1", referrer: "c2" })];
    const result = collectRelationIdsByTarget(fields, rows);
    expect(result.size).toBe(1);
    expect(result.get("clients")).toEqual(["c1", "c2"]);
  });

  it("keeps separate buckets for distinct target tables", () => {
    const fields = [
      field("client", "relation", "clients"),
      field("job", "relation", "jobs"),
    ];
    const rows = [row({ client: "c1", job: "j1" })];
    const result = collectRelationIdsByTarget(fields, rows);
    expect(result.get("clients")).toEqual(["c1"]);
    expect(result.get("jobs")).toEqual(["j1"]);
  });

  it("ignores empty, null, and whitespace-only values", () => {
    const fields = [field("client", "relation", "clients")];
    const rows = [
      row({ client: "" }),
      row({ client: null }),
      row({ client: "   " }),
      row({ client: "c9" }),
      row({}), // key absent
    ];
    expect(collectRelationIdsByTarget(fields, rows).get("clients")).toEqual([
      "c9",
    ]);
  });

  it("returns a sorted id list for a stable query key", () => {
    const fields = [field("client", "relation", "clients")];
    const rows = [row({ client: "c3" }), row({ client: "c1" }), row({ client: "c2" })];
    expect(collectRelationIdsByTarget(fields, rows).get("clients")).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
  });
});
