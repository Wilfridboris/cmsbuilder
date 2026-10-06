import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { EXPORT_PAGE_SIZE, listAllRecords } from "@/lib/data/records";

/**
 * Pagination-to-completeness coverage for `listAllRecords` (Story 8.4) — the
 * "Large table" row of the frozen I/O & Edge-Case Matrix and the non-obvious
 * correctness point of the story: a table larger than the backend's default page
 * cap must export in FULL, never silently truncated at the first page.
 *
 * No live DB: a fake Supabase query builder records each `.range(from, to)` window
 * and returns full pages until a final short page signals exhaustion. Asserts the
 * reader keeps paging, stops at the short page, and returns every row once, in
 * order, scoped by the same org/table/soft-delete filters as `listRecords`.
 */

type RangeCall = { from: number; to: number };

/**
 * Build a fake RLS-scoped client that serves `total` rows for the records table in
 * `EXPORT_PAGE_SIZE` windows. Each builder method returns `this` so the chain
 * (`select().eq().eq().is().order().range()`) resolves; `.range()` is awaited.
 */
function makeClient(total: number) {
  const rangeCalls: RangeCall[] = [];
  const filters: Record<string, unknown> = {};

  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filters[col] = val;
      return builder;
    },
    is: (col: string, val: unknown) => {
      filters[col] = val;
      return builder;
    },
    order: () => builder,
    range: (from: number, to: number) => {
      rangeCalls.push({ from, to });
      const rows = [];
      for (let i = from; i <= to && i < total; i += 1) {
        rows.push({ id: `r${i}`, version: 1, data: { n: i } });
      }
      return Promise.resolve({ data: rows, error: null });
    },
  };

  const client = {
    from: () => builder,
  } as unknown as SupabaseClient;

  return { client, rangeCalls, filters };
}

describe("listAllRecords (Story 8.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pages past the default cap and returns EVERY row in order (no truncation)", async () => {
    // 2.5 windows worth of rows -> exercises multiple pages ending in a short one.
    const total = EXPORT_PAGE_SIZE * 2 + 37;
    const { client, rangeCalls } = makeClient(total);

    const result = await listAllRecords(client, "org-1", "clients");

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(total);
    // Every row appears exactly once, oldest-first, id preserved.
    expect(result.data?.[0]?.id).toBe("r0");
    expect(result.data?.[total - 1]?.id).toBe(`r${total - 1}`);
    // It kept paging until a short page: three windows for 2*cap + 37.
    expect(rangeCalls).toEqual([
      { from: 0, to: EXPORT_PAGE_SIZE - 1 },
      { from: EXPORT_PAGE_SIZE, to: EXPORT_PAGE_SIZE * 2 - 1 },
      { from: EXPORT_PAGE_SIZE * 2, to: EXPORT_PAGE_SIZE * 3 - 1 },
    ]);
  });

  it("stops after a single full page when the next page is empty", async () => {
    // Exactly one full page: the reader must request a second window, see it
    // empty, and stop — not loop forever on a boundary-sized table.
    const { client, rangeCalls } = makeClient(EXPORT_PAGE_SIZE);

    const result = await listAllRecords(client, "org-1", "clients");

    expect(result.data).toHaveLength(EXPORT_PAGE_SIZE);
    expect(rangeCalls).toHaveLength(2);
    expect(rangeCalls[1]).toEqual({
      from: EXPORT_PAGE_SIZE,
      to: EXPORT_PAGE_SIZE * 2 - 1,
    });
  });

  it("applies the same org / table_key / soft-delete scope as listRecords", async () => {
    const { client, filters } = makeClient(3);

    await listAllRecords(client, "org-9", "Clients");

    expect(filters.organization_id).toBe("org-9");
    // table_key is normalized on read (as listRecords does).
    expect(filters.table_key).toBe("clients");
    expect(filters.deleted_at).toBeNull();
  });

  it("surfaces a read error as the envelope error string (no raw SQL)", async () => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      order: () => builder,
      range: () =>
        Promise.resolve({ data: null, error: { message: "boom" } }),
    };
    const client = { from: () => builder } as unknown as SupabaseClient;

    const result = await listAllRecords(client, "org-1", "clients");

    expect(result.data).toBeNull();
    expect(result.error).toBe("Failed to load records.");
  });
});
