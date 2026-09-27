import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Handler coverage for `GET /api/records/search` (Story 3.7 relation typeahead)
 * WITHOUT a live DB or auth provider. Mirrors `route-schema-fields.test.ts`: the
 * caller identity, the RLS org-by-slug lookup, `getSchema`, and the guarded
 * `searchRelationRecords` are mocked; `resolvedDisplayFieldKey` runs for real.
 * Locks the auth/membership scoping and the "no display field → empty, not error"
 * branch.
 */

const getCurrentUser = vi.fn();
const getSchema = vi.fn();
const searchRelationRecords = vi.fn();

type MaybeSingle = { data: unknown; error: unknown };
let rlsOrgRead: MaybeSingle; // resolveIdentity → organizations (by slug, under RLS)

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
vi.mock("@/lib/data/records", () => ({ getSchema, searchRelationRecords }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

function getReq(params: Record<string, string>): NextRequest {
  return {
    nextUrl: { searchParams: new URLSearchParams(params) },
  } as unknown as NextRequest;
}

const schemaWithClients = {
  tables: [
    {
      key: "clients",
      label: "Clients",
      fields: [{ key: "name", label: "Name", type: "text" }],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "user-1", email: "member@example.ca" });
  rlsOrgRead = { data: { id: "org-1" }, error: null };
  getSchema.mockResolvedValue({ data: schemaWithClients, error: null });
  searchRelationRecords.mockResolvedValue({
    data: [{ id: "c1", label: "Alpha" }],
    error: null,
  });
});

describe("GET /api/records/search", () => {
  it("valid member → 200 with resolved candidates, searched by the target's display field", async () => {
    const { GET } = await import("@/app/api/records/search/route");

    const res = await GET(getReq({ slug: "acme", table: "clients", query: "al" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ results: [{ id: "c1", label: "Alpha" }] });
    expect(searchRelationRecords).toHaveBeenCalledTimes(1);
    const call = searchRelationRecords.mock.calls[0];
    expect(call[1]).toBe("org-1"); // RLS-resolved org id, never client-supplied
    expect(call[2]).toBe("clients");
    expect(call[3]).toBe("name"); // resolvedDisplayFieldKey(clients)
    expect(call[4]).toBe("al");
  });

  it("401 unauthorized when there is no session", async () => {
    const { GET } = await import("@/app/api/records/search/route");
    getCurrentUser.mockResolvedValue(null);

    const res = await GET(getReq({ slug: "acme", table: "clients", query: "al" }));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(searchRelationRecords).not.toHaveBeenCalled();
  });

  it("400 when the table param is missing", async () => {
    const { GET } = await import("@/app/api/records/search/route");

    const res = await GET(getReq({ slug: "acme", query: "al" }));

    expect(res.status).toBe(400);
    expect(searchRelationRecords).not.toHaveBeenCalled();
  });

  it("403 when the caller is not a member of the org (RLS hides the org)", async () => {
    const { GET } = await import("@/app/api/records/search/route");
    rlsOrgRead = { data: null, error: null };

    const res = await GET(getReq({ slug: "acme", table: "clients", query: "al" }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(searchRelationRecords).not.toHaveBeenCalled();
  });

  it("200 with empty results (not an error) when the target table has no display field", async () => {
    const { GET } = await import("@/app/api/records/search/route");
    getSchema.mockResolvedValue({ data: { tables: [] }, error: null });

    const res = await GET(getReq({ slug: "acme", table: "clients", query: "al" }));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ results: [] });
    expect(searchRelationRecords).not.toHaveBeenCalled();
  });
});
