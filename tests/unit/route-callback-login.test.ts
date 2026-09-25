import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for the returning-user LOGIN branch of `GET /auth/callback`
 * (Story 2.2) and the `resolveUserPrimaryOrgSlug` resolver, WITHOUT a live auth
 * provider or DB. Locks the frozen matrix rows the claim-layer tests cannot see:
 *   - no `claim_token` + resolvable org  → redirect /{slug} (login landing);
 *   - no `claim_token` + no membership   → redirect /login?login=no-org;
 *   - missing code / failed exchange     → still the expired re-request path.
 *
 * The `resolveUserPrimaryOrgSlug` resolver itself is mocked here (this file must
 * mock `@/lib/auth/org` for the callback branch); its own logic is unit-tested
 * against a mock admin client in `auth-org.test.ts`.
 */

const exchangeCodeForSession = vi.fn();
const updateUser = vi.fn();
const finalizeClaim = vi.fn();
const resolveUserPrimaryOrgSlug = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({
    auth: { exchangeCodeForSession, updateUser },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/claim/claim", () => ({
  finalizeClaim,
  ClaimError: class ClaimError extends Error {
    constructor(
      readonly kind: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/auth/org", () => ({ resolveUserPrimaryOrgSlug }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

function makeReq(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/auth/callback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { nextUrl: url } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  exchangeCodeForSession.mockResolvedValue({
    data: { user: { id: "u1", email: "owner@example.ca" } },
    error: null,
  });
  updateUser.mockResolvedValue({ error: null });
});

describe("GET /auth/callback — returning-user login (no claim_token)", () => {
  it("resolves the primary org slug and redirects to /{slug}", async () => {
    const { GET } = await import("@/app/auth/callback/route");
    resolveUserPrimaryOrgSlug.mockResolvedValue({ slug: "mikes-plumbing-laval" });

    const res = await GET(makeReq({ code: "c" }));

    expect(resolveUserPrimaryOrgSlug).toHaveBeenCalledWith("u1", expect.anything());
    expect(res.headers.get("location")).toContain("/mikes-plumbing-laval");
    expect(res.headers.get("location")).not.toContain("claim=");
    // Login must not finalize a claim or write role/consent metadata.
    expect(finalizeClaim).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("redirects to /login?login=no-org when the user has no membership", async () => {
    const { GET } = await import("@/app/auth/callback/route");
    resolveUserPrimaryOrgSlug.mockResolvedValue(null);

    const res = await GET(makeReq({ code: "c" }));

    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("login=no-org");
    expect(finalizeClaim).not.toHaveBeenCalled();
  });

  it("redirects to ?claim=error when the org resolution throws", async () => {
    const { GET } = await import("@/app/auth/callback/route");
    resolveUserPrimaryOrgSlug.mockRejectedValue(new Error("db down"));

    const res = await GET(makeReq({ code: "c" }));

    expect(res.headers.get("location")).toContain("claim=error");
  });

  it("still hits the expired path on a missing code (no resolution attempted)", async () => {
    const { GET } = await import("@/app/auth/callback/route");

    const res = await GET(makeReq({}));

    expect(res.headers.get("location")).toContain("claim=expired");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(resolveUserPrimaryOrgSlug).not.toHaveBeenCalled();
  });

  it("still hits the expired path on a failed exchange (no resolution attempted)", async () => {
    const { GET } = await import("@/app/auth/callback/route");
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid or expired" },
    });

    const res = await GET(makeReq({ code: "c" }));

    expect(res.headers.get("location")).toContain("claim=expired");
    expect(resolveUserPrimaryOrgSlug).not.toHaveBeenCalled();
  });
});
