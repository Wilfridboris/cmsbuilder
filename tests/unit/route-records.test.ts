import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for the `/api/records` route family (Story 3.2) WITHOUT a live
 * DB or auth provider — mirroring the sibling `route-invite.test.ts` pattern
 * (mock the caller identity + the Supabase client + `mutate`/`listRecords` +
 * `reportError`, feed a fake `NextRequest`, assert `status` + `{ data, error }`
 * envelope). Locks the frozen I/O & Edge-Case Matrix rows that live in the
 * handlers rather than the pure helpers:
 *   - "Unauthenticated API call"  → 401 unauthorized (GET/POST/DELETE);
 *   - "Non-member slug"           → 403 forbidden (org read under RLS returns null);
 *   - "Submit valid add"          → POST 200 { id, version, data } via mutate insert;
 *   - GET list                    → 200 with listRecords rows;
 *   - "Stale delete (409)"        → DELETE 409 versionConflict when mutate resolves
 *                                    its exact concurrency message (pins the remap);
 *   - other delete failure        → DELETE 500 writeFailed.
 */

const getCurrentUser = vi.fn();
const mutate = vi.fn();
const listRecords = vi.fn();

type MaybeSingle = { data: unknown; error: unknown };
let orgRead: MaybeSingle; // organizations lookup under the RLS client

// The stable concurrency code the guarded layer surfaces (mutate.ts's
// concurrencyError); the DELETE/PATCH routes remap it to a 409 `versionConflict`.
const CONCURRENCY_MESSAGE = "versionConflict";

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

function getReq(query: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/records");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return { nextUrl: url } as unknown as NextRequest;
}

function postReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function deleteReq(query: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/records/rec-1");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return { nextUrl: url } as unknown as NextRequest;
}

function patchReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const deleteParams = { params: Promise.resolve({ id: "rec-1" }) };
const patchParams = { params: Promise.resolve({ id: "rec-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "user-1", email: "u@example.ca" });
  orgRead = { data: { id: "org-1" }, error: null };
  mutate.mockResolvedValue({ data: { id: "rec-9", version: 1 }, error: null });
  listRecords.mockResolvedValue({ data: [], error: null });
});

describe("GET /api/records", () => {
  it("returns the listRecords rows for a member", async () => {
    const { GET } = await import("@/app/api/records/route");
    listRecords.mockResolvedValue({
      data: [{ id: "r1", version: 1, data: { name: "Ada" } }],
      error: null,
    });

    const res = await GET(getReq({ slug: "acme", table: "clients" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual([{ id: "r1", version: 1, data: { name: "Ada" } }]);
    // Scoped to the RLS-resolved org id, never a client-supplied one. The 4th arg
    // is the (empty here) server-side relation-filter list (Story 3.8).
    expect(listRecords).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      "clients",
      [],
    );
  });

  it("401 unauthorized when there is no session", async () => {
    const { GET } = await import("@/app/api/records/route");
    getCurrentUser.mockResolvedValue(null);

    const res = await GET(getReq({ slug: "acme", table: "clients" }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("unauthorized");
    expect(listRecords).not.toHaveBeenCalled();
  });

  it("403 forbidden when the org lookup under RLS returns no row (non-member)", async () => {
    const { GET } = await import("@/app/api/records/route");
    orgRead = { data: null, error: null };

    const res = await GET(getReq({ slug: "not-mine", table: "clients" }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(listRecords).not.toHaveBeenCalled();
  });
});

describe("POST /api/records", () => {
  it("inserts via mutate and returns the reconciled { id, version, data }", async () => {
    const { POST } = await import("@/app/api/records/route");
    const data = { name: "Ada", amount: 12 };

    const res = await POST(
      postReq({ slug: "acme", table: "clients", data, idempotencyKey: "k-1" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ id: "rec-9", version: 1, data });
    // Guarded insert: op, table, payload, and the idempotency key.
    const call = mutate.mock.calls[0];
    expect(call[1]).toBe("insert");
    expect(call[2]).toBe("clients");
    expect(call[3]).toEqual(data);
    expect(call[4]).toEqual({ idempotencyKey: "k-1" });
  });

  it("401 unauthorized when there is no session", async () => {
    const { POST } = await import("@/app/api/records/route");
    getCurrentUser.mockResolvedValue(null);

    const res = await POST(
      postReq({ slug: "acme", table: "clients", data: {}, idempotencyKey: "k" }),
    );

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("400 on a malformed body (missing table)", async () => {
    const { POST } = await import("@/app/api/records/route");

    const res = await POST(
      postReq({ slug: "acme", data: {}, idempotencyKey: "k" }),
    );

    expect(res.status).toBe(400);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("403 forbidden for a non-member slug", async () => {
    const { POST } = await import("@/app/api/records/route");
    orgRead = { data: null, error: null };

    const res = await POST(
      postReq({ slug: "x", table: "clients", data: {}, idempotencyKey: "k" }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("500 writeFailed when mutate reports an error", async () => {
    const { POST } = await import("@/app/api/records/route");
    mutate.mockResolvedValue({ data: null, error: "The write could not be completed." });

    const res = await POST(
      postReq({ slug: "acme", table: "clients", data: {}, idempotencyKey: "k" }),
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("writeFailed");
  });

  it("400 invalidReference when mutate rejects a dangling relation id (Story 3.8)", async () => {
    const { POST } = await import("@/app/api/records/route");
    mutate.mockResolvedValue({ data: null, error: "invalidReference" });

    const res = await POST(
      postReq({
        slug: "acme",
        table: "jobs",
        data: { client: "gone" },
        idempotencyKey: "k",
      }),
    );

    // The referential-integrity rejection surfaces its own translated code, not
    // the generic 500 writeFailed.
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("invalidReference");
  });
});

describe("DELETE /api/records/[id]", () => {
  it("soft-deletes via mutate and returns { deleted: true }", async () => {
    const { DELETE } = await import("@/app/api/records/[id]/route");

    const res = await DELETE(
      deleteReq({ slug: "acme", expectedVersion: "3" }),
      deleteParams,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ deleted: true });
    const call = mutate.mock.calls[0];
    expect(call[1]).toBe("delete");
    expect(call[4]).toEqual({ recordId: "rec-1", expectedVersion: 3 });
  });

  it("401 unauthorized when there is no session", async () => {
    const { DELETE } = await import("@/app/api/records/[id]/route");
    getCurrentUser.mockResolvedValue(null);

    const res = await DELETE(
      deleteReq({ slug: "acme", expectedVersion: "3" }),
      deleteParams,
    );

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("403 forbidden for a non-member slug", async () => {
    const { DELETE } = await import("@/app/api/records/[id]/route");
    orgRead = { data: null, error: null };

    const res = await DELETE(
      deleteReq({ slug: "x", expectedVersion: "3" }),
      deleteParams,
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("400 on a non-numeric expectedVersion (never reaches mutate)", async () => {
    const { DELETE } = await import("@/app/api/records/[id]/route");

    const res = await DELETE(
      deleteReq({ slug: "acme", expectedVersion: "abc" }),
      deleteParams,
    );

    expect(res.status).toBe(400);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("409 versionConflict when mutate resolves the concurrency message", async () => {
    const { DELETE } = await import("@/app/api/records/[id]/route");
    mutate.mockResolvedValue({ data: null, error: CONCURRENCY_MESSAGE });

    const res = await DELETE(
      deleteReq({ slug: "acme", expectedVersion: "3" }),
      deleteParams,
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("versionConflict");
  });

  it("500 writeFailed for any other mutate error", async () => {
    const { DELETE } = await import("@/app/api/records/[id]/route");
    mutate.mockResolvedValue({ data: null, error: "The write could not be completed." });

    const res = await DELETE(
      deleteReq({ slug: "acme", expectedVersion: "3" }),
      deleteParams,
    );

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("writeFailed");
  });
});

describe("PATCH /api/records/[id]", () => {
  it("400 invalidReference when mutate rejects a dangling relation id (Story 3.8)", async () => {
    const { PATCH } = await import("@/app/api/records/[id]/route");
    mutate.mockResolvedValue({ data: null, error: "invalidReference" });

    const res = await PATCH(
      patchReq({
        slug: "acme",
        table: "jobs",
        data: { client: "gone" },
        expectedVersion: 3,
      }),
      patchParams,
    );

    // The referential-integrity rejection surfaces its own translated code, not
    // the generic 500 writeFailed.
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("invalidReference");
  });

  it("updates via mutate and returns the reconciled { id, version, data }", async () => {
    const { PATCH } = await import("@/app/api/records/[id]/route");
    // mutate's update returns the bumped { id, version }; the route echoes the
    // merged `data` it sent (mutate replaces records.data wholesale).
    mutate.mockResolvedValue({ data: { id: "rec-1", version: 4 }, error: null });
    const data = { name: "Ada", amount: 12 };

    const res = await PATCH(
      patchReq({ slug: "acme", table: "clients", data, expectedVersion: 3 }),
      patchParams,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ id: "rec-1", version: 4, data });
    // Guarded update: op, table, merged payload, and the version-gated target.
    const call = mutate.mock.calls[0];
    expect(call[1]).toBe("update");
    expect(call[2]).toBe("clients");
    expect(call[3]).toEqual(data);
    expect(call[4]).toEqual({ recordId: "rec-1", expectedVersion: 3 });
  });

  it("401 unauthorized when there is no session", async () => {
    const { PATCH } = await import("@/app/api/records/[id]/route");
    getCurrentUser.mockResolvedValue(null);

    const res = await PATCH(
      patchReq({ slug: "acme", table: "clients", data: {}, expectedVersion: 3 }),
      patchParams,
    );

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("403 forbidden for a non-member slug", async () => {
    const { PATCH } = await import("@/app/api/records/[id]/route");
    orgRead = { data: null, error: null };

    const res = await PATCH(
      patchReq({ slug: "x", table: "clients", data: {}, expectedVersion: 3 }),
      patchParams,
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("400 on a malformed body (missing table)", async () => {
    const { PATCH } = await import("@/app/api/records/[id]/route");

    const res = await PATCH(
      patchReq({ slug: "acme", data: {}, expectedVersion: 3 }),
      patchParams,
    );

    expect(res.status).toBe(400);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("409 versionConflict when mutate resolves the concurrency message", async () => {
    const { PATCH } = await import("@/app/api/records/[id]/route");
    mutate.mockResolvedValue({ data: null, error: CONCURRENCY_MESSAGE });

    const res = await PATCH(
      patchReq({ slug: "acme", table: "clients", data: {}, expectedVersion: 3 }),
      patchParams,
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("versionConflict");
  });

  it("500 writeFailed for any other mutate error", async () => {
    const { PATCH } = await import("@/app/api/records/[id]/route");
    mutate.mockResolvedValue({ data: null, error: "The write could not be completed." });

    const res = await PATCH(
      patchReq({ slug: "acme", table: "clients", data: {}, expectedVersion: 3 }),
      patchParams,
    );

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("writeFailed");
  });
});
