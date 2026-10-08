import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for `POST /api/claim/slug-check` (Story 15.1) — the best-effort
 * availability check the claim modal calls. Covers the I/O-matrix rows:
 *   - available: a free, non-reserved base → { available:true, normalized };
 *   - reserved:  a reserved base → guarded + suggestion, still checked;
 *   - taken:     an existing slug → { available:false, suggestion:'base-2' };
 *   - error:     a DB fault → 500 genericError, never a leaked message.
 *
 * The admin client is mocked with a controllable fake over `organizations`;
 * `reportError` is mocked. The slug derivation/guard is REAL (pure).
 */

type OrgRow = { id: string; slug: string };
let orgs: OrgRow[] = [];
let lookupError: { message: string } | null = null;

function makeAdmin() {
  return {
    from(_table: string) {
      const builder = {
        _slug: "",
        select() {
          return this;
        },
        eq(_col: string, val: string) {
          this._slug = val;
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle() {
          if (lookupError) {
            return Promise.resolve({ data: null, error: lookupError });
          }
          const row = orgs.find((o) => o.slug === this._slug) ?? null;
          return Promise.resolve({ data: row, error: null });
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => makeAdmin() }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

function makeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  orgs = [];
  lookupError = null;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("POST /api/claim/slug-check", () => {
  it("reports a free, non-reserved base as available", async () => {
    const { POST } = await import("@/app/api/claim/slug-check/route");
    const res = await POST(makeReq({ slug: "joes-plumbing" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ available: true, normalized: "joes-plumbing" });
  });

  it("derives from the business name when no slug is given", async () => {
    const { POST } = await import("@/app/api/claim/slug-check/route");
    const res = await POST(makeReq({ name: "Joe's Plumbing" }));
    const body = await res.json();
    expect(body.data.available).toBe(true);
    expect(body.data.normalized).toBe("joes-plumbing");
  });

  it("guards a reserved base and surfaces the guarded form as a suggestion", async () => {
    const { POST } = await import("@/app/api/claim/slug-check/route");
    const res = await POST(makeReq({ slug: "login" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    // The guard rewrote `login` -> `login-app`; it is free, so available.
    expect(body.data.normalized).toBe("login-app");
    expect(body.data.available).toBe(true);
    expect(body.data.suggestion).toBe("login-app");
  });

  it("reports a taken base as unavailable with a base-N suggestion", async () => {
    orgs = [{ id: "a", slug: "joes-plumbing" }];
    const { POST } = await import("@/app/api/claim/slug-check/route");
    const res = await POST(makeReq({ slug: "joes-plumbing" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.available).toBe(false);
    expect(body.data.normalized).toBe("joes-plumbing");
    expect(body.data.suggestion).toBe("joes-plumbing-2");
  });

  it("returns 500 genericError on a DB fault, never leaking the message", async () => {
    lookupError = { message: "connection refused to db host 10.0.0.1" };
    const { POST } = await import("@/app/api/claim/slug-check/route");
    const res = await POST(makeReq({ slug: "joes-plumbing" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("genericError");
    // The raw DB message must never reach the client.
    expect(JSON.stringify(body)).not.toContain("10.0.0.1");
  });

  it("returns 400 invalidBody for a non-JSON body", async () => {
    const { POST } = await import("@/app/api/claim/slug-check/route");
    const bad = {
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as NextRequest;
    const res = await POST(bad);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalidBody");
  });
});
