import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  REFERENCE_COUNT_CAP,
  countReferencingRecords,
  enumerateInboundRelations,
  listRecords,
  type RelationFilter,
} from "@/lib/data/records";
import type { SchemaDefinition } from "@/types/db";

/**
 * Unit coverage for the Story 3.8 safe-delete + filter-by-relationship data layer:
 *   - `enumerateInboundRelations` (pure) — multi-table, none, self-reference;
 *   - `countReferencingRecords` — per-pair containment count, `deleted_at` filter,
 *     org/table scoping, and the cap short-circuit;
 *   - `listRecords` relation-filter chaining via `.contains` (JSONB `@>`), never
 *     `data->>key`.
 *
 * No live DB: a chainable thenable stub captures the PostgREST filter chain and
 * resolves to a scripted `{ data, count, error }`, mirroring `records-relations`.
 */

type BuilderResult = { data?: unknown; count?: number | null; error: unknown };

function makeClient(results: BuilderResult[]) {
  const calls: Record<string, unknown[][]> = {};
  let callIndex = 0;
  const rec = (m: string, args: unknown[]) => {
    (calls[m] ??= []).push(args);
  };
  const makeBuilder = () => {
    const result = results[Math.min(callIndex, results.length - 1)];
    const builder: Record<string, unknown> = {
      from: (...a: unknown[]) => (rec("from", a), builder),
      select: (...a: unknown[]) => (rec("select", a), builder),
      eq: (...a: unknown[]) => (rec("eq", a), builder),
      is: (...a: unknown[]) => (rec("is", a), builder),
      contains: (...a: unknown[]) => (rec("contains", a), builder),
      order: (...a: unknown[]) => (rec("order", a), builder),
      in: (...a: unknown[]) => (rec("in", a), builder),
      then: (resolve: (v: BuilderResult) => unknown) => {
        const r = result;
        callIndex += 1;
        return Promise.resolve(r).then(resolve);
      },
    };
    return builder;
  };
  // Each `.from("records")` starts a fresh chain (a new count query per pair).
  const root: Record<string, unknown> = {
    from: (...a: unknown[]) => {
      rec("from", a);
      const b = makeBuilder();
      // The root `from` was already recorded above by rec; return a builder whose
      // own `from` is a no-op re-entry (records.ts calls `.from` once per query).
      return b;
    },
  };
  return { client: root as unknown as SupabaseClient, calls };
}

const schema: SchemaDefinition = {
  tables: [
    {
      key: "clients",
      label: "Clients",
      fields: [{ key: "name", label: "Name", type: "text" }],
    },
    {
      key: "jobs",
      label: "Jobs",
      fields: [
        { key: "title", label: "Title", type: "text" },
        {
          key: "client",
          label: "Client",
          type: "relation",
          relationConfig: { targetTable: "clients", cardinality: "one" },
        },
      ],
    },
    {
      key: "invoices",
      label: "Invoices",
      fields: [
        {
          key: "job",
          label: "Job",
          type: "relation",
          relationConfig: { targetTable: "jobs", cardinality: "one" },
        },
        {
          key: "client",
          label: "Client",
          type: "relation",
          relationConfig: { targetTable: "clients", cardinality: "one" },
        },
      ],
    },
  ],
};

describe("enumerateInboundRelations", () => {
  it("finds every (table, field) pair whose relation targets the table", () => {
    expect(enumerateInboundRelations(schema, "clients")).toEqual([
      { tableKey: "jobs", fieldKey: "client" },
      { tableKey: "invoices", fieldKey: "client" },
    ]);
  });

  it("returns an empty list for a table nothing references", () => {
    expect(enumerateInboundRelations(schema, "invoices")).toEqual([]);
  });

  it("includes a self-referencing relation field", () => {
    const selfSchema: SchemaDefinition = {
      tables: [
        {
          key: "tasks",
          label: "Tasks",
          fields: [
            {
              key: "parent",
              label: "Parent",
              type: "relation",
              relationConfig: { targetTable: "tasks", cardinality: "one" },
            },
          ],
        },
      ],
    };
    expect(enumerateInboundRelations(selfSchema, "tasks")).toEqual([
      { tableKey: "tasks", fieldKey: "parent" },
    ]);
  });

  it("normalizes the target key so an un-normalized caller still matches", () => {
    expect(enumerateInboundRelations(schema, "Clients")).toEqual([
      { tableKey: "jobs", fieldKey: "client" },
      { tableKey: "invoices", fieldKey: "client" },
    ]);
  });
});

describe("countReferencingRecords", () => {
  it("sums per-pair containment counts, scoping org + table + deleted_at", async () => {
    // clients has two inbound pairs (jobs.client, invoices.client): 3 + 2 = 5.
    const { client, calls } = makeClient([
      { count: 3, error: null },
      { count: 2, error: null },
    ]);

    const res = await countReferencingRecords(client, "org-1", schema, "clients", "c1");

    expect(res.error).toBeNull();
    expect(res.data).toBe(5);
    // Containment (never data->>key) on each pair's field.
    expect(calls.contains).toContainEqual(["data", { client: "c1" }]);
    expect(calls.eq).toContainEqual(["organization_id", "org-1"]);
    expect(calls.eq).toContainEqual(["table_key", "jobs"]);
    expect(calls.eq).toContainEqual(["table_key", "invoices"]);
    expect(calls.is).toContainEqual(["deleted_at", null]);
    // Head-count select shape.
    expect(calls.select).toContainEqual(["id", { count: "exact", head: true }]);
  });

  it("returns 0 when no rows reference the target", async () => {
    const { client } = makeClient([
      { count: 0, error: null },
      { count: 0, error: null },
    ]);
    const res = await countReferencingRecords(client, "org-1", schema, "clients", "c9");
    expect(res).toEqual({ data: 0, error: null });
  });

  it("short-circuits at the cap and stops issuing further queries", async () => {
    // First pair already exceeds the cap; the second pair must NOT be queried.
    const { client, calls } = makeClient([
      { count: REFERENCE_COUNT_CAP + 10, error: null },
      { count: 999, error: null },
    ]);

    const res = await countReferencingRecords(client, "org-1", schema, "clients", "c1");

    expect(res.data).toBe(REFERENCE_COUNT_CAP);
    // Only the first pair's query ran (one `from`), the second was skipped.
    expect(calls.from).toHaveLength(1);
  });

  it("returns an error envelope (no raw SQL) when a count query fails", async () => {
    const { client } = makeClient([{ count: null, error: { message: "boom" } }]);
    const res = await countReferencingRecords(client, "org-1", schema, "clients", "c1");
    expect(res.data).toBeNull();
    expect(res.error).toBe("Failed to count references.");
    expect(res.error).not.toContain("boom");
  });

  it("returns 0 with no queries when nothing references the table", async () => {
    const { client, calls } = makeClient([{ count: 0, error: null }]);
    const res = await countReferencingRecords(client, "org-1", schema, "invoices", "i1");
    expect(res).toEqual({ data: 0, error: null });
    expect(calls.from).toBeUndefined();
  });
});

describe("listRecords — relation filter chaining", () => {
  it("applies each relation filter as a JSONB containment (never data->>key)", async () => {
    const { client, calls } = makeClient([
      { data: [{ id: "j1", version: 1, data: { client: "c1" } }], error: null },
    ]);

    const filters: RelationFilter[] = [
      { field: "client", targetId: "c1" },
      { field: "lead", targetId: "u9" },
    ];
    const res = await listRecords(client, "org-1", "jobs", filters);

    expect(res.error).toBeNull();
    expect(res.data).toEqual([{ id: "j1", version: 1, data: { client: "c1" } }]);
    expect(calls.contains).toContainEqual(["data", { client: "c1" }]);
    expect(calls.contains).toContainEqual(["data", { lead: "u9" }]);
    expect(calls.eq).toContainEqual(["organization_id", "org-1"]);
    expect(calls.eq).toContainEqual(["table_key", "jobs"]);
    expect(calls.is).toContainEqual(["deleted_at", null]);
    expect(calls.order).toContainEqual(["created_at", { ascending: true }]);
  });

  it("issues no containment when there are no relation filters", async () => {
    const { client, calls } = makeClient([{ data: [], error: null }]);
    await listRecords(client, "org-1", "jobs");
    expect(calls.contains).toBeUndefined();
  });
});
