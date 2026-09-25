import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Unit coverage for `src/middleware.ts` route protection (Story 2.1 gate, 2.2
 * repoint). Locks the frozen matrix row the page/route tests cannot see:
 *   - unauthenticated visit to a protected `/{slug}` → redirect /login?auth=required
 *     (Story 2.2 repointed this from `/` so a returning user has a way back in);
 *   - an authenticated visit to the same slug passes through (no over-redirect);
 *   - the `/login` entry point itself is public (in PUBLIC_TOP_LEVEL) and must NOT
 *     bounce to itself, else an unauthenticated user could never reach the form.
 *
 * `@supabase/ssr` is mocked so `getUser()` returns a scripted user without a live
 * auth provider; the Supabase env is set so the middleware does not early-pass.
 */

const getUser = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  getUser.mockResolvedValue({ data: { user: null } });
});

function req(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`);
}

describe("middleware — tenant-route protection", () => {
  it("redirects an unauthenticated protected /{slug} visit to /login?auth=required", async () => {
    const { middleware } = await import("@/middleware");

    const res = await middleware(req("/mikes-plumbing-laval"));

    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("auth=required");
  });

  it("lets an authenticated user through to their /{slug} dashboard", async () => {
    const { middleware } = await import("@/middleware");
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });

    const res = await middleware(req("/mikes-plumbing-laval"));

    // Pass-through response carries no redirect Location.
    expect(res.headers.get("location")).toBeNull();
  });

  it("treats /login as public and does not bounce it to itself", async () => {
    const { middleware } = await import("@/middleware");

    const res = await middleware(req("/login"));

    expect(res.headers.get("location")).toBeNull();
  });
});
