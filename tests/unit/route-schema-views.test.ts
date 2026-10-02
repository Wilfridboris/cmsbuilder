import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for `POST /api/schema/views` (Story 5.6) WITHOUT a live DB or auth
 * provider. Mirrors `route-schema-columns.test.ts`: the direct, non-LLM view
 * mutation path for the tab "Remove view" control and both Undo flows, end-to-end
 * through the REAL `requireAdmin` + `resolveUserOrgMembership` (only the caller
 * identity, the scriptable admin client, the RLS org lookup, and the guarded
 * `removeView`/`addView` mutators are mocked):
 *   - unauthenticated                       → 401, no write;
 *   - malformed body                        → 400, no write;
 *   - Member (non-admin) of the target org  → 403, no write (control also hidden);
 *   - Admin of a DIFFERENT org than `slug`  → 403, no write (slug/admin cross-check);
 *   - valid Admin, action "remove"          → 200 { action:"remove", view }, the
 *       guarded removeView called with the RLS identity + viewKey;
 *   - valid Admin, action "restore"         → 200 { action:"restore", viewKey }, the
 *       guarded addView called with the RLS identity + view;
 *   - guarded-layer failure (missing view)  → 400, no raw leak;
 *   - guarded-layer failure (write)         → 500 writeFailed, no raw leak.
 */

const getCurrentUser = vi.fn();
const removeView = vi.fn();
const addView = vi.fn();

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
vi.mock("@/lib/data/schema-mutate", () => ({ removeView, addView }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

function postReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const removedView = {
  key: "unpaid_invoices",
  label: "Unpaid invoices",
  sourceTableKey: "invoices",
  filters: [{ field: "status", operator: "equals", value: "unpaid" }],
  sort: { field: "due_date", direction: "desc" },
};

const removeBody = { slug: "acme", action: "remove", viewKey: "unpaid_invoices" };
const restoreBody = {
  slug: "acme",
  action: "restore",
  view: {
    label: "Unpaid invoices",
    sourceTableKey: "invoices",
    filters: [{ field: "status", operator: "equals", value: "unpaid" }],
    sort: { field: "due_date", direction: "desc" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "user-1", email: "admin@example.ca" });
  membershipRead = {
    data: { organization_id: "org-1", role: "admin" },
    error: null,
  };
  adminOrgRead = { data: { slug: "acme" }, error: null };
  rlsOrgRead = { data: { id: "org-1" }, error: null };
  removeView.mockResolvedValue({ data: { view: removedView }, error: null });
  addView.mockResolvedValue({ data: { viewKey: "unpaid_invoices" }, error: null });
});

describe("POST /api/schema/views", () => {
  it("valid Admin, remove → 200 and the guarded removeView with the RLS identity + viewKey", async () => {
    const { POST } = await import("@/app/api/schema/views/route");

    const res = await POST(postReq(removeBody));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ action: "remove", view: removedView });

    expect(removeView).toHaveBeenCalledTimes(1);
    const call = removeView.mock.calls[0];
    expect(call[0]).toEqual(
      expect.objectContaining({ actorId: "user-1", orgId: "org-1" }),
    );
    expect(call[1]).toBe("unpaid_invoices");
    expect(addView).not.toHaveBeenCalled();
  });

  it("valid Admin, restore → 200 and the guarded addView with the RLS identity + view", async () => {
    const { POST } = await import("@/app/api/schema/views/route");

    const res = await POST(postReq(restoreBody));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ action: "restore", viewKey: "unpaid_invoices" });

    expect(addView).toHaveBeenCalledTimes(1);
    const call = addView.mock.calls[0];
    expect(call[0]).toEqual(
      expect.objectContaining({ actorId: "user-1", orgId: "org-1" }),
    );
    expect(call[1]).toMatchObject({
      label: "Unpaid invoices",
      sourceTableKey: "invoices",
    });
    expect(removeView).not.toHaveBeenCalled();
  });

  it("401 unauthorized when there is no session", async () => {
    const { POST } = await import("@/app/api/schema/views/route");
    getCurrentUser.mockResolvedValue(null);

    const res = await POST(postReq(removeBody));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(removeView).not.toHaveBeenCalled();
  });

  it("400 on a malformed body (remove with no viewKey), no write", async () => {
    const { POST } = await import("@/app/api/schema/views/route");

    const res = await POST(postReq({ slug: "acme", action: "remove" }));

    expect(res.status).toBe(400);
    expect(removeView).not.toHaveBeenCalled();
  });

  it("400 on an unknown action, no write", async () => {
    const { POST } = await import("@/app/api/schema/views/route");

    const res = await POST(
      postReq({ slug: "acme", action: "nuke", viewKey: "x" }),
    );

    expect(res.status).toBe(400);
    expect(removeView).not.toHaveBeenCalled();
    expect(addView).not.toHaveBeenCalled();
  });

  it("403 forbidden when the caller is a Member (not Admin), no write", async () => {
    const { POST } = await import("@/app/api/schema/views/route");
    membershipRead = {
      data: { organization_id: "org-1", role: "member" },
      error: null,
    };

    const res = await POST(postReq(removeBody));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(removeView).not.toHaveBeenCalled();
  });

  it("403 forbidden when the caller is Admin of a DIFFERENT org than slug (cross-check), no write", async () => {
    const { POST } = await import("@/app/api/schema/views/route");
    adminOrgRead = { data: { slug: "other-org" }, error: null };

    const res = await POST(postReq(removeBody));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(removeView).not.toHaveBeenCalled();
  });

  it("400 removeViewFailed when the guarded layer rejects a missing view (no raw leak)", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/views/route");
    removeView.mockRejectedValue(new AppError(400, "removeViewFailed"));

    const res = await POST(postReq({ ...removeBody, viewKey: "ghost" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("removeViewFailed");
  });

  it("500 writeFailed when the guarded layer throws (raw message never leaks)", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/views/route");
    removeView.mockRejectedValue(
      new AppError(500, "writeFailed", "duplicate key value boom"),
    );

    const res = await POST(postReq(removeBody));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("writeFailed");
    expect(JSON.stringify(body)).not.toContain("boom");
  });
});
