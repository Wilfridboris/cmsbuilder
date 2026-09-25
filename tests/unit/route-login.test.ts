import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for the `POST /api/login` route (Story 2.2) WITHOUT a live DB or
 * auth provider. Locks the login endpoint contract — the frozen anti-enumeration
 * decision especially:
 *   - valid email       → dispatches `signInWithOtp` with `shouldCreateUser:false`,
 *                         NO `claim_token` in emailRedirectTo, NO `data.role`;
 *                         returns 200 { sent:true };
 *   - invalid email     → 400 invalidEmail (never dispatches);
 *   - unknown email / no-user provider outcome → STILL 200 { sent:true } (the
 *                         provider error is logged + swallowed into success), so
 *                         a login request never reveals which emails are registered;
 *   - genuine transport/send failure (no enumerating signal) → 502 sendFailed so
 *                         the user can retry (frozen I/O matrix, row 1);
 *   - unexpected throw   → 500 genericError (outer catch, no stack leak);
 *   - `{ data, error }`  envelope shape on every path.
 *
 * The server (RLS-scoped) client + reporter are mocked; there is no session
 * cookie, schema, or consent (login is claim's mirror, minus the bootstrap).
 */

const signInWithOtp = vi.fn();
const reportError = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({ auth: { signInWithOtp } }),
}));
vi.mock("@/lib/observability/report", () => ({ reportError }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

function makeReq(body: unknown): NextRequest {
  return {
    json: async () => body,
    nextUrl: { origin: "http://localhost:3000" },
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  signInWithOtp.mockResolvedValue({ error: null });
});

describe("POST /api/login", () => {
  it("dispatches a login magic link with shouldCreateUser:false, no claim_token, no role", async () => {
    const { POST } = await import("@/app/api/login/route");

    const res = await POST(makeReq({ email: "owner@example.ca" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ sent: true });

    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    const otpArg = signInWithOtp.mock.calls[0][0];
    expect(otpArg.email).toBe("owner@example.ca");
    // Anti-enumeration + no-clobber: login must never create a user or set role.
    expect(otpArg.options.shouldCreateUser).toBe(false);
    expect(otpArg.options.data).toBeUndefined();
    // Login lands on the bare callback — the claim_token path is claim-only.
    expect(otpArg.options.emailRedirectTo).toContain("/auth/callback");
    expect(otpArg.options.emailRedirectTo).not.toContain("claim_token");
  });

  it("returns 400 invalidEmail for a malformed email and never dispatches", async () => {
    const { POST } = await import("@/app/api/login/route");

    const res = await POST(makeReq({ email: "not-an-email" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("invalidEmail");
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("returns 400 invalidEmail when the body is not valid JSON", async () => {
    const { POST } = await import("@/app/api/login/route");
    const req = {
      json: async () => {
        throw new Error("bad json");
      },
      nextUrl: { origin: "http://localhost:3000" },
    } as unknown as NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalidEmail");
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("returns the SAME success envelope for an unknown email (anti-enumeration)", async () => {
    const { POST } = await import("@/app/api/login/route");
    // The provider rejects an unknown email / signups-not-allowed outcome.
    signInWithOtp.mockResolvedValue({
      error: { message: "Signups not allowed for otp" },
    });

    const res = await POST(makeReq({ email: "stranger@example.ca" }));

    // Indistinguishable from a valid send: same 200 { sent:true } envelope.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ sent: true });
    // The provider outcome is logged (server-side) but never surfaced.
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("returns 502 sendFailed on a genuine transport/send failure", async () => {
    const { POST } = await import("@/app/api/login/route");
    // No enumerating signal (not a no-user outcome) → SMTP/transport failure is
    // safe to surface so the user can retry rather than await a phantom email.
    signInWithOtp.mockResolvedValue({
      error: { message: "smtp unavailable", code: "unexpected_failure" },
    });

    const res = await POST(makeReq({ email: "owner@example.ca" }));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("sendFailed");
    // Still logged server-side.
    expect(reportError).toHaveBeenCalled();
  });

  it("returns 500 genericError (no stack leak) when signInWithOtp throws", async () => {
    const { POST } = await import("@/app/api/login/route");
    signInWithOtp.mockRejectedValue(new Error("network exploded"));

    const res = await POST(makeReq({ email: "owner@example.ca" }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.data).toBeNull();
    // Translated code only — never the raw provider/stack message.
    expect(body.error).toBe("genericError");
    expect(body.error).not.toContain("network exploded");
  });
});
