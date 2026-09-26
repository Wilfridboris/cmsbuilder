import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for `GET /auth/confirm` — the single cross-device landing for
 * login, claim, AND invite (SiteURL `token_hash`/`verifyOtp` flow), WITHOUT a
 * live auth provider or DB. Covers the frozen I/O matrix:
 *
 *   - login / invite / claim re-entry land: verifyOtp OK + existing membership →
 *     resolveUserPrimaryOrgSlug → /{slug}, with NO finalize + NO metadata write;
 *   - first claim land: verifyOtp OK + no membership → finalizeClaimByEmail
 *     (bootstrap) → write consent + policy_version metadata → /{slug};
 *   - metadata-write failure on the claim path still lands the user on /{slug};
 *   - verified user with no membership AND no pending claim → /login?login=no-org;
 *   - failed/expired verify + missing/bad params → the per-flow re-request surface
 *     (claim `next=claim` → /?claim=…; else → /login?login=link-expired);
 *   - a finalize ClaimError kind expired/failed → the claim re-request surface.
 *
 * The route reuses `resolveUserPrimaryOrgSlug` (2.2) and `finalizeClaimByEmail`;
 * both are mocked here. Their own logic is unit-tested against mock clients in
 * `auth-org.test.ts` / `claim.test.ts` (kept there to avoid the mock shadowing
 * the real resolver — mirrors the 2.2 placement decision). `CURRENT_POLICY_VERSION`
 * is imported by the route from `@/app/api/claim/route`, which is real here.
 */

const verifyOtp = vi.fn();
const updateUser = vi.fn();
const resolveUserPrimaryOrgSlug = vi.fn();
const finalizeClaimByEmail = vi.fn();

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
  createServerSupabaseClient: () => ({ auth: { verifyOtp, updateUser } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/org", () => ({ resolveUserPrimaryOrgSlug }));
vi.mock("@/lib/claim/claim", () => ({ finalizeClaimByEmail, ClaimError }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

const CONSENT_AT = "2026-09-24T12:00:00.000Z";

function makeReq(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/auth/confirm");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { nextUrl: url } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyOtp.mockResolvedValue({
    data: { user: { id: "u1", email: "new@example.ca" } },
    error: null,
  });
  updateUser.mockResolvedValue({ error: null });
  resolveUserPrimaryOrgSlug.mockResolvedValue({ slug: "mikes-plumbing-laval" });
  finalizeClaimByEmail.mockResolvedValue({
    slug: "plumbing-laval",
    consentAcceptedAt: CONSENT_AT,
  });
});

describe("GET /auth/confirm — login / invite / claim re-entry (existing membership)", () => {
  it("verifies, resolves the org, and lands /{slug} with NO finalize or metadata write", async () => {
    const { GET } = await import("@/app/auth/confirm/route");

    const res = await GET(makeReq({ token_hash: "th-123", type: "magiclink" }));

    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: "th-123",
      type: "magiclink",
    });
    expect(resolveUserPrimaryOrgSlug).toHaveBeenCalledWith(
      "u1",
      expect.anything(),
    );
    expect(res.headers.get("location")).toContain("/mikes-plumbing-laval");
    expect(res.headers.get("location")).not.toContain("login=");
    // Login/invite/re-entry never finalizes a claim or writes metadata.
    expect(finalizeClaimByEmail).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("lands invite acceptance byte-for-byte the same (type=invite)", async () => {
    const { GET } = await import("@/app/auth/confirm/route");

    const res = await GET(makeReq({ token_hash: "th", type: "invite" }));

    expect(res.headers.get("location")).toContain("/mikes-plumbing-laval");
    expect(finalizeClaimByEmail).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe("GET /auth/confirm — first claim land (no membership yet)", () => {
  it("finalizes the claim by email, writes consent + policy metadata, and lands /{slug}", async () => {
    const { GET } = await import("@/app/auth/confirm/route");
    const { CURRENT_POLICY_VERSION } = await import("@/app/api/claim/route");
    resolveUserPrimaryOrgSlug.mockResolvedValue(null);

    const res = await GET(
      makeReq({ token_hash: "th", type: "signup", next: "claim" }),
    );

    // Finalize by the VERIFIED email — no claim_token in the link.
    expect(finalizeClaimByEmail).toHaveBeenCalledWith(
      "new@example.ca",
      "u1",
      expect.anything(),
    );
    // Consent timestamp is the TRUE submit-time value from the pending claim;
    // policy version is recorded; NO role is written to metadata.
    expect(updateUser).toHaveBeenCalledTimes(1);
    const arg = updateUser.mock.calls[0][0];
    expect(arg.data.consent_accepted_at).toBe(CONSENT_AT);
    expect(arg.data.policy_version).toBe(CURRENT_POLICY_VERSION);
    expect(arg.data.role).toBeUndefined();

    expect(res.headers.get("location")).toContain("/plumbing-laval");
    expect(res.headers.get("location")).not.toContain("claim=");
  });

  it("still lands /{slug} when the consent metadata write fails (never strand a live org)", async () => {
    const { GET } = await import("@/app/auth/confirm/route");
    resolveUserPrimaryOrgSlug.mockResolvedValue(null);
    updateUser.mockResolvedValue({ error: { message: "metadata write failed" } });

    const res = await GET(
      makeReq({ token_hash: "th", type: "signup", next: "claim" }),
    );

    // The org/membership are already live; a metadata failure is swallowed.
    expect(finalizeClaimByEmail).toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/plumbing-laval");
    expect(res.headers.get("location")).not.toContain("claim=");
  });

  it("maps a finalize ClaimError kind=expired to the claim re-request surface", async () => {
    const { GET } = await import("@/app/auth/confirm/route");
    resolveUserPrimaryOrgSlug.mockResolvedValue(null);
    finalizeClaimByEmail.mockRejectedValue(new ClaimError("expired", "expired"));

    const res = await GET(
      makeReq({ token_hash: "th", type: "signup", next: "claim" }),
    );

    const location = res.headers.get("location") ?? "";
    expect(location).toContain("claim=expired");
  });

  it("maps a finalize ClaimError kind=failed to the claim error surface", async () => {
    const { GET } = await import("@/app/auth/confirm/route");
    resolveUserPrimaryOrgSlug.mockResolvedValue(null);
    finalizeClaimByEmail.mockRejectedValue(new ClaimError("failed", "boom"));

    const res = await GET(
      makeReq({ token_hash: "th", type: "signup", next: "claim" }),
    );

    expect(res.headers.get("location")).toContain("claim=error");
  });
});

describe("GET /auth/confirm — verified, no org, no pending claim", () => {
  it("routes to /login?login=no-org (finalize returns not-found)", async () => {
    const { GET } = await import("@/app/auth/confirm/route");
    resolveUserPrimaryOrgSlug.mockResolvedValue(null);
    finalizeClaimByEmail.mockRejectedValue(new ClaimError("not-found", "none"));

    const res = await GET(makeReq({ token_hash: "th", type: "magiclink" }));

    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("login=no-org");
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe("GET /auth/confirm — failure / re-request surface selection", () => {
  it("failed verify on a login link → /login?login=link-expired", async () => {
    const { GET } = await import("@/app/auth/confirm/route");
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: "Token has expired or is invalid" },
    });

    const res = await GET(makeReq({ token_hash: "expired", type: "magiclink" }));

    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("login=link-expired");
    expect(resolveUserPrimaryOrgSlug).not.toHaveBeenCalled();
  });

  it("failed verify on a claim link (next=claim) → /?claim=expired", async () => {
    const { GET } = await import("@/app/auth/confirm/route");
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: "Token has expired or is invalid" },
    });

    const res = await GET(
      makeReq({ token_hash: "expired", type: "signup", next: "claim" }),
    );

    const location = res.headers.get("location") ?? "";
    expect(location).toContain("claim=expired");
    expect(location).not.toContain("login=");
  });

  it("missing token_hash → re-request surface, verifyOtp NOT called", async () => {
    const { GET } = await import("@/app/auth/confirm/route");

    const res = await GET(makeReq({ type: "magiclink" }));

    expect(res.headers.get("location")).toContain("login=link-expired");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("missing token_hash on a claim link → /?claim=expired, verifyOtp NOT called", async () => {
    const { GET } = await import("@/app/auth/confirm/route");

    const res = await GET(makeReq({ type: "signup", next: "claim" }));

    expect(res.headers.get("location")).toContain("claim=expired");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("unrecognized type → re-request surface, verifyOtp NOT called", async () => {
    const { GET } = await import("@/app/auth/confirm/route");

    const res = await GET(makeReq({ token_hash: "th", type: "bogus" }));

    expect(res.headers.get("location")).toContain("login=link-expired");
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
