import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/lib/observability/report", () => ({ reportError }));

import { countIssuedInvoicesInPeriod } from "@/lib/data/invoices";

/**
 * Coverage for Story 7.5's `countIssuedInvoicesInPeriod` (FR55 volume signal) against
 * the frozen matrix: it counts `status in ('issued','paid')` by `issue_date` in the
 * half-open window `[start, end)`, excludes draft/void and out-of-window rows, and
 * degrades a read error to 0 so the advisory prompt never blocks the page.
 *
 * The chainable client stub records the filters the query applied and returns a
 * configurable `{ count, error }`, mirroring PostgREST's `count: "exact", head: true`.
 */

type CountResult = { count: number | null; error: unknown };

function makeClient(result: CountResult) {
  const calls: {
    table?: string;
    selectOpts?: unknown;
    eq?: [string, unknown];
    in?: [string, unknown];
    gte?: [string, unknown];
    lt?: [string, unknown];
  } = {};

  const builder: Record<string, unknown> = {
    select: (_cols: string, opts: unknown) => {
      calls.selectOpts = opts;
      return builder;
    },
    eq: (col: string, val: unknown) => {
      calls.eq = [col, val];
      return builder;
    },
    in: (col: string, val: unknown) => {
      calls.in = [col, val];
      return builder;
    },
    gte: (col: string, val: unknown) => {
      calls.gte = [col, val];
      return builder;
    },
    lt: (col: string, val: unknown) => {
      calls.lt = [col, val];
      return Promise.resolve(result);
    },
  };

  const client = {
    from(table: string) {
      calls.table = table;
      return builder;
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

const ORG = "org-1";
const START = "2026-08-01";
const END = "2026-09-01";

describe("countIssuedInvoicesInPeriod", () => {
  it("returns the exact issued+paid count for the window", async () => {
    const { client, calls } = makeClient({ count: 23, error: null });
    const n = await countIssuedInvoicesInPeriod(client, ORG, START, END);

    expect(n).toBe(23);
    // It scopes to the org, the issued states, and the half-open date window.
    expect(calls.table).toBe("invoices");
    expect(calls.eq).toEqual(["organization_id", ORG]);
    expect(calls.in).toEqual(["status", ["issued", "paid"]]);
    expect(calls.gte).toEqual(["issue_date", START]);
    expect(calls.lt).toEqual(["issue_date", END]);
    // Counted via a head request (no rows transferred).
    expect(calls.selectOpts).toMatchObject({ count: "exact", head: true });
  });

  it("treats a null count as 0", async () => {
    const { client } = makeClient({ count: null, error: null });
    expect(await countIssuedInvoicesInPeriod(client, ORG, START, END)).toBe(0);
  });

  it("degrades a read error to 0 and reports it (never blocks, never silent)", async () => {
    reportError.mockClear();
    const err = { message: "boom" };
    const { client } = makeClient({ count: null, error: err });
    expect(await countIssuedInvoicesInPeriod(client, ORG, START, END)).toBe(0);
    // A broken count would silently disable the FR55 prompt; it must be observable.
    expect(reportError).toHaveBeenCalledWith(
      err,
      expect.objectContaining({ op: "countIssuedInvoicesInPeriod", orgId: ORG }),
    );
  });
});
