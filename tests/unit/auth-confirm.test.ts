import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for the cross-device invite-acceptance route `GET /auth/confirm`
 * (Story 2.3), WITHOUT a live auth provider or DB.
 *
 *   - valid token_hash → `verifyOtp` called, org resolved, redirect /{slug};
 *   - failed/expired verify → translated re-request redirect (/login?login=
 *     link-expired), no crash;
 *   - missing token / bad type → same re-request path, verifyOtp not called.
 *
 * The route reuses the 2.2 `resolveUserPrimaryOrgSlug` for the landing slug; it
 * is mocked here (this file must `vi.mock("@/lib/auth/org")` for the route). The
 * `resolveUserOrgMembership` resolver's own logic is unit-tested against a mock
 * admin client in `auth-org.test.ts` (kept there to avoid the mock shadowing the
 * real resolver — mirrors the 2.2 placement decision).
 */

const verifyOtp = vi.fn();
const resolveUserPrimaryOrgSlug = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({ auth: { verifyOtp } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/org", () => ({ resolveUserPrimaryOrgSlug }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

function makeReq(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/auth/confirm");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { nextUrl: url } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyOtp.mockResolvedValue({
    data: { user: { id: "invitee-1", email: "new@example.ca" } },
    error: null,
  });
  resolveUserPrimaryOrgSlug.mockResolvedValue({ slug: "mikes-plumbing-laval" });
});

describe("GET /auth/confirm — cross-device invite acceptance", () => {
  it("verifies the token_hash, resolves the org, and redirects to /{slug}", async () => {
    const { GET } = await import("@/app/auth/confirm/route");

    const res = await GET(makeReq({ token_hash: "th-123", type: "invite" }));

    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: "th-123",
      type: "invite",
    });
    expect(resolveUserPrimaryOrgSlug).toHaveBeenCalledWith(
      "invitee-1",
      expect.anything(),
    );
    expect(res.headers.get("location")).toContain("/mikes-plumbing-laval");
    expect(res.headers.get("location")).not.toContain("login=");
  });

  it("redirects to the translated re-request path on a failed/expired verify", async () => {
    const { GET } = await import("@/app/auth/confirm/route");
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: "Token has expired or is invalid" },
    });

    const res = await GET(makeReq({ token_hash: "expired", type: "invite" }));

    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("login=link-expired");
    // No org resolution attempted on a failed verify.
    expect(resolveUserPrimaryOrgSlug).not.toHaveBeenCalled();
  });

  it("redirects to the re-request path (never verifies) when token_hash is missing", async () => {
    const { GET } = await import("@/app/auth/confirm/route");

    const res = await GET(makeReq({ type: "invite" }));

    expect(res.headers.get("location")).toContain("login=link-expired");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("redirects to the re-request path on an unrecognized type", async () => {
    const { GET } = await import("@/app/auth/confirm/route");

    const res = await GET(makeReq({ token_hash: "th", type: "bogus" }));

    expect(res.headers.get("location")).toContain("login=link-expired");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("routes a verified-but-membershipless user to the re-request path (no crash)", async () => {
    const { GET } = await import("@/app/auth/confirm/route");
    resolveUserPrimaryOrgSlug.mockResolvedValue(null);

    const res = await GET(makeReq({ token_hash: "th", type: "invite" }));

    expect(res.headers.get("location")).toContain("login=link-expired");
  });
});
