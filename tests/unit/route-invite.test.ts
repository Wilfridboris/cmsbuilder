import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for `POST /api/invite` (Story 2.3) WITHOUT a live DB or auth
 * provider. Locks the frozen I/O matrix rows 1-7 end-to-end through the REAL
 * `inviteMember` + `resolveUserOrgMembership` (only the caller identity and the
 * service-role admin client are mocked):
 *   1. valid admin invite  → inviteUserByEmail + org_members insert w/ chosen role,
 *                            200 { sent:true };
 *   2. invalid email       → 400 invalidEmail (no create/send);
 *   3. invalid/missing role → 400 invalidRole (no create/send);
 *   4. non-admin caller    → 403 forbidden (no row, no email);
 *   5. unauthenticated     → 401 (no row, no email);
 *   6. already a member of this org → idempotent 200 { sent:true }, no dup row, no email;
 *   7. existing account elsewhere   → 409 accountExists;
 * plus the `{ data, error }` envelope shape on every path.
 *
 * The admin client is a scriptable stub: `.auth.admin.listUsers/inviteUserByEmail`
 * for the account lookup + invite, and a `.from(table)` query chain for the
 * membership reads/insert.
 */

const getCurrentUser = vi.fn();
const listUsers = vi.fn();
const inviteUserByEmail = vi.fn();
const orgMembersInsert = vi.fn();

// Scripted per-table read results. Keyed by a call sequence the tests set up.
type MaybeSingle = { data: unknown; error: unknown };
let membershipRead: MaybeSingle; // resolveUserOrgMembership → org_members
let orgRead: MaybeSingle; // resolveUserOrgMembership → organizations
let memberOfOrgRead: MaybeSingle; // isMemberOfOrg → org_members

function makeAdminClient() {
  return {
    auth: {
      admin: {
        listUsers,
        inviteUserByEmail,
      },
    },
    from(table: string) {
      // resolveUserOrgMembership: org_members has .order().limit(); the
      // isMemberOfOrg read on org_members does NOT — disambiguate by chain.
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => orgRead }),
          }),
        };
      }
      // org_members: two distinct read shapes + the insert.
      return {
        select: () => ({
          eq: () => ({
            // isMemberOfOrg: .eq().eq().maybeSingle()
            eq: () => ({ maybeSingle: async () => memberOfOrgRead }),
            // resolveUserOrgMembership: .eq().order().limit().maybeSingle()
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
  createAdminClient: () => makeAdminClient(),
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

function makeReq(body: unknown): NextRequest {
  return {
    json: async () => body,
    nextUrl: { origin: "http://localhost:3000" },
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: an authenticated ADMIN of "org-1" (slug irrelevant to the route).
  getCurrentUser.mockResolvedValue({ id: "admin-1", email: "admin@example.ca" });
  membershipRead = {
    data: { organization_id: "org-1", role: "admin" },
    error: null,
  };
  orgRead = { data: { slug: "mikes-plumbing-laval" }, error: null };
  memberOfOrgRead = { data: null, error: null };
  // Default: the invitee is a brand-new email (no existing account).
  listUsers.mockResolvedValue({ data: { users: [] }, error: null });
  inviteUserByEmail.mockResolvedValue({
    data: { user: { id: "invitee-1" } },
    error: null,
  });
  orgMembersInsert.mockResolvedValue({ error: null });
});

describe("POST /api/invite", () => {
  it("row 1 — valid admin invite: sends the email and inserts the membership with the chosen role", async () => {
    const { POST } = await import("@/app/api/invite/route");

    const res = await POST(makeReq({ email: "new@example.ca", role: "member" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ sent: true });

    // The branded invite email is dispatched with the role + confirm redirect.
    expect(inviteUserByEmail).toHaveBeenCalledTimes(1);
    const [inviteEmail, inviteOpts] = inviteUserByEmail.mock.calls[0];
    expect(inviteEmail).toBe("new@example.ca");
    expect(inviteOpts.data).toEqual({ role: "member" });
    expect(inviteOpts.redirectTo).toContain("/auth/confirm");

    // The org_members row is scoped to the inviter's org with the chosen role.
    expect(orgMembersInsert).toHaveBeenCalledTimes(1);
    expect(orgMembersInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        user_id: "invitee-1",
        principal_type: "human",
        role: "member",
      }),
    );
  });

  it("row 1b — an admin-role invite writes role:'admin' in both places", async () => {
    const { POST } = await import("@/app/api/invite/route");

    const res = await POST(makeReq({ email: "new@example.ca", role: "admin" }));

    expect(res.status).toBe(200);
    expect(inviteUserByEmail.mock.calls[0][1].data).toEqual({ role: "admin" });
    expect(orgMembersInsert).toHaveBeenCalledWith(
      expect.objectContaining({ role: "admin" }),
    );
  });

  it("row 2 — malformed email → 400 invalidEmail, nothing created/sent", async () => {
    const { POST } = await import("@/app/api/invite/route");

    const res = await POST(makeReq({ email: "not-an-email", role: "member" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("invalidEmail");
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(orgMembersInsert).not.toHaveBeenCalled();
  });

  it("row 3 — role outside {admin,member} → 400 invalidRole", async () => {
    const { POST } = await import("@/app/api/invite/route");

    const res = await POST(makeReq({ email: "new@example.ca", role: "owner" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalidRole");
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("row 3b — missing role → 400 invalidRole", async () => {
    const { POST } = await import("@/app/api/invite/route");

    const res = await POST(makeReq({ email: "new@example.ca" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalidRole");
  });

  it("row 4 — a Member caller → 403 forbidden, no row, no email", async () => {
    const { POST } = await import("@/app/api/invite/route");
    membershipRead = {
      data: { organization_id: "org-1", role: "member" },
      error: null,
    };

    const res = await POST(makeReq({ email: "new@example.ca", role: "member" }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("forbidden");
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(orgMembersInsert).not.toHaveBeenCalled();
  });

  it("row 4b — a non-member caller (no membership) → 403 forbidden", async () => {
    const { POST } = await import("@/app/api/invite/route");
    membershipRead = { data: null, error: null };

    const res = await POST(makeReq({ email: "new@example.ca", role: "member" }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("row 5 — unauthenticated caller → 401, no row, no email", async () => {
    const { POST } = await import("@/app/api/invite/route");
    getCurrentUser.mockResolvedValue(null);

    const res = await POST(makeReq({ email: "new@example.ca", role: "member" }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("unauthorized");
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(orgMembersInsert).not.toHaveBeenCalled();
  });

  it("row 6 — inviting an existing member of this org is an idempotent success (no dup row, no email)", async () => {
    const { POST } = await import("@/app/api/invite/route");
    // The email already has an account which IS a member of org-1.
    listUsers.mockResolvedValue({
      data: { users: [{ id: "existing-1", email: "teammate@example.ca" }] },
      error: null,
    });
    memberOfOrgRead = { data: { id: "m-1" }, error: null };

    const res = await POST(
      makeReq({ email: "teammate@example.ca", role: "member" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ sent: true });
    // Idempotent: no new account created, no duplicate membership inserted.
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(orgMembersInsert).not.toHaveBeenCalled();
  });

  it("row 7 — inviting an email tied to an account on ANOTHER org → 409 accountExists", async () => {
    const { POST } = await import("@/app/api/invite/route");
    // The email has an account, but it is NOT a member of org-1.
    listUsers.mockResolvedValue({
      data: { users: [{ id: "other-1", email: "elsewhere@example.ca" }] },
      error: null,
    });
    memberOfOrgRead = { data: null, error: null };

    const res = await POST(
      makeReq({ email: "elsewhere@example.ca", role: "member" }),
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("accountExists");
    // Cross-org add is deferred: no invite email, no membership row.
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(orgMembersInsert).not.toHaveBeenCalled();
  });

  it("maps a provider send failure to 502 sendFailed (never leaks the raw message)", async () => {
    const { POST } = await import("@/app/api/invite/route");
    inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: { message: "smtp unavailable" },
    });

    const res = await POST(makeReq({ email: "new@example.ca", role: "member" }));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("sendFailed");
    expect(body.error).not.toContain("smtp");
    expect(orgMembersInsert).not.toHaveBeenCalled();
  });

  it("treats a unique-violation (23505) on the membership insert as an idempotent success", async () => {
    const { POST } = await import("@/app/api/invite/route");
    // A concurrent resend races the unique (organization_id, user_id) index.
    orgMembersInsert.mockResolvedValue({ error: { code: "23505" } });

    const res = await POST(makeReq({ email: "new@example.ca", role: "member" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ sent: true });
  });

  it("maps a non-unique-violation insert error to 500 genericError (never leaks the raw message)", async () => {
    const { POST } = await import("@/app/api/invite/route");
    orgMembersInsert.mockResolvedValue({
      error: { code: "23514", message: "boom" },
    });

    const res = await POST(makeReq({ email: "new@example.ca", role: "member" }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("genericError");
    expect(body.error).not.toContain("boom");
  });
});
