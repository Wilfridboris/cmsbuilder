import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for `POST /api/schema/columns` (Story 3.5) WITHOUT a live DB or
 * auth provider. Locks the frozen I/O & Edge-Case Matrix rows that live in the
 * handler rather than the pure helpers, end-to-end through the REAL `requireAdmin`
 * + `resolveUserOrgMembership` (only the caller identity, the scriptable admin
 * client, the RLS org lookup, and the guarded `setFieldVisibility` are mocked):
 *   - unauthenticated                       → 401, no write;
 *   - malformed body                        → 400, no write;
 *   - Member (non-admin) of the target org  → 403, no write;
 *   - Admin of a DIFFERENT org than `slug`  → 403, no write (the slug/admin
 *       cross-check — a most-recent-membership Admin cannot edit another org's
 *       schema even though org_schemas RLS only checks membership);
 *   - valid Admin of the target org         → 200 { tableKey, fieldKey, hidden },
 *       setFieldVisibility called with the RLS identity + parsed patch;
 *   - guarded-layer failure                 → 500 writeFailed (no raw leak).
 *
 * The admin client is a scriptable stub for `resolveUserOrgMembership`
 * (org_members → organizations); the RLS client stub answers `resolveIdentity`'s
 * organizations-by-slug lookup.
 */

const getCurrentUser = vi.fn();
const setFieldVisibility = vi.fn();

type MaybeSingle = { data: unknown; error: unknown };
let membershipRead: MaybeSingle; // resolveUserOrgMembership → org_members
let adminOrgRead: MaybeSingle; // resolveUserOrgMembership → organizations (admin's slug)
let rlsOrgRead: MaybeSingle; // resolveIdentity → organizations (by requested slug, under RLS)

function makeAdminClient() {
  return {
    from(table: string) {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => adminOrgRead }),
          }),
        };
      }
      // org_members: resolveUserOrgMembership uses .eq().order().limit().maybeSingle()
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ maybeSingle: async () => membershipRead }),
            }),
          }),
        }),
      };
    },
  };
}

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
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClient(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => makeRlsClient(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/lib/data/schema-mutate", () => ({ setFieldVisibility }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

function postReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const validBody = {
  slug: "acme",
  tableKey: "clients",
  fieldKey: "email",
  hidden: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: an authenticated ADMIN of "acme" (most-recent membership).
  getCurrentUser.mockResolvedValue({ id: "user-1", email: "admin@example.ca" });
  membershipRead = {
    data: { organization_id: "org-1", role: "admin" },
    error: null,
  };
  adminOrgRead = { data: { slug: "acme" }, error: null };
  rlsOrgRead = { data: { id: "org-1" }, error: null };
  setFieldVisibility.mockResolvedValue({
    data: { tableKey: "clients", fieldKey: "email", hidden: true },
    error: null,
  });
});

describe("POST /api/schema/columns", () => {
  it("valid Admin of the target org → 200 and the guarded write with the RLS identity + parsed patch", async () => {
    const { POST } = await import("@/app/api/schema/columns/route");

    const res = await POST(postReq(validBody));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({
      tableKey: "clients",
      fieldKey: "email",
      hidden: true,
    });
    // setFieldVisibility(identity, tableKey, fieldKey, hidden); identity carries
    // the RLS-resolved org id, never a client-supplied one.
    expect(setFieldVisibility).toHaveBeenCalledTimes(1);
    const call = setFieldVisibility.mock.calls[0];
    expect(call[0]).toEqual(
      expect.objectContaining({ actorId: "user-1", orgId: "org-1" }),
    );
    expect(call[1]).toBe("clients");
    expect(call[2]).toBe("email");
    expect(call[3]).toBe(true);
  });

  it("401 unauthorized when there is no session", async () => {
    const { POST } = await import("@/app/api/schema/columns/route");
    getCurrentUser.mockResolvedValue(null);

    const res = await POST(postReq(validBody));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("unauthorized");
    expect(setFieldVisibility).not.toHaveBeenCalled();
  });

  it("400 on a malformed body (missing fieldKey), no write", async () => {
    const { POST } = await import("@/app/api/schema/columns/route");

    const res = await POST(
      postReq({ slug: "acme", tableKey: "clients", hidden: true }),
    );

    expect(res.status).toBe(400);
    expect(setFieldVisibility).not.toHaveBeenCalled();
  });

  it("400 on a non-boolean hidden, no write", async () => {
    const { POST } = await import("@/app/api/schema/columns/route");

    const res = await POST(postReq({ ...validBody, hidden: "yes" }));

    expect(res.status).toBe(400);
    expect(setFieldVisibility).not.toHaveBeenCalled();
  });

  it("403 forbidden when the caller is a Member (not Admin) of the target org", async () => {
    const { POST } = await import("@/app/api/schema/columns/route");
    membershipRead = {
      data: { organization_id: "org-1", role: "member" },
      error: null,
    };

    const res = await POST(postReq(validBody));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(setFieldVisibility).not.toHaveBeenCalled();
  });

  it("403 forbidden when the caller has no membership at all", async () => {
    const { POST } = await import("@/app/api/schema/columns/route");
    membershipRead = { data: null, error: null };

    const res = await POST(postReq(validBody));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(setFieldVisibility).not.toHaveBeenCalled();
  });

  it("403 forbidden when the caller is Admin of a DIFFERENT org than the requested slug (slug/admin cross-check)", async () => {
    const { POST } = await import("@/app/api/schema/columns/route");
    // The caller's most-recent membership is Admin of "other-org", but they POST
    // slug "acme". requireAdmin passes on the Admin role, so the slug cross-check
    // is the only thing stopping a cross-org schema edit.
    adminOrgRead = { data: { slug: "other-org" }, error: null };

    const res = await POST(postReq(validBody));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(setFieldVisibility).not.toHaveBeenCalled();
  });

  it("500 writeFailed when the guarded layer throws (raw message never leaks)", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/columns/route");
    setFieldVisibility.mockRejectedValue(
      new AppError(500, "writeFailed", "duplicate key value boom"),
    );

    const res = await POST(postReq(validBody));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("writeFailed");
    expect(body.error).not.toContain("boom");
  });

  it("400 genericError when the guarded layer rejects an unknown table/field", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/columns/route");
    setFieldVisibility.mockRejectedValue(new AppError(400, "genericError"));

    const res = await POST(postReq({ ...validBody, fieldKey: "nope" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("genericError");
  });
});
