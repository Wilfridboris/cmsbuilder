import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for `POST /api/import/propose` (Story 4.2) WITHOUT a live DB, auth
 * provider, or LLM — mirroring `route-import-analyze.test.ts`. Mocks the caller
 * identity, the RLS org read, `requireAdmin`, the pure parser, `getSchema`,
 * `callGeminiWithTimeout`, and `reportError`; feeds a fake `NextRequest`. Locks the
 * frozen boundaries the handler owns:
 *   - 401/403 gate BEFORE any parse / getSchema / Gemini call;
 *   - guard rejections (missing file, oversized, wrong extension);
 *   - a Gemini success → a sanitized `ImportProposal` (hallucinated target dropped);
 *   - the Gemini-failure branch (after retry-once) → `Import.error.mappingUnavailable`;
 *   - no tenant write ever occurs (getSchema is the only tenant touch, a READ).
 */

const getCurrentUser = vi.fn();
const requireAdmin = vi.fn();
const parseSpreadsheet = vi.fn();
const getSchema = vi.fn();
const callGeminiWithTimeout = vi.fn();

// The NEXT_LOCALE cookie value the route reads via `next/headers` cookies() when
// threading the locale into the mapping prompt. Mutable so a test can flip it.
let cookieLocale: string | undefined;

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
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "NEXT_LOCALE" && cookieLocale !== undefined
        ? { value: cookieLocale }
        : undefined,
  }),
}));
vi.mock("@/lib/auth/rbac", () => ({ requireAdmin }));
vi.mock("@/lib/import/parse", async () => {
  const actual = await vi.importActual<typeof import("@/lib/import/parse")>(
    "@/lib/import/parse",
  );
  return { ...actual, parseSpreadsheet };
});
vi.mock("@/lib/data/records", () => ({ getSchema }));
vi.mock("@/lib/gemini/client", () => ({ callGeminiWithTimeout }));
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
  ],
};

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

function importReq(entries: Record<string, string | File | null>): NextRequest {
  const form = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (v !== null) form.set(k, v);
  }
  return { formData: async () => form } as unknown as NextRequest;
}

let POST: typeof import("@/app/api/import/propose/route").POST;

beforeEach(async () => {
  vi.clearAllMocks();
  cookieLocale = undefined;
  orgRead = { data: { id: "org-1" }, error: null };
  getCurrentUser.mockResolvedValue({ id: "user-1" });
  requireAdmin.mockResolvedValue({ orgId: "org-1", slug: "acme", role: "admin" });
  getSchema.mockResolvedValue({ data: SCHEMA, error: null });
  parseSpreadsheet.mockReturnValue({
    columns: ["Full Name", "Bogus"],
    rows: [{ "Full Name": "Ada", Bogus: "x" }],
    sheetName: "customers",
  });
  callGeminiWithTimeout.mockResolvedValue({
    mappings: [
      {
        sourceColumn: "Full Name",
        targetTable: "clients",
        targetField: "name",
        confidence: 0.95,
        reason: "name-like",
      },
      {
        sourceColumn: "Bogus",
        targetTable: "invoices",
        targetField: "total",
        confidence: 0.99,
        reason: "hallucinated",
      },
    ],
  });
  ({ POST } = await import("@/app/api/import/propose/route"));
});

async function body(res: Awaited<ReturnType<typeof POST>>) {
  return (await res.json()) as { data: unknown; error: string | null };
}

describe("POST /api/import/propose — auth gate (before any parse/AI)", () => {
  it("401 unauthorized when there is no session", async () => {
    getCurrentUser.mockResolvedValue(null);
    const res = await POST(importReq({ slug: "acme" }));
    expect(res.status).toBe(401);
    expect((await body(res)).error).toBe("unauthorized");
    expect(parseSpreadsheet).not.toHaveBeenCalled();
    expect(getSchema).not.toHaveBeenCalled();
    expect(callGeminiWithTimeout).not.toHaveBeenCalled();
  });

  it("403 when the slug resolves to no org under RLS (non-member)", async () => {
    orgRead = { data: null, error: null };
    const res = await POST(
      importReq({ slug: "acme", file: fakeFile("x.csv", new Uint8Array([1])) }),
    );
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("forbidden");
    expect(parseSpreadsheet).not.toHaveBeenCalled();
    expect(callGeminiWithTimeout).not.toHaveBeenCalled();
  });

  it("403 when the caller is a Member (requireAdmin throws)", async () => {
    const { AppError } = await import("@/types/api");
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const res = await POST(
      importReq({ slug: "acme", file: fakeFile("x.csv", new Uint8Array([1])) }),
    );
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("forbidden");
    expect(parseSpreadsheet).not.toHaveBeenCalled();
    expect(callGeminiWithTimeout).not.toHaveBeenCalled();
  });

  it("403 when an Admin's membership is for a different slug", async () => {
    requireAdmin.mockResolvedValue({ orgId: "org-2", slug: "other", role: "admin" });
    const res = await POST(
      importReq({ slug: "acme", file: fakeFile("x.csv", new Uint8Array([1])) }),
    );
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("forbidden");
    expect(callGeminiWithTimeout).not.toHaveBeenCalled();
  });
});

describe("POST /api/import/propose — input guard", () => {
  it("400 noFile when the file part is missing", async () => {
    const res = await POST(importReq({ slug: "acme" }));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("Import.error.noFile");
    expect(parseSpreadsheet).not.toHaveBeenCalled();
    expect(callGeminiWithTimeout).not.toHaveBeenCalled();
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
    expect(callGeminiWithTimeout).not.toHaveBeenCalled();
  });

  it("400 unreadable for a multi-sheet workbook with no chosen sheet", async () => {
    parseSpreadsheet.mockReturnValue({
      columns: [],
      rows: [],
      sheetName: "",
      sheetNames: ["A", "B"],
    });
    const res = await POST(
      importReq({ slug: "acme", file: fakeFile("book.xlsx", new Uint8Array([1])) }),
    );
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("Import.error.unreadable");
    expect(callGeminiWithTimeout).not.toHaveBeenCalled();
  });
});

describe("POST /api/import/propose — proposal", () => {
  it("200 with a sanitized proposal (hallucinated target downgraded to null)", async () => {
    const res = await POST(
      importReq({
        slug: "acme",
        file: fakeFile("customers.csv", new Uint8Array([1])),
      }),
    );
    expect(res.status).toBe(200);
    const b = (await body(res)) as {
      data: {
        rowCount: number;
        mappings: Array<{
          sourceColumn: string;
          target: { table: string; field: string } | null;
          confidence: number;
        }>;
        unmapped: string[];
      };
      error: string | null;
    };
    expect(b.error).toBeNull();
    expect(b.data.rowCount).toBe(1);
    expect(b.data.mappings).toHaveLength(2);
    const fullName = b.data.mappings.find((m) => m.sourceColumn === "Full Name");
    expect(fullName?.target).toEqual({ table: "clients", field: "name" });
    const bogus = b.data.mappings.find((m) => m.sourceColumn === "Bogus");
    expect(bogus?.target).toBeNull();
    expect(b.data.unmapped).toEqual(["Bogus"]);
    // getSchema was READ; no write API was invoked (route imports no mutate layer).
    expect(getSchema).toHaveBeenCalledTimes(1);
  });

  it("passes the chosen sheet to parseSpreadsheet", async () => {
    parseSpreadsheet.mockReturnValue({
      columns: ["Full Name"],
      rows: [{ "Full Name": "Ada" }],
      sheetName: "Invoices",
    });
    await POST(
      importReq({
        slug: "acme",
        file: fakeFile("book.xlsx", new Uint8Array([1])),
        sheet: "Invoices",
      }),
    );
    expect(parseSpreadsheet).toHaveBeenCalledWith(
      expect.anything(),
      "book.xlsx",
      "Invoices",
    );
  });

  it("retries the Gemini call exactly once before succeeding", async () => {
    callGeminiWithTimeout
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        mappings: [
          {
            sourceColumn: "Full Name",
            targetTable: "clients",
            targetField: "name",
            confidence: 0.9,
            reason: "ok",
          },
        ],
      });
    parseSpreadsheet.mockReturnValue({
      columns: ["Full Name"],
      rows: [{ "Full Name": "Ada" }],
      sheetName: "x",
    });
    const res = await POST(
      importReq({ slug: "acme", file: fakeFile("x.csv", new Uint8Array([1])) }),
    );
    expect(res.status).toBe(200);
    expect(callGeminiWithTimeout).toHaveBeenCalledTimes(2);
  });

  it("returns Import.error.mappingUnavailable after retry-once fails (no write)", async () => {
    callGeminiWithTimeout.mockRejectedValue(new Error("timeout"));
    const res = await POST(
      importReq({ slug: "acme", file: fakeFile("x.csv", new Uint8Array([1])) }),
    );
    expect((await body(res)).error).toBe("Import.error.mappingUnavailable");
    expect(callGeminiWithTimeout).toHaveBeenCalledTimes(2);
  });

  it("threads the fr NEXT_LOCALE cookie into the prompt (French reason)", async () => {
    cookieLocale = "fr";
    parseSpreadsheet.mockReturnValue({
      columns: ["Full Name"],
      rows: [{ "Full Name": "Ada" }],
      sheetName: "x",
    });
    await POST(
      importReq({ slug: "acme", file: fakeFile("x.csv", new Uint8Array([1])) }),
    );
    const prompt = callGeminiWithTimeout.mock.calls[0][0] as string;
    expect(prompt).toContain('Write every "reason" in French.');
  });

  it("defaults to the English reason instruction when no locale cookie is set", async () => {
    parseSpreadsheet.mockReturnValue({
      columns: ["Full Name"],
      rows: [{ "Full Name": "Ada" }],
      sheetName: "x",
    });
    await POST(
      importReq({ slug: "acme", file: fakeFile("x.csv", new Uint8Array([1])) }),
    );
    const prompt = callGeminiWithTimeout.mock.calls[0][0] as string;
    expect(prompt).toContain('Write every "reason" in English.');
  });

  it("maps a ParseError key to its matrix status (empty → 400), no AI call", async () => {
    const { ParseError } = await import("@/lib/import/parse");
    parseSpreadsheet.mockImplementation(() => {
      throw new ParseError("Import.error.empty");
    });
    const res = await POST(
      importReq({ slug: "acme", file: fakeFile("x.csv", new Uint8Array([1])) }),
    );
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("Import.error.empty");
    expect(callGeminiWithTimeout).not.toHaveBeenCalled();
  });
});
