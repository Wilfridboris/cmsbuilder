import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Handler coverage for `GET /api/records/labels` (Story 3.7 batched label display)
 * WITHOUT a live DB or auth provider. Mirrors `route-records-search.test.ts`:
 * identity, the RLS org-by-slug lookup, `getSchema`, and the guarded
 * `resolveRecordLabels` are mocked; `resolvedDisplayFieldKey` runs for real. Locks
 * the auth/membership scoping, the id-count cap, and the "no display field → empty"
 * branch.
 */

const getCurrentUser = vi.fn();
const getSchema = vi.fn();
const resolveRecordLabels = vi.fn();

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
vi.mock("@/lib/data/records", () => ({ getSchema, resolveRecordLabels }));
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
  resolveRecordLabels.mockResolvedValue({
    data: [{ id: "c1", label: "Alpha" }],
    error: null,
  });
});

describe("GET /api/records/labels", () => {
  it("valid member → 200 with resolved labels via the target's display field", async () => {
    const { GET } = await import("@/app/api/records/labels/route");

    const res = await GET(getReq({ slug: "acme", table: "clients", ids: "c1,c2" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ labels: [{ id: "c1", label: "Alpha" }] });
    const call = resolveRecordLabels.mock.calls[0];
    expect(call[1]).toBe("org-1");
    expect(call[2]).toBe("clients");
    expect(call[3]).toBe("name");
    expect(call[4]).toEqual(["c1", "c2"]);
  });

  it("401 unauthorized when there is no session", async () => {
    const { GET } = await import("@/app/api/records/labels/route");
    getCurrentUser.mockResolvedValue(null);

    const res = await GET(getReq({ slug: "acme", table: "clients", ids: "c1" }));

    expect(res.status).toBe(401);
    expect(resolveRecordLabels).not.toHaveBeenCalled();
  });

  it("400 when ids is missing", async () => {
    const { GET } = await import("@/app/api/records/labels/route");

    const res = await GET(getReq({ slug: "acme", table: "clients" }));

    expect(res.status).toBe(400);
    expect(resolveRecordLabels).not.toHaveBeenCalled();
  });

  it("400 when more than the id cap is requested", async () => {
    const { GET } = await import("@/app/api/records/labels/route");
    const ids = Array.from({ length: 201 }, (_, i) => `id${i}`).join(",");

    const res = await GET(getReq({ slug: "acme", table: "clients", ids }));

    expect(res.status).toBe(400);
    expect(resolveRecordLabels).not.toHaveBeenCalled();
  });

  it("403 when the caller is not a member of the org", async () => {
    const { GET } = await import("@/app/api/records/labels/route");
    rlsOrgRead = { data: null, error: null };

    const res = await GET(getReq({ slug: "acme", table: "clients", ids: "c1" }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(resolveRecordLabels).not.toHaveBeenCalled();
  });

  it("200 with empty labels (not an error) when the target table has no display field", async () => {
    const { GET } = await import("@/app/api/records/labels/route");
    getSchema.mockResolvedValue({ data: { tables: [] }, error: null });

    const res = await GET(getReq({ slug: "acme", table: "clients", ids: "c1" }));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ labels: [] });
    expect(resolveRecordLabels).not.toHaveBeenCalled();
  });
});
