import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for `POST /auth/signout` (Story 15.1) — the sign-out route the
 * home card / DashboardNav button post to. Closes the frozen I/O-matrix row:
 *   - Sign out: `supabase.auth.signOut()` is called, then a 303 redirect to `/`;
 *   - signOut error → it STILL redirects to `/` (never strands the user), the
 *     error is reported but not surfaced.
 *
 * `next/headers`, the RLS-scoped server client, and the reporter are mocked
 * (mirroring `route-claim.test.ts`); `NextResponse.redirect` runs for real so
 * the redirect status + Location are observable.
 */

const signOut = vi.fn();
const reportError = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({ auth: { signOut } }),
}));
vi.mock("@/lib/observability/report", () => ({ reportError }));

function makeReq(): NextRequest {
  return {
    nextUrl: { origin: "http://localhost:3000" },
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  signOut.mockResolvedValue({ error: null });
});

describe("POST /auth/signout", () => {
  it("calls supabase.auth.signOut() then 303-redirects to /", async () => {
    const { POST } = await import("@/app/auth/signout/route");

    const res = await POST(makeReq());

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
    // A clean sign-out reports nothing.
    expect(reportError).not.toHaveBeenCalled();
  });

  it("STILL 303-redirects to / when signOut() returns an error (never strands)", async () => {
    signOut.mockResolvedValue({ error: { message: "network down" } });
    const { POST } = await import("@/app/auth/signout/route");

    const res = await POST(makeReq());

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
    // The error is logged, not surfaced to the user.
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("STILL 303-redirects to / when the sign-out call throws", async () => {
    signOut.mockRejectedValue(new Error("boom"));
    const { POST } = await import("@/app/auth/signout/route");

    const res = await POST(makeReq());

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});
