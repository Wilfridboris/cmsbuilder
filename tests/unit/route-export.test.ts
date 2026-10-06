import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Auth-gate + completeness coverage for `GET /api/export` (Story 8.4), with no
 * live DB or auth provider — mirroring the sibling `route-records.test.ts`
 * pattern (mock the caller identity + the RLS Supabase client + the data layer +
 * `reportError`, feed a fake `NextRequest`, assert status / envelope). Locks the
 * frozen I/O & Edge-Case Matrix rows that live in the handler:
 *   - "Unauthenticated"    -> 401 unauthorized, BEFORE any read;
 *   - "Non-admin member"   -> 403 forbidden, BEFORE any read;
 *   - "Cross-org slug"     -> 403 forbidden (org read under RLS returns null);
 *   - "Admin export"       -> 200 zip, reading EVERY schema table via listAllRecords;
 *   - "Server failure"     -> 500 genericError when a read reports an error.
 */

const getCurrentUser = vi.fn();
const requireAdmin = vi.fn();
const getSchema = vi.fn();
const listAllRecords = vi.fn();

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
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/lib/auth/rbac", () => ({ requireAdmin }));
vi.mock("@/lib/data/records", () => ({ getSchema, listAllRecords }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

function getReq(slug: string): NextRequest {
  const url = new URL("http://localhost:3000/api/export");
  url.searchParams.set("slug", slug);
  return { nextUrl: url } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "user-1", email: "u@example.ca" });
  // Default: the caller is an admin of the addressed slug.
  orgRead = { data: { id: "org-1", subscription_status: "trial", trial_expires_at: null }, error: null };
  requireAdmin.mockResolvedValue({ orgId: "org-1", slug: "acme", role: "admin" });
  getSchema.mockResolvedValue({
    data: {
      tables: [
        { key: "clients", label: "Clients", fields: [] },
        { key: "jobs", label: "Jobs", fields: [] },
      ],
    },
    error: null,
  });
  listAllRecords.mockResolvedValue({ data: [], error: null });
});

describe("GET /api/export", () => {
  it("401 unauthorized with no session, before any read", async () => {
    const { GET } = await import("@/app/api/export/route");
    getCurrentUser.mockResolvedValue(null);

    const res = await GET(getReq("acme"));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(getSchema).not.toHaveBeenCalled();
    expect(listAllRecords).not.toHaveBeenCalled();
  });

  it("403 forbidden for a non-admin member, before any read", async () => {
    const { GET } = await import("@/app/api/export/route");
    const { AppError } = await import("@/types/api");
    // requireAdmin rejects a member — the admin gate fails before data work.
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));

    const res = await GET(getReq("acme"));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(getSchema).not.toHaveBeenCalled();
    expect(listAllRecords).not.toHaveBeenCalled();
  });

  it("403 forbidden when the org lookup under RLS returns no row (cross-org slug)", async () => {
    const { GET } = await import("@/app/api/export/route");
    orgRead = { data: null, error: null };

    const res = await GET(getReq("someone-else"));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(getSchema).not.toHaveBeenCalled();
    expect(listAllRecords).not.toHaveBeenCalled();
  });

  it("403 forbidden when the admin's membership slug differs from the requested slug", async () => {
    const { GET } = await import("@/app/api/export/route");
    // Admin of a DIFFERENT org than the addressed slug.
    requireAdmin.mockResolvedValue({ orgId: "org-2", slug: "other", role: "admin" });

    const res = await GET(getReq("acme"));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(getSchema).not.toHaveBeenCalled();
  });

  it("200 zip for a valid admin, reading every schema table via listAllRecords", async () => {
    const { GET } = await import("@/app/api/export/route");
    listAllRecords
      .mockResolvedValueOnce({
        data: [{ id: "c1", version: 1, data: { name: "Ada" } }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null });

    const res = await GET(getReq("acme"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toContain("scheza-acme-");
    // Every schema table was read to completeness under the RLS-scoped org id.
    expect(listAllRecords).toHaveBeenCalledTimes(2);
    expect(listAllRecords).toHaveBeenNthCalledWith(1, expect.anything(), "org-1", "clients");
    expect(listAllRecords).toHaveBeenNthCalledWith(2, expect.anything(), "org-1", "jobs");
    // A real archive comes back (non-empty bytes).
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("200 for a read_only / grace-period org (reads are never writability-gated)", async () => {
    const { GET } = await import("@/app/api/export/route");
    // The org is in the Epic 8.5 grace period: read_only. The export is the
    // owner's lifeboat and MUST still succeed — the route uses the admin-but-not-
    // writable gate, so no assertWritable runs and the bundle still comes back.
    orgRead = {
      data: { id: "org-1", subscription_status: "read_only", trial_expires_at: null },
      error: null,
    };

    const res = await GET(getReq("acme"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(listAllRecords).toHaveBeenCalledTimes(2);
  });

  it("500 genericError when a record read reports an error (no partial file)", async () => {
    const { GET } = await import("@/app/api/export/route");
    listAllRecords.mockResolvedValue({ data: null, error: "Failed to load records." });

    const res = await GET(getReq("acme"));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("genericError");
  });
});
