import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for `POST /api/import/commit` (Story 4.4) WITHOUT a live DB, auth
 * provider, or LLM — mirroring `route-import-propose.test.ts`. Mocks the caller
 * identity, the RLS org read + synthetic-clear update, `requireAdmin`, the pure
 * parser, `getSchema`, and the guarded `bulkInsertRecords`. Locks the frozen
 * boundaries the handler owns:
 *   - 401/403 gate BEFORE any parse / getSchema / write;
 *   - the row cap (> MAX_IMPORT_ROWS) rejected before any write (413);
 *   - happy commit → bulk-insert called then synthetic soft-delete scoped to the
 *     affected tables + SYSTEM_ACTOR_ID; returns the per-table CommitResult;
 *   - idempotent retry: same file + same import_id → same summary, no duplicate;
 *   - error-key → status mapping (unresolved 400, schema-drift 409, commitFailed 500).
 */

const getCurrentUser = vi.fn();
const requireAdmin = vi.fn();
const parseSpreadsheet = vi.fn();
const getSchema = vi.fn();
const bulkInsertRecords = vi.fn();

type MaybeSingle = { data: unknown; error: unknown };
let orgRead: MaybeSingle; // organizations lookup under the RLS client
let clearError: unknown; // error returned by the synthetic-clear update
// Captures the synthetic-clear filters so a test can assert scope.
let clearCall: {
  update?: Record<string, unknown>;
  eqs: Array<[string, unknown]>;
  is?: [string, unknown];
  in?: [string, unknown[]];
} | null;
// Optional hook fired when the synthetic-clear statement actually runs (its `.in`
// terminal), so an ordering test can record the clear relative to the insert.
let onClear: (() => void) | null = null;

function makeClient() {
  return {
    from(table: string) {
      // organizations → the org read; records → the synthetic-clear update chain.
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => orgRead }),
          }),
        };
      }
      // records.update(...).eq(...).eq(...).is(...).in(...)
      const call: NonNullable<typeof clearCall> = { eqs: [] };
      clearCall = call;
      const chain = {
        update(values: Record<string, unknown>) {
          call.update = values;
          return chain;
        },
        eq(col: string, val: unknown) {
          call.eqs.push([col, val]);
          return chain;
        },
        is(col: string, val: unknown) {
          call.is = [col, val];
          return chain;
        },
        in(col: string, vals: unknown[]) {
          call.in = [col, vals];
          onClear?.();
          return Promise.resolve({ error: clearError });
        },
      };
      return chain;
    },
  };
}

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => makeClient(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/lib/auth/rbac", () => ({ requireAdmin }));
vi.mock("@/lib/import/parse", async () => {
  const actual = await vi.importActual<typeof import("@/lib/import/parse")>(
    "@/lib/import/parse",
  );
  return { ...actual, parseSpreadsheet };
});
vi.mock("@/lib/data/records", () => ({ getSchema }));
vi.mock("@/lib/data/mutate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/mutate")>(
    "@/lib/data/mutate",
  );
  return { ...actual, bulkInsertRecords };
});
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const SCHEMA = {
  tables: [
    {
      key: "clients",
      label: "Clients",
      fields: [
        { key: "name", label: "Name", type: "text" },
        { key: "email", label: "Email", type: "email" },
      ],
    },
    {
      key: "invoices",
      label: "Invoices",
      fields: [{ key: "total", label: "Total", type: "currency" }],
    },
  ],
};

function fakeFile(
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
  sizeOverride?: number,
): File {
  const file = new File([bytes], name);
  if (sizeOverride !== undefined) {
    Object.defineProperty(file, "size", { value: sizeOverride });
  }
  return file;
}

const DECISIONS = JSON.stringify({
  "Full Name": { kind: "map", table: "clients", field: "name" },
});

function importReq(entries: Record<string, string | File | null>): NextRequest {
  const form = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (v !== null) form.set(k, v);
  }
  return { formData: async () => form } as unknown as NextRequest;
}

function baseReq(overrides: Record<string, string | File | null> = {}) {
  return importReq({
    slug: "acme",
    file: fakeFile("customers.csv", new Uint8Array([1])),
    decisions: DECISIONS,
    import_id: "imp-1",
    ...overrides,
  });
}

let POST: typeof import("@/app/api/import/commit/route").POST;

beforeEach(async () => {
  vi.clearAllMocks();
  orgRead = { data: { id: "org-1" }, error: null };
  clearError = null;
  clearCall = null;
  onClear = null;
  getCurrentUser.mockResolvedValue({ id: "user-1" });
  requireAdmin.mockResolvedValue({ orgId: "org-1", slug: "acme", role: "admin" });
  getSchema.mockResolvedValue({ data: SCHEMA, error: null });
  parseSpreadsheet.mockReturnValue({
    columns: ["Full Name"],
    rows: [{ "Full Name": "Ada" }, { "Full Name": "Bea" }],
    sheetName: "customers",
  });
  bulkInsertRecords.mockResolvedValue({ data: { insertedCount: 2 }, error: null });
  ({ POST } = await import("@/app/api/import/commit/route"));
});

async function body(res: Awaited<ReturnType<typeof POST>>) {
  return (await res.json()) as { data: unknown; error: string | null };
}

describe("POST /api/import/commit — auth gate (before any parse/write)", () => {
  it("401 unauthorized when there is no session", async () => {
    getCurrentUser.mockResolvedValue(null);
    const res = await POST(importReq({ slug: "acme" }));
    expect(res.status).toBe(401);
    expect((await body(res)).error).toBe("unauthorized");
    expect(parseSpreadsheet).not.toHaveBeenCalled();
    expect(bulkInsertRecords).not.toHaveBeenCalled();
  });

  it("403 when the slug resolves to no org under RLS (non-member)", async () => {
    orgRead = { data: null, error: null };
    const res = await POST(baseReq());
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("forbidden");
    expect(parseSpreadsheet).not.toHaveBeenCalled();
    expect(bulkInsertRecords).not.toHaveBeenCalled();
  });

  it("403 when the caller is a Member (requireAdmin throws)", async () => {
    const { AppError } = await import("@/types/api");
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const res = await POST(baseReq());
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("forbidden");
    expect(bulkInsertRecords).not.toHaveBeenCalled();
  });

  it("403 when an Admin's membership is for a different slug", async () => {
    requireAdmin.mockResolvedValue({ orgId: "org-2", slug: "other", role: "admin" });
    const res = await POST(baseReq());
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("forbidden");
    expect(bulkInsertRecords).not.toHaveBeenCalled();
  });

  it("403 readOnly for a read_only org, before any parse/write (Story 7.4)", async () => {
    orgRead = {
      data: { id: "org-1", subscription_status: "read_only", trial_expires_at: null },
      error: null,
    };
    const res = await POST(baseReq());
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("readOnly");
    expect(parseSpreadsheet).not.toHaveBeenCalled();
    expect(bulkInsertRecords).not.toHaveBeenCalled();
  });
});

describe("POST /api/import/commit — guard & row cap", () => {
  it("400 noFile when the file part is missing", async () => {
    const res = await POST(
      importReq({ slug: "acme", decisions: DECISIONS, import_id: "imp-1" }),
    );
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("Import.error.noFile");
    expect(bulkInsertRecords).not.toHaveBeenCalled();
  });

  it("400 unreadable when import_id is missing", async () => {
    const res = await POST(baseReq({ import_id: null }));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("Import.error.unreadable");
    expect(bulkInsertRecords).not.toHaveBeenCalled();
  });

  it("400 unreadable when decisions JSON is malformed", async () => {
    const res = await POST(baseReq({ decisions: "{not json" }));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("Import.error.unreadable");
    expect(bulkInsertRecords).not.toHaveBeenCalled();
  });

  it("413 tooManyRows when parsed rows exceed the cap (before write)", async () => {
    const { MAX_IMPORT_ROWS } = await import("@/app/api/import/schemas");
    parseSpreadsheet.mockReturnValue({
      columns: ["Full Name"],
      rows: Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ({
        "Full Name": "x",
      })),
      sheetName: "customers",
    });
    const res = await POST(baseReq());
    expect(res.status).toBe(413);
    expect((await body(res)).error).toBe("Import.error.tooManyRows");
    expect(bulkInsertRecords).not.toHaveBeenCalled();
  });
});

describe("POST /api/import/commit — happy commit", () => {
  it("inserts then clears synthetic rows scoped to affected tables + SYSTEM_ACTOR_ID", async () => {
    const { SYSTEM_ACTOR_ID } = await import("@/lib/data/mutate");
    const res = await POST(baseReq());
    expect(res.status).toBe(200);
    const b = (await body(res)) as {
      data: { importedCount: number; tables: Array<{ tableKey: string; count: number }> };
      error: string | null;
    };
    expect(b.error).toBeNull();
    expect(b.data.importedCount).toBe(2);
    expect(b.data.tables).toEqual([{ tableKey: "clients", count: 2 }]);

    // Bulk insert called once for the single affected table, with per-row keys.
    expect(bulkInsertRecords).toHaveBeenCalledTimes(1);
    const [, tableKey, insertRows] = bulkInsertRecords.mock.calls[0];
    expect(tableKey).toBe("clients");
    expect(insertRows).toEqual([
      { data: { name: "Ada" }, idempotencyKey: "import-imp-1-clients-0" },
      { data: { name: "Bea" }, idempotencyKey: "import-imp-1-clients-1" },
    ]);

    // Synthetic clear scoped to org + SYSTEM_ACTOR_ID + deleted_at IS NULL + affected tables.
    expect(clearCall).not.toBeNull();
    expect(clearCall?.eqs).toContainEqual(["organization_id", "org-1"]);
    expect(clearCall?.eqs).toContainEqual(["actor_id", SYSTEM_ACTOR_ID]);
    expect(clearCall?.is).toEqual(["deleted_at", null]);
    expect(clearCall?.in).toEqual(["table_key", ["clients"]]);
    expect(clearCall?.update?.deleted_at).toBeTypeOf("string");
  });

  it("orders insert BEFORE the synthetic clear (crash-safety)", async () => {
    const order: string[] = [];
    bulkInsertRecords.mockImplementation(async () => {
      order.push("insert");
      return { data: { insertedCount: 2 }, error: null };
    });
    // Record the clear's execution (its `.in` terminal) into the same array.
    onClear = () => order.push("clear");
    await POST(baseReq());
    // The insert must run and complete BEFORE the synthetic clear.
    expect(order).toEqual(["insert", "clear"]);
  });

  it("does NOT run the synthetic clear when the bulk insert fails", async () => {
    const order: string[] = [];
    bulkInsertRecords.mockImplementation(async () => {
      order.push("insert");
      return { data: null, error: "boom" };
    });
    onClear = () => order.push("clear");
    const res = await POST(baseReq());
    expect(res.status).toBe(500);
    // Insert-first: a failed insert aborts before the clear, so the table is never
    // emptied and a retry can heal.
    expect(order).toEqual(["insert"]);
    expect(clearCall).toBeNull();
  });

  it("skips the synthetic clear when the plan has no affected tables (all-skip)", async () => {
    const res = await POST(
      baseReq({ decisions: JSON.stringify({ "Full Name": { kind: "skip" } }) }),
    );
    expect(res.status).toBe(200);
    const b = (await body(res)) as {
      data: { importedCount: number; tables: unknown[] };
    };
    expect(b.data.importedCount).toBe(0);
    expect(b.data.tables).toEqual([]);
    // No target table → no insert loop iterations and no synthetic clear.
    expect(bulkInsertRecords).not.toHaveBeenCalled();
    expect(clearCall).toBeNull();
  });

  it("idempotent retry: same file + same import_id → same summary", async () => {
    const first = await POST(baseReq());
    const second = await POST(baseReq());
    expect((await body(first)).data).toEqual((await body(second)).data);
    // Both attempts reuse the SAME per-row idempotency keys.
    const keys1 = (bulkInsertRecords.mock.calls[0][2] as Array<{ idempotencyKey: string }>)
      .map((r) => r.idempotencyKey);
    const keys2 = (bulkInsertRecords.mock.calls[1][2] as Array<{ idempotencyKey: string }>)
      .map((r) => r.idempotencyKey);
    expect(keys1).toEqual(keys2);
  });
});

describe("POST /api/import/commit — error mapping", () => {
  it("400 unresolvedColumns when a decision is unresolved", async () => {
    const res = await POST(
      baseReq({
        decisions: JSON.stringify({ "Full Name": { kind: "unresolved" } }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("Import.error.unresolvedColumns");
    expect(bulkInsertRecords).not.toHaveBeenCalled();
  });

  it("409 schemaChanged when a mapped target no longer resolves", async () => {
    const res = await POST(
      baseReq({
        decisions: JSON.stringify({
          "Full Name": { kind: "map", table: "clients", field: "gone" },
        }),
      }),
    );
    expect(res.status).toBe(409);
    expect((await body(res)).error).toBe("Import.error.schemaChanged");
    expect(bulkInsertRecords).not.toHaveBeenCalled();
  });

  it("500 commitFailed when the bulk insert reports an error", async () => {
    bulkInsertRecords.mockResolvedValue({ data: null, error: "boom" });
    const res = await POST(baseReq());
    expect(res.status).toBe(500);
    expect((await body(res)).error).toBe("Import.error.commitFailed");
  });

  it("500 commitFailed when the synthetic clear throws", async () => {
    clearError = { message: "db down" };
    const res = await POST(baseReq());
    expect(res.status).toBe(500);
    expect((await body(res)).error).toBe("Import.error.commitFailed");
    // Insert still ran before the clear failed (no half-corrupted table; retry heals).
    expect(bulkInsertRecords).toHaveBeenCalledTimes(1);
  });

  it("maps a ParseError key to its matrix status (empty → 400), no write", async () => {
    const { ParseError } = await import("@/lib/import/parse");
    parseSpreadsheet.mockImplementation(() => {
      throw new ParseError("Import.error.empty");
    });
    const res = await POST(baseReq());
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("Import.error.empty");
    expect(bulkInsertRecords).not.toHaveBeenCalled();
  });
});
