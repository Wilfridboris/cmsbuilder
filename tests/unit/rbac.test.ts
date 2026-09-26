import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

import { requireAdmin } from "@/lib/auth/rbac";
import { AppError } from "@/types/api";

/**
 * Unit coverage for the RBAC enforcement primitive `requireAdmin` (Story 2.4) —
 * the single reusable "caller must be an Admin of their org" guard — plus a
 * regression assertion that the refactored `POST /api/invite` still rejects a
 * Member with 403 through the shared guard.
 *
 * `requireAdmin` runs against the REAL `resolveUserOrgMembership` (only the
 * service-role admin client's read chain is mocked), so the DB-backed role
 * resolution is exercised, not stubbed away:
 *   - Admin of their org      → returns { orgId, slug, role:'admin' };
 *   - Member                  → 403 forbidden;
 *   - null user (no session)  → 401 unauthorized (no membership read);
 *   - no membership row       → 403 forbidden.
 */

/**
 * Two-read admin-client stub mimicking the supabase-js chain
 * `resolveUserOrgMembership` uses: `.from('org_members')...maybeSingle()` then
 * `.from('organizations')...maybeSingle()`. Each `.from` pops the next queued
 * result.
 */
function makeAdmin(results: Array<{ data: unknown; error: unknown }>) {
  let call = -1;
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => results[call],
  };
  return {
    from: () => {
      call += 1;
      return builder;
    },
  } as never;
}

const adminUser = { id: "admin-1" } as User;

describe("requireAdmin", () => {
  it("returns the membership when the caller is an Admin of their org", async () => {
    const admin = makeAdmin([
      { data: { organization_id: "org-1", role: "admin" }, error: null },
      { data: { slug: "mikes-plumbing-laval" }, error: null },
    ]);

    const result = await requireAdmin(adminUser, admin);

    expect(result).toEqual({
      orgId: "org-1",
      slug: "mikes-plumbing-laval",
      role: "admin",
    });
  });

  it("rejects a Member with 403 forbidden", async () => {
    const admin = makeAdmin([
      { data: { organization_id: "org-1", role: "member" }, error: null },
      { data: { slug: "acme" }, error: null },
    ]);

    await expect(requireAdmin(adminUser, admin)).rejects.toMatchObject({
      statusCode: 403,
      userMessage: "forbidden",
    });
  });

  it("rejects a null (unauthenticated) caller with 401 unauthorized and never reads membership", async () => {
    const read = vi.fn();
    const admin = { from: read } as never;

    await expect(requireAdmin(null, admin)).rejects.toMatchObject({
      statusCode: 401,
      userMessage: "unauthorized",
    });
    // 401 short-circuits before any DB read.
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects a caller with no membership row with 403 forbidden", async () => {
    const admin = makeAdmin([{ data: null, error: null }]);

    await expect(requireAdmin(adminUser, admin)).rejects.toMatchObject({
      statusCode: 403,
      userMessage: "forbidden",
    });
  });

  it("surfaces an AppError instance (envelope-mappable) on rejection", async () => {
    await expect(requireAdmin(null, {} as never)).rejects.toBeInstanceOf(AppError);
  });
});

/**
 * Regression: `POST /api/invite` still 403s a Member THROUGH the refactored
 * guard. Mirrors the route-invite harness (mock `getCurrentUser` + a scriptable
 * admin client) but asserts the invite path routes its admin check through
 * `requireAdmin` — no divergent inlined check.
 */

const getCurrentUser = vi.fn();
const listUsers = vi.fn();
const inviteUserByEmail = vi.fn();
const orgMembersInsert = vi.fn();

let membershipRead: { data: unknown; error: unknown };
let orgRead: { data: unknown; error: unknown };

function makeInviteAdminClient() {
  return {
    auth: { admin: { listUsers, inviteUserByEmail } },
    from(table: string) {
      if (table === "organizations") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => orgRead }) }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            order: () => ({
              limit: () => ({ maybeSingle: async () => membershipRead }),
            }),
          }),
        }),
        insert: orgMembersInsert,
      };
    },
  };
}

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeInviteAdminClient(),
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

function makeReq(body: unknown): NextRequest {
  return {
    json: async () => body,
    nextUrl: { origin: "http://localhost:3000" },
  } as unknown as NextRequest;
}

describe("POST /api/invite regression through requireAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ id: "member-1", email: "m@example.ca" });
    membershipRead = {
      data: { organization_id: "org-1", role: "member" },
      error: null,
    };
    orgRead = { data: { slug: "acme" }, error: null };
    listUsers.mockResolvedValue({ data: { users: [] }, error: null });
    inviteUserByEmail.mockResolvedValue({
      data: { user: { id: "invitee-1" } },
      error: null,
    });
    orgMembersInsert.mockResolvedValue({ error: null });
  });

  it("still rejects a Member with 403 forbidden and no side effect", async () => {
    const { POST } = await import("@/app/api/invite/route");

    const res = await POST(makeReq({ email: "new@example.ca", role: "member" }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("forbidden");
    // No account created, no membership row — the guard rejects before any effect.
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(orgMembersInsert).not.toHaveBeenCalled();
  });
});
