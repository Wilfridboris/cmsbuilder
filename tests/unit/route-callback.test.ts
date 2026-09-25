import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for the `GET /auth/callback` route (Story 2.1) WITHOUT a live
 * auth provider or DB. This is the observable end of the magic-link round trip,
 * and its redirect wiring is the sole input to the landing page's `ClaimNotice`
 * (`?claim=expired|error`) and the post-claim dashboard (`/{slug}`). Covers the
 * frozen matrix rows the logic-layer `claim.test.ts` cannot see:
 *   - missing code (opened without the PKCE handshake) → ?claim=expired;
 *   - exchange failure (expired/invalid link, cross-device)  → ?claim=expired;
 *   - valid exchange but no claim_token                      → ?claim=error;
 *   - finalize ClaimError kind=expired                       → ?claim=expired;
 *   - finalize ClaimError kind=not-found/failed             → ?claim=error;
 *   - success → redirect to /{slug} and consent timestamp (the TRUE submit-time
 *     value returned by finalizeClaim) written to the user metadata.
 */

const exchangeCodeForSession = vi.fn();
const updateUser = vi.fn();
const finalizeClaim = vi.fn();

class ClaimError extends Error {
  constructor(
    readonly kind: "not-found" | "expired" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "ClaimError";
  }
}

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({
    auth: { exchangeCodeForSession, updateUser },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/claim/claim", () => ({ finalizeClaim, ClaimError }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

const CONSENT_AT = "2026-09-24T12:00:00.000Z";

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
  finalizeClaim.mockResolvedValue({
    slug: "plumbing-laval",
    consentAcceptedAt: CONSENT_AT,
  });
});

describe("GET /auth/callback", () => {
  it("redirects to ?claim=expired when the code is missing", async () => {
    const { GET } = await import("@/app/auth/callback/route");
    const res = await GET(makeReq({}));
    expect(res.headers.get("location")).toContain("claim=expired");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("redirects to ?claim=expired when the code exchange fails", async () => {
    const { GET } = await import("@/app/auth/callback/route");
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid or expired" },
    });
    const res = await GET(makeReq({ code: "c", claim_token: "tok" }));
    expect(res.headers.get("location")).toContain("claim=expired");
    expect(finalizeClaim).not.toHaveBeenCalled();
  });

  it("redirects to ?claim=error on a valid exchange with no claim_token", async () => {
    const { GET } = await import("@/app/auth/callback/route");
    const res = await GET(makeReq({ code: "c" }));
    expect(res.headers.get("location")).toContain("claim=error");
    expect(finalizeClaim).not.toHaveBeenCalled();
  });

  it("maps a finalize ClaimError kind=expired to ?claim=expired", async () => {
    const { GET } = await import("@/app/auth/callback/route");
    finalizeClaim.mockRejectedValue(new ClaimError("expired", "expired"));
    const res = await GET(makeReq({ code: "c", claim_token: "tok" }));
    expect(res.headers.get("location")).toContain("claim=expired");
  });

  it("maps a finalize ClaimError kind=not-found to ?claim=error", async () => {
    const { GET } = await import("@/app/auth/callback/route");
    finalizeClaim.mockRejectedValue(new ClaimError("not-found", "gone"));
    const res = await GET(makeReq({ code: "c", claim_token: "tok" }));
    expect(res.headers.get("location")).toContain("claim=error");
  });

  it("on success redirects to /{slug} and writes the true consent timestamp", async () => {
    const { GET } = await import("@/app/auth/callback/route");
    const res = await GET(makeReq({ code: "c", claim_token: "tok" }));

    expect(res.headers.get("location")).toContain("/plumbing-laval");
    expect(res.headers.get("location")).not.toContain("claim=");
    // The consent timestamp written to the user is the submit-time value from
    // the pending claim, NOT the callback time.
    expect(updateUser).toHaveBeenCalledTimes(1);
    const arg = updateUser.mock.calls[0][0];
    expect(arg.data.consent_accepted_at).toBe(CONSENT_AT);
    expect(arg.data.role).toBe("admin");
  });
});
