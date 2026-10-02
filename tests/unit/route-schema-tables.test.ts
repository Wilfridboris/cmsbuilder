import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for `POST /api/schema/tables` (Story 5.7) WITHOUT a live DB or auth
 * provider. Mirrors `route-schema-views.test.ts`: the direct, non-LLM table
 * hide/restore path for the chat confirm button, the add-table Undo, the chat
 * show-again Undo, and the Settings Restore control, end-to-end through the REAL
 * `requireAdmin` + `resolveUserOrgMembership` (only the caller identity, the
 * scriptable admin client, the RLS org lookup, and the guarded `setTableVisibility`
 * mutator are mocked):
 *   - unauthenticated                       → 401, no write;
 *   - malformed body                        → 400, no write;
 *   - Member (non-admin) of the target org  → 403, no write (control also hidden);
 *   - Admin of a DIFFERENT org than `slug`  → 403, no write (slug/admin cross-check);
 *   - valid Admin, action "hide"            → 200 { action:"hide", ... }, the guarded
 *       setTableVisibility called with the RLS identity + tableKey + hidden:true;
 *   - valid Admin, action "restore"         → 200 { action:"restore", ... }, the
 *       guarded setTableVisibility called with hidden:false;
 *   - guarded-layer failure (missing table) → 400, no raw leak;
 *   - guarded-layer failure (last table)    → 400 tableHideLast, no raw leak;
 *   - guarded-layer failure (write)         → 500 writeFailed, no raw leak.
 */

const getCurrentUser = vi.fn();
const setTableVisibility = vi.fn();

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
vi.mock("@/lib/data/schema-mutate", () => ({ setTableVisibility }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

function postReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const hideBody = { slug: "acme", action: "hide", tableKey: "jobs" };
const restoreBody = { slug: "acme", action: "restore", tableKey: "jobs" };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "user-1", email: "admin@example.ca" });
  membershipRead = {
    data: { organization_id: "org-1", role: "admin" },
    error: null,
  };
  adminOrgRead = { data: { slug: "acme" }, error: null };
  rlsOrgRead = { data: { id: "org-1" }, error: null };
  setTableVisibility.mockResolvedValue({
    data: { tableKey: "jobs", hidden: true },
    error: null,
  });
});

describe("POST /api/schema/tables", () => {
  it("valid Admin, hide → 200 and the guarded setTableVisibility with the RLS identity + tableKey + hidden:true", async () => {
    const { POST } = await import("@/app/api/schema/tables/route");

    const res = await POST(postReq(hideBody));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({
      action: "hide",
      tableKey: "jobs",
      hidden: true,
    });

    expect(setTableVisibility).toHaveBeenCalledTimes(1);
    const call = setTableVisibility.mock.calls[0];
    expect(call[0]).toEqual(
      expect.objectContaining({ actorId: "user-1", orgId: "org-1" }),
    );
    expect(call[1]).toBe("jobs");
    expect(call[2]).toBe(true);
  });

  it("valid Admin, restore → 200 and the guarded setTableVisibility with hidden:false", async () => {
    setTableVisibility.mockResolvedValue({
      data: { tableKey: "jobs", hidden: false },
      error: null,
    });
    const { POST } = await import("@/app/api/schema/tables/route");

    const res = await POST(postReq(restoreBody));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({
      action: "restore",
      tableKey: "jobs",
      hidden: false,
    });

    expect(setTableVisibility).toHaveBeenCalledTimes(1);
    expect(setTableVisibility.mock.calls[0][2]).toBe(false);
  });

  it("401 unauthorized when there is no session", async () => {
    const { POST } = await import("@/app/api/schema/tables/route");
    getCurrentUser.mockResolvedValue(null);

    const res = await POST(postReq(hideBody));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(setTableVisibility).not.toHaveBeenCalled();
  });

  it("400 on a malformed body (hide with no tableKey), no write", async () => {
    const { POST } = await import("@/app/api/schema/tables/route");

    const res = await POST(postReq({ slug: "acme", action: "hide" }));

    expect(res.status).toBe(400);
    expect(setTableVisibility).not.toHaveBeenCalled();
  });

  it("400 on an unknown action, no write", async () => {
    const { POST } = await import("@/app/api/schema/tables/route");

    const res = await POST(
      postReq({ slug: "acme", action: "nuke", tableKey: "jobs" }),
    );

    expect(res.status).toBe(400);
    expect(setTableVisibility).not.toHaveBeenCalled();
  });

  it("403 forbidden when the caller is a Member (not Admin), no write", async () => {
    const { POST } = await import("@/app/api/schema/tables/route");
    membershipRead = {
      data: { organization_id: "org-1", role: "member" },
      error: null,
    };

    const res = await POST(postReq(hideBody));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(setTableVisibility).not.toHaveBeenCalled();
  });

  it("403 forbidden when the caller is Admin of a DIFFERENT org than slug (cross-check), no write", async () => {
    const { POST } = await import("@/app/api/schema/tables/route");
    adminOrgRead = { data: { slug: "other-org" }, error: null };

    const res = await POST(postReq(hideBody));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(setTableVisibility).not.toHaveBeenCalled();
  });

  it("400 genericError when the guarded layer rejects a missing table (no raw leak)", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/tables/route");
    setTableVisibility.mockRejectedValue(new AppError(400, "genericError"));

    const res = await POST(postReq({ ...hideBody, tableKey: "ghost" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("genericError");
  });

  it("400 tableHideLast when the guarded layer refuses to empty the dashboard (no raw leak)", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/tables/route");
    setTableVisibility.mockRejectedValue(new AppError(400, "tableHideLast"));

    const res = await POST(postReq(hideBody));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("tableHideLast");
  });

  it("500 writeFailed when the guarded layer throws (raw message never leaks)", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/tables/route");
    setTableVisibility.mockRejectedValue(
      new AppError(500, "writeFailed", "duplicate key value boom"),
    );

    const res = await POST(postReq(hideBody));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("writeFailed");
    expect(JSON.stringify(body)).not.toContain("boom");
  });
});
