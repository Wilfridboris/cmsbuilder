import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for `GET /home` — the installed PWA's `start_url` resolver
 * (spec-8-2), WITHOUT a live auth provider or DB. Covers the frozen I/O matrix's
 * "Installed launch" row and its error handling:
 *
 *   - valid session + primary org  -> redirect /{slug}
 *   - no session (or getUser error) -> redirect /login
 *   - session but no org            -> redirect /login?login=no-org
 *   - any thrown fault              -> degrade to /login (never a raw error)
 *
 * The route reuses `resolveUserPrimaryOrgSlug` (its own logic is unit-tested in
 * `auth-org.test.ts`); it is mocked here so this test exercises only the route's
 * branch/redirect wiring, mirroring the `auth-confirm.test.ts` placement.
 */

const getUser = vi.fn();
const resolveUserPrimaryOrgSlug = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({ auth: { getUser } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/org", () => ({ resolveUserPrimaryOrgSlug }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

function makeReq(): NextRequest {
  const url = new URL("http://localhost:3000/home");
  return { nextUrl: url } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  resolveUserPrimaryOrgSlug.mockResolvedValue({ slug: "mikes-plumbing-laval" });
});

describe("GET /home — installed PWA start_url resolver", () => {
  it("valid session + primary org -> redirects to /{slug}", async () => {
    const { GET } = await import("@/app/home/route");

    const res = await GET(makeReq());

    expect(resolveUserPrimaryOrgSlug).toHaveBeenCalledWith("u1", expect.anything());
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/mikes-plumbing-laval");
    expect(location).not.toContain("/login");
  });

  it("no session -> redirects to /login (no org resolution attempted)", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import("@/app/home/route");

    const res = await GET(makeReq());

    expect(resolveUserPrimaryOrgSlug).not.toHaveBeenCalled();
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).not.toContain("login=no-org");
  });

  it("getUser error is treated as no session -> /login", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "boom" },
    });
    const { GET } = await import("@/app/home/route");

    const res = await GET(makeReq());

    expect(res.headers.get("location")).toContain("/login");
  });

  it("session but no org -> redirects to /login?login=no-org", async () => {
    resolveUserPrimaryOrgSlug.mockResolvedValue(null);
    const { GET } = await import("@/app/home/route");

    const res = await GET(makeReq());

    expect(res.headers.get("location")).toContain("login=no-org");
  });

  it("a thrown fault degrades to /login rather than a raw error", async () => {
    resolveUserPrimaryOrgSlug.mockRejectedValue(new Error("db down"));
    const { GET } = await import("@/app/home/route");

    const res = await GET(makeReq());

    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).not.toContain("no-org");
  });
});
