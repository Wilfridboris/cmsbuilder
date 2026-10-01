import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for `POST /api/import/analyze` (Story 4.1) WITHOUT a live DB or
 * auth provider — mirroring `route-records.test.ts` (mock the caller identity,
 * the RLS org read, `requireAdmin`, the pure parser, and `reportError`; feed a
 * fake `NextRequest` whose `formData()` returns a `FormData`; assert `status` +
 * the `{ data, error }` envelope). Locks the frozen matrix rows the handler owns:
 *   - Unauthenticated            → 401 unauthorized, BEFORE any parse;
 *   - Non-member slug            → 403 forbidden (org read under RLS returns null);
 *   - Non-Admin member           → 403 forbidden (requireAdmin throws), no parse;
 *   - Cross-org admin            → 403 forbidden (slug mismatch);
 *   - Missing file field         → 400 Import.error.noFile;
 *   - Oversized file             → 413 Import.error.tooLarge;
 *   - Wrong extension            → 400 Import.error.unreadable;
 *   - Valid CSV                  → 200 { columns, rowCount, sampleRows, sheetName };
 *   - Multi-sheet workbook       → 200 { sheetNames, needsSheetSelection: true }.
 */

const getCurrentUser = vi.fn();
const requireAdmin = vi.fn();
const parseSpreadsheet = vi.fn();

type MaybeSingle = { data: unknown; error: unknown };
let orgRead: MaybeSingle; // organizations lookup under the RLS client

function makeClient() {
  return {
    from() {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => orgRead }),
        }),
      };
    },
  };
}

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => makeClient(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/lib/auth/rbac", () => ({ requireAdmin }));
vi.mock("@/lib/import/parse", async () => {
  const actual = await vi.importActual<typeof import("@/lib/import/parse")>(
    "@/lib/import/parse",
  );
  return { ...actual, parseSpreadsheet };
});
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

/** A minimal File-like whose bytes we control and whose size is settable. */
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

/** Build a fake NextRequest whose `formData()` yields the given entries. */
function importReq(entries: Record<string, string | File | null>): NextRequest {
  const form = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (v !== null) form.set(k, v);
  }
  return { formData: async () => form } as unknown as NextRequest;
}

let POST: typeof import("@/app/api/import/analyze/route").POST;

beforeEach(async () => {
  vi.clearAllMocks();
  orgRead = { data: { id: "org-1" }, error: null };
  getCurrentUser.mockResolvedValue({ id: "user-1" });
  requireAdmin.mockResolvedValue({ orgId: "org-1", slug: "acme", role: "admin" });
  ({ POST } = await import("@/app/api/import/analyze/route"));
});

async function body(res: Awaited<ReturnType<typeof POST>>) {
  return (await res.json()) as { data: unknown; error: string | null };
}

describe("POST /api/import/analyze — auth gate (before any parse)", () => {
  it("401 unauthorized when there is no session", async () => {
    getCurrentUser.mockResolvedValue(null);
    const res = await POST(importReq({ slug: "acme" }));
    expect(res.status).toBe(401);
    expect((await body(res)).error).toBe("unauthorized");
    expect(parseSpreadsheet).not.toHaveBeenCalled();
  });

  it("403 forbidden when the slug resolves to no org under RLS (non-member)", async () => {
    orgRead = { data: null, error: null };
    const res = await POST(
      importReq({ slug: "acme", file: fakeFile("x.csv", new Uint8Array([1])) }),
    );
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("forbidden");
    expect(parseSpreadsheet).not.toHaveBeenCalled();
  });

  it("403 forbidden when the caller is a Member (requireAdmin throws)", async () => {
    const { AppError } = await import("@/types/api");
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const res = await POST(
      importReq({ slug: "acme", file: fakeFile("x.csv", new Uint8Array([1])) }),
    );
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("forbidden");
    expect(parseSpreadsheet).not.toHaveBeenCalled();
  });

  it("403 forbidden when an Admin's membership is for a different slug", async () => {
    requireAdmin.mockResolvedValue({ orgId: "org-2", slug: "other", role: "admin" });
    const res = await POST(
      importReq({ slug: "acme", file: fakeFile("x.csv", new Uint8Array([1])) }),
    );
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("forbidden");
    expect(parseSpreadsheet).not.toHaveBeenCalled();
  });

  it("is NOT gated for a read_only org — analyze is a read phase (Story 7.4)", async () => {
    orgRead = {
      data: { id: "org-1", subscription_status: "read_only", trial_expires_at: null },
      error: null,
    };
    parseSpreadsheet.mockReturnValue({
      columns: ["Name"],
      rows: [{ Name: "Ada" }],
      sheetName: "customers",
    });
    const res = await POST(
      importReq({ slug: "acme", file: fakeFile("customers.csv", new Uint8Array([1, 2])) }),
    );
    expect(res.status).not.toBe(403);
    expect(parseSpreadsheet).toHaveBeenCalled();
  });
});

describe("POST /api/import/analyze — input guard", () => {
  it("400 noFile when the file part is missing", async () => {
    const res = await POST(importReq({ slug: "acme" }));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("Import.error.noFile");
    expect(parseSpreadsheet).not.toHaveBeenCalled();
  });

  it("413 tooLarge when the file exceeds the size bound (before parse)", async () => {
    const big = fakeFile("x.csv", new Uint8Array([1]), 6 * 1024 * 1024);
    const res = await POST(importReq({ slug: "acme", file: big }));
    expect(res.status).toBe(413);
    expect((await body(res)).error).toBe("Import.error.tooLarge");
    expect(parseSpreadsheet).not.toHaveBeenCalled();
  });

  it("400 unreadable for a non-spreadsheet extension", async () => {
    const pdf = fakeFile("doc.pdf", new Uint8Array([1, 2, 3]));
    const res = await POST(importReq({ slug: "acme", file: pdf }));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("Import.error.unreadable");
    expect(parseSpreadsheet).not.toHaveBeenCalled();
  });
});

describe("POST /api/import/analyze — parse outcomes", () => {
  it("200 preview for a valid CSV (columns + capped sample rows)", async () => {
    parseSpreadsheet.mockReturnValue({
      columns: ["Name", "Email"],
      rows: [
        { Name: "Ada", Email: "a@x.ca" },
        { Name: "Grace", Email: "g@x.ca" },
      ],
      sheetName: "customers",
    });
    const res = await POST(
      importReq({
        slug: "acme",
        file: fakeFile("customers.csv", new Uint8Array([1, 2])),
      }),
    );
    expect(res.status).toBe(200);
    const b = await body(res);
    expect(b.error).toBeNull();
    expect(b.data).toEqual({
      columns: ["Name", "Email"],
      rowCount: 2,
      sampleRows: [
        { Name: "Ada", Email: "a@x.ca" },
        { Name: "Grace", Email: "g@x.ca" },
      ],
      sheetName: "customers",
    });
  });

  it("caps sampleRows at 10 while reporting the full rowCount", async () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ V: String(i) }));
    parseSpreadsheet.mockReturnValue({ columns: ["V"], rows, sheetName: "x" });
    const res = await POST(
      importReq({ slug: "acme", file: fakeFile("x.csv", new Uint8Array([1])) }),
    );
    const b = (await body(res)) as { data: { rowCount: number; sampleRows: unknown[] } };
    expect(b.data.rowCount).toBe(15);
    expect(b.data.sampleRows).toHaveLength(10);
  });

  it("200 sheet-selection payload for a multi-sheet workbook", async () => {
    parseSpreadsheet.mockReturnValue({
      columns: [],
      rows: [],
      sheetName: "",
      sheetNames: ["Customers", "Invoices"],
    });
    const res = await POST(
      importReq({ slug: "acme", file: fakeFile("book.xlsx", new Uint8Array([1])) }),
    );
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual({
      sheetNames: ["Customers", "Invoices"],
      needsSheetSelection: true,
    });
  });

  it("maps a ParseError key to its matrix status (empty → 400)", async () => {
    const { ParseError } = await import("@/lib/import/parse");
    parseSpreadsheet.mockImplementation(() => {
      throw new ParseError("Import.error.empty");
    });
    const res = await POST(
      importReq({ slug: "acme", file: fakeFile("x.csv", new Uint8Array([1])) }),
    );
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("Import.error.empty");
  });

  it("forwards the chosen `sheet` form field to parseSpreadsheet", async () => {
    parseSpreadsheet.mockReturnValue({
      columns: ["Total"],
      rows: [{ Total: "99" }],
      sheetName: "Invoices",
    });
    const res = await POST(
      importReq({
        slug: "acme",
        file: fakeFile("book.xlsx", new Uint8Array([1])),
        sheet: "Invoices",
      }),
    );
    expect(res.status).toBe(200);
    // The route must pass the chosen sheet through as the 3rd arg — the headline
    // multi-sheet wiring. (buffer, filename, chosenSheet).
    expect(parseSpreadsheet).toHaveBeenCalledWith(
      expect.anything(),
      "book.xlsx",
      "Invoices",
    );
  });

  it("masks a non-ParseError parser throw to 400 unreadable (never a 500)", async () => {
    parseSpreadsheet.mockImplementation(() => {
      throw new Error("boom");
    });
    const res = await POST(
      importReq({ slug: "acme", file: fakeFile("x.csv", new Uint8Array([1])) }),
    );
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("Import.error.unreadable");
  });
});
