import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Handler coverage for `GET /api/records/[id]/references` (Story 3.8 safe-delete
 * guard) WITHOUT a live DB or auth provider. Mirrors `route-records-labels.test.ts`:
 * identity, the RLS org-by-slug lookup, `getSchema`, and the guarded
 * `countReferencingRecords` are mocked. Locks the auth/membership scoping, the
 * count passthrough, and the "missing param → 400" branch.
 */

const getCurrentUser = vi.fn();
const getSchema = vi.fn();
const countReferencingRecords = vi.fn();

type MaybeSingle = { data: unknown; error: unknown };
let rlsOrgRead: MaybeSingle;

function makeRlsClient() {
  return {
    from() {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => rlsOrgRead }),
        }),
      };
    },
  };
}

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => makeRlsClient(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/lib/data/records", () => ({ getSchema, countReferencingRecords }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

function getReq(params: Record<string, string>): NextRequest {
  return {
    nextUrl: { searchParams: new URLSearchParams(params) },
  } as unknown as NextRequest;
}

const params = { params: Promise.resolve({ id: "rec-1" }) };

const schema = {
  tables: [{ key: "clients", label: "Clients", fields: [] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "user-1", email: "member@example.ca" });
  rlsOrgRead = { data: { id: "org-1" }, error: null };
  getSchema.mockResolvedValue({ data: schema, error: null });
  countReferencingRecords.mockResolvedValue({ data: 4, error: null });
});

describe("GET /api/records/[id]/references", () => {
  it("valid member → 200 with the reference count for the record id", async () => {
    const { GET } = await import("@/app/api/records/[id]/references/route");

    const res = await GET(getReq({ slug: "acme", table: "clients" }), params);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ count: 4 });
    const call = countReferencingRecords.mock.calls[0];
    expect(call[1]).toBe("org-1"); // org id
    expect(call[3]).toBe("clients"); // target table
    expect(call[4]).toBe("rec-1"); // target id (path param)
  });

  it("401 unauthorized when there is no session", async () => {
    const { GET } = await import("@/app/api/records/[id]/references/route");
    getCurrentUser.mockResolvedValue(null);

    const res = await GET(getReq({ slug: "acme", table: "clients" }), params);

    expect(res.status).toBe(401);
    expect(countReferencingRecords).not.toHaveBeenCalled();
  });

  it("400 when the table query param is missing", async () => {
    const { GET } = await import("@/app/api/records/[id]/references/route");

    const res = await GET(getReq({ slug: "acme" }), params);

    expect(res.status).toBe(400);
    expect(countReferencingRecords).not.toHaveBeenCalled();
  });

  it("403 when the caller is not a member of the org", async () => {
    const { GET } = await import("@/app/api/records/[id]/references/route");
    rlsOrgRead = { data: null, error: null };

    const res = await GET(getReq({ slug: "acme", table: "clients" }), params);

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(countReferencingRecords).not.toHaveBeenCalled();
  });

  it("500 loadFailed when the count query errors (dialog degrades to a neutral note)", async () => {
    const { GET } = await import("@/app/api/records/[id]/references/route");
    countReferencingRecords.mockResolvedValue({ data: null, error: "Failed to count references." });

    const res = await GET(getReq({ slug: "acme", table: "clients" }), params);

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("loadFailed");
  });
});
