import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  RELATION_SEARCH_LIMIT,
  resolveRecordLabels,
  searchRelationRecords,
} from "@/lib/data/records";

/**
 * Unit coverage for the Story 3.7 relation read layer — the typeahead
 * (`searchRelationRecords`) and the batched label lookup (`resolveRecordLabels`).
 * No live DB: a chainable thenable stub captures the PostgREST filter chain and
 * resolves to a scripted `{ data, error }`. Locks the AC5 safety contract
 * (`deleted_at IS NULL` + org/table scoping, ILIKE escaping, blank-value drop,
 * id dedup + empty short-circuit).
 */

type BuilderResult = { data: unknown; error: unknown };

function makeClient(result: BuilderResult) {
  const calls: Record<string, unknown[][]> = {};
  const rec = (m: string, args: unknown[]) => {
    (calls[m] ??= []).push(args);
  };
  const builder: Record<string, unknown> = {
    from: (...a: unknown[]) => (rec("from", a), builder),
    select: (...a: unknown[]) => (rec("select", a), builder),
    eq: (...a: unknown[]) => (rec("eq", a), builder),
    is: (...a: unknown[]) => (rec("is", a), builder),
    ilike: (...a: unknown[]) => (rec("ilike", a), builder),
    order: (...a: unknown[]) => (rec("order", a), builder),
    limit: (...a: unknown[]) => (rec("limit", a), builder),
    in: (...a: unknown[]) => (rec("in", a), builder),
    then: (resolve: (v: BuilderResult) => unknown) =>
      Promise.resolve(result).then(resolve),
  };
  return { client: builder as unknown as SupabaseClient, calls };
}

describe("searchRelationRecords", () => {
  it("scopes org + table + deleted_at, orders + limits, and maps rows to {id,label}", async () => {
    const { client, calls } = makeClient({
      data: [
        { id: "c1", data: { name: "Alpha" } },
        { id: "c2", data: { name: "Beta" } },
      ],
      error: null,
    });

    const res = await searchRelationRecords(client, "org-1", "clients", "name", "");

    expect(res.error).toBeNull();
    expect(res.data).toEqual([
      { id: "c1", label: "Alpha" },
      { id: "c2", label: "Beta" },
    ]);
    expect(calls.eq).toContainEqual(["organization_id", "org-1"]);
    expect(calls.eq).toContainEqual(["table_key", "clients"]);
    expect(calls.is).toContainEqual(["deleted_at", null]);
    expect(calls.order).toContainEqual(["data->>name", { ascending: true }]);
    expect(calls.limit).toContainEqual([RELATION_SEARCH_LIMIT]);
    // An empty query lists the first N — no ILIKE narrowing.
    expect(calls.ilike).toBeUndefined();
  });

  it("escapes ILIKE wildcards so a '50%' query is a literal substring, not match-all", async () => {
    const { client, calls } = makeClient({ data: [], error: null });

    await searchRelationRecords(client, "org-1", "clients", "name", "50%");

    // %, _, and \ in the user query are escaped; the surrounding %…% stay wild.
    expect(calls.ilike).toContainEqual(["data->>name", "%50\\%%"]);
  });

  it("drops rows whose display value is missing or blank", async () => {
    const { client } = makeClient({
      data: [
        { id: "c1", data: { name: "Alpha" } },
        { id: "c2", data: { name: "   " } },
        { id: "c3", data: {} },
        { id: "c4", data: null },
      ],
      error: null,
    });

    const res = await searchRelationRecords(client, "org-1", "clients", "name", "");

    expect(res.data).toEqual([{ id: "c1", label: "Alpha" }]);
  });

  it("returns an error envelope (no raw SQL) when the query fails", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });

    const res = await searchRelationRecords(client, "org-1", "clients", "name", "x");

    expect(res.data).toBeNull();
    expect(res.error).toBe("Failed to search records.");
    expect(res.error).not.toContain("boom");
  });
});

describe("resolveRecordLabels", () => {
  it("short-circuits to an empty result for an empty id list (no query)", async () => {
    const { client, calls } = makeClient({ data: [], error: null });

    const res = await resolveRecordLabels(client, "org-1", "clients", "name", []);

    expect(res).toEqual({ data: [], error: null });
    expect(calls.from).toBeUndefined();
  });

  it("dedups ids and scopes org + table + deleted_at for a batched IN lookup", async () => {
    const { client, calls } = makeClient({
      data: [
        { id: "c1", data: { name: "Alpha" } },
        { id: "c2", data: { name: "Beta" } },
      ],
      error: null,
    });

    const res = await resolveRecordLabels(client, "org-1", "clients", "name", [
      "c1",
      "c2",
      "c1",
      "",
    ]);

    expect(res.error).toBeNull();
    expect(res.data).toEqual([
      { id: "c1", label: "Alpha" },
      { id: "c2", label: "Beta" },
    ]);
    expect(calls.in).toContainEqual(["id", ["c1", "c2"]]);
    expect(calls.eq).toContainEqual(["organization_id", "org-1"]);
    expect(calls.eq).toContainEqual(["table_key", "clients"]);
    expect(calls.is).toContainEqual(["deleted_at", null]);
  });

  it("drops blank display values and returns an error envelope on failure", async () => {
    const ok = makeClient({
      data: [
        { id: "c1", data: { name: "Alpha" } },
        { id: "c2", data: { name: "" } },
      ],
      error: null,
    });
    const okRes = await resolveRecordLabels(ok.client, "org-1", "clients", "name", [
      "c1",
      "c2",
    ]);
    expect(okRes.data).toEqual([{ id: "c1", label: "Alpha" }]);

    const bad = makeClient({ data: null, error: { message: "db down" } });
    const badRes = await resolveRecordLabels(bad.client, "org-1", "clients", "name", [
      "c1",
    ]);
    expect(badRes.data).toBeNull();
    expect(badRes.error).toBe("Failed to resolve labels.");
    expect(badRes.error).not.toContain("db down");
  });
});
