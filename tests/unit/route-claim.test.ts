import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for the `POST /api/claim` route (Story 2.1) WITHOUT a live DB or
 * auth provider. Covers the frozen I/O-matrix rows enforced at the ROUTE layer —
 * the ones `claim.test.ts` (logic layer) intentionally does not exercise:
 *   - consent unchecked  → 400 consentRequired (the hard server-side gate);
 *   - invalid email      → 400 invalidEmail;
 *   - missing session    → 400 noSession;
 *   - valid submit       → persists the claim (createPendingClaim) and dispatches
 *                          the magic link (signInWithOtp) landing on /auth/confirm
 *                          (no claim_token — resolved server-side by verified
 *                          email), returning 200 { sent:true }.
 *
 * `session.ts` is REAL so the signed-cookie round-trip is exercised; the admin
 * client, server (RLS-scoped) client, claim bootstrap, and reporter are mocked.
 */

const createPendingClaim = vi.fn();
const signInWithOtp = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({ auth: { signInWithOtp } }),
}));
vi.mock("@/lib/claim/claim", () => ({
  createPendingClaim,
  ClaimError: class ClaimError extends Error {
    constructor(
      readonly kind: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

const SCHEMA = {
  tables: [
    {
      key: "clients",
      label: "Clients",
      fields: [{ key: "name", label: "Name", type: "text" }],
    },
  ],
};

function makeReq(body: unknown, cookieValue?: string): NextRequest {
  return {
    json: async () => body,
    cookies: {
      get: (name: string) =>
        cookieValue && name ? { value: cookieValue } : undefined,
    },
    nextUrl: { origin: "http://localhost:3000" },
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GENERATE_SESSION_SECRET = "test-secret";
  createPendingClaim.mockResolvedValue({ token: "tok-123" });
  signInWithOtp.mockResolvedValue({ error: null });
});

afterEach(() => {
  delete process.env.GENERATE_SESSION_SECRET;
});

describe("POST /api/claim", () => {
  it("hard-blocks with 400 consentRequired when consent is not checked", async () => {
    const { POST } = await import("@/app/api/claim/route");

    const res = await POST(
      makeReq({ email: "owner@example.ca", consent: false, schema: SCHEMA }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("consentRequired");
    // Consent is the hard gate: no claim persisted, no link dispatched.
    expect(createPendingClaim).not.toHaveBeenCalled();
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("returns 400 invalidEmail for a malformed email", async () => {
    const { POST } = await import("@/app/api/claim/route");

    const res = await POST(
      makeReq({ email: "not-an-email", consent: true, schema: SCHEMA }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalidEmail");
    expect(createPendingClaim).not.toHaveBeenCalled();
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("returns 400 noSession when the signed session cookie is missing", async () => {
    const { POST } = await import("@/app/api/claim/route");

    const res = await POST(
      makeReq({ email: "owner@example.ca", consent: true, schema: SCHEMA }),
      // no cookie
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("noSession");
    expect(createPendingClaim).not.toHaveBeenCalled();
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("persists the claim and dispatches a magic link with the token on a valid submit", async () => {
    const { POST } = await import("@/app/api/claim/route");
    const { encodeSessionValue } = await import("@/lib/generation/session");

    const signed = encodeSessionValue("org-x");
    const res = await POST(
      makeReq(
        {
          email: "owner@example.ca",
          consent: true,
          schema: SCHEMA,
          intent: { tradeType: "plumbing", city: "Laval" },
        },
        signed,
      ),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ sent: true });

    // The overridden schema + session org are handed to the bootstrap.
    expect(createPendingClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionOrgId: "org-x",
        email: "owner@example.ca",
        schema: SCHEMA,
        slugBase: "plumbing-laval",
      }),
      expect.anything(),
    );

    // The magic link lands on /auth/confirm and carries NO claim_token — the
    // confirm route resolves claim vs login server-side by the verified email.
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    const otpArg = signInWithOtp.mock.calls[0][0];
    expect(otpArg.email).toBe("owner@example.ca");
    expect(otpArg.options.shouldCreateUser).toBe(true);
    expect(otpArg.options.emailRedirectTo).toContain("/auth/confirm");
    expect(otpArg.options.emailRedirectTo).not.toContain("/auth/callback");
    expect(otpArg.options.emailRedirectTo).not.toContain("claim_token");
    // No role is seeded into user metadata: the authoritative role is recorded in
    // org_members at finalizeClaim; RBAC never reads a metadata role scalar.
    expect(otpArg.options.data?.role).toBeUndefined();
  });

  it("returns 502 sendFailed when the magic-link dispatch fails", async () => {
    const { POST } = await import("@/app/api/claim/route");
    const { encodeSessionValue } = await import("@/lib/generation/session");
    // The pending claim persists, but the OTP provider (Supabase→Resend) errors.
    signInWithOtp.mockResolvedValue({ error: { message: "smtp unavailable" } });

    const res = await POST(
      makeReq(
        { email: "owner@example.ca", consent: true, schema: SCHEMA },
        encodeSessionValue("org-x"),
      ),
    );

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("sendFailed");
    // The claim was persisted before the send was attempted.
    expect(createPendingClaim).toHaveBeenCalled();
  });

  it("returns 500 genericError when persisting the pending claim throws", async () => {
    const { POST } = await import("@/app/api/claim/route");
    const { encodeSessionValue } = await import("@/lib/generation/session");
    const { ClaimError } = await import("@/lib/claim/claim");
    createPendingClaim.mockRejectedValue(
      new (ClaimError as unknown as new (k: string, m: string) => Error)(
        "failed",
        "db down",
      ),
    );

    const res = await POST(
      makeReq(
        { email: "owner@example.ca", consent: true, schema: SCHEMA },
        encodeSessionValue("org-x"),
      ),
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("genericError");
    // The failure is caught before any link dispatch.
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});
