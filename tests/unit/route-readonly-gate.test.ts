import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Integration-ish coverage for the Story 7.4 read-only write gate AT THE ROUTE SEAM,
 * mirroring `route-records.test.ts`'s mocking (mock the caller identity + the RLS
 * Supabase client's org-by-slug read + `mutate`/`listRecords` + `reportError`). Pins
 * the frozen I/O & Edge-Case Matrix rows that the writable resolver introduces:
 *   - Write while read_only          → POST 403 readOnly, mutate NEVER called;
 *   - Write while trial expired      → POST 403 readOnly (cron not yet run);
 *   - Write while writable (active)  → POST proceeds (200);
 *   - Read while read_only           → GET returns data normally (never gated).
 */

const getCurrentUser = vi.fn();
const mutate = vi.fn();
const listRecords = vi.fn();

type MaybeSingle = { data: unknown; error: unknown };
let orgRead: MaybeSingle; // organizations lookup under the RLS client

function makeClient() {
  return {
    from() {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => orgRead }),
        }),
      };
    },
  };
}

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => makeClient(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/lib/data/mutate", () => ({ mutate }));
vi.mock("@/lib/data/records", () => ({ listRecords }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

function postReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
function getReq(query: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/records");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return { nextUrl: url } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "user-1", email: "u@example.ca" });
  mutate.mockResolvedValue({ data: { id: "rec-9", version: 1 }, error: null });
  listRecords.mockResolvedValue({ data: [], error: null });
});

describe("POST /api/records write gate (Story 7.4)", () => {
  it("403 readOnly when the org is read_only, and mutate is never called", async () => {
    const { POST } = await import("@/app/api/records/route");
    orgRead = {
      data: { id: "org-1", subscription_status: "read_only", trial_expires_at: null },
      error: null,
    };

    const res = await POST(
      postReq({ slug: "acme", table: "clients", data: { name: "x" }, idempotencyKey: "k" }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("readOnly");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("403 readOnly when the org is a trial past its expiry (cron not yet run)", async () => {
    const { POST } = await import("@/app/api/records/route");
    orgRead = {
      data: { id: "org-1", subscription_status: "trial", trial_expires_at: PAST },
      error: null,
    };

    const res = await POST(
      postReq({ slug: "acme", table: "clients", data: { name: "x" }, idempotencyKey: "k" }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("readOnly");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("proceeds (200) when the org is writable (active)", async () => {
    const { POST } = await import("@/app/api/records/route");
    orgRead = {
      data: { id: "org-1", subscription_status: "active", trial_expires_at: null },
      error: null,
    };

    const res = await POST(
      postReq({ slug: "acme", table: "clients", data: { name: "x" }, idempotencyKey: "k" }),
    );

    expect(res.status).toBe(200);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("proceeds (200) when the org is a non-expired trial", async () => {
    const { POST } = await import("@/app/api/records/route");
    orgRead = {
      data: { id: "org-1", subscription_status: "trial", trial_expires_at: FUTURE },
      error: null,
    };

    const res = await POST(
      postReq({ slug: "acme", table: "clients", data: { name: "x" }, idempotencyKey: "k" }),
    );

    expect(res.status).toBe(200);
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/records is never gated (Story 7.4)", () => {
  it("returns data normally even when the org is read_only", async () => {
    const { GET } = await import("@/app/api/records/route");
    orgRead = {
      data: { id: "org-1", subscription_status: "read_only", trial_expires_at: null },
      error: null,
    };
    listRecords.mockResolvedValue({
      data: [{ id: "r1", version: 1, data: { name: "Ada" } }],
      error: null,
    });

    const res = await GET(getReq({ slug: "acme", table: "clients" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual([{ id: "r1", version: 1, data: { name: "Ada" } }]);
    expect(listRecords).toHaveBeenCalledTimes(1);
  });
});
