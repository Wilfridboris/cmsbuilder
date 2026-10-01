import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for `POST /api/schema/add-field` (Story 5.1) WITHOUT a live DB,
 * LLM, or auth provider. Locks the frozen I/O & Edge-Case Matrix rows that live in
 * the handler (the pure validator/transform are covered in schema-add-field.test.ts),
 * end-to-end through the REAL `requireAdmin` + `resolveUserOrgMembership` (only the
 * caller identity, the admin client, the RLS org lookup, the schema read, the
 * Gemini call, and the guarded `addField` are mocked):
 *   - unauthenticated                        → 401, no LLM, no write;
 *   - malformed body                         → 400, no LLM, no write;
 *   - Member (non-admin) of the target org   → 403, no LLM, no write;
 *   - Admin of a DIFFERENT org than `slug`   → 403, no LLM, no write;
 *   - applied add_field                      → 200 { kind: 'applied', tableKey, fieldKey }, write ran;
 *   - needs_clarification                    → 200 { kind: 'clarify' }, NO write;
 *   - out_of_scope                           → 200 { kind: 'declined' }, NO write;
 *   - validator rejection (addFieldFailed)   → 200 { kind: 'rejected' }, translated copy, no raw leak;
 *   - LLM timeout/failure                    → 200 { kind: 'degraded' }, NO write, nothing leaked.
 *
 * Mirrors `route-schema-fields.test.ts`. `next-intl/server` is mocked to echo the
 * copy KEY so assistant text is assertable without the catalog.
 */

const getCurrentUser = vi.fn();
const addField = vi.fn();
const getSchema = vi.fn();
const callGeminiWithTimeout = vi.fn();

type MaybeSingle = { data: unknown; error: unknown };
let membershipRead: MaybeSingle;
let adminOrgRead: MaybeSingle;
let rlsOrgRead: MaybeSingle;

function makeAdminClient() {
  return {
    from(table: string) {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => adminOrgRead }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ maybeSingle: async () => membershipRead }),
            }),
          }),
        }),
      };
    },
  };
}

function makeRlsClient() {
  return {
    from() {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => rlsOrgRead }),
        }),
      };
    },
  };
}

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClient(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => makeRlsClient(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/lib/data/schema-mutate", () => ({ addField }));
vi.mock("@/lib/data/records", () => ({ getSchema }));
vi.mock("@/lib/gemini/client", () => ({ callGeminiWithTimeout }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

function postReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const validBody = { slug: "acme", message: "add a warranty date to Jobs" };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "user-1", email: "admin@example.ca" });
  membershipRead = {
    data: { organization_id: "org-1", role: "admin" },
    error: null,
  };
  adminOrgRead = { data: { slug: "acme" }, error: null };
  rlsOrgRead = {
    data: { id: "org-1", subscription_status: "trial", trial_expires_at: null },
    error: null,
  };
  getSchema.mockResolvedValue({
    data: {
      tables: [{ key: "jobs", label: "Jobs", fields: [] }],
    },
    error: null,
  });
  callGeminiWithTimeout.mockResolvedValue({
    kind: "add_field",
    tableKey: "jobs",
    label: "Warranty date",
    type: "date",
  });
  addField.mockResolvedValue({
    data: { tableKey: "jobs", fieldKey: "warranty_date" },
    error: null,
  });
});

describe("POST /api/schema/add-field", () => {
  it("applied: valid Admin add_field → 200 applied, guarded write ran", async () => {
    const { POST } = await import("@/app/api/schema/add-field/route");
    const res = await POST(postReq(validBody));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.kind).toBe("applied");
    expect(body.data.tableKey).toBe("jobs");
    expect(body.data.fieldKey).toBe("warranty_date");
    expect(addField).toHaveBeenCalledTimes(1);
    const call = addField.mock.calls[0];
    expect(call[0]).toEqual(
      expect.objectContaining({ actorId: "user-1", orgId: "org-1" }),
    );
    expect(call[1]).toBe("jobs");
    expect(call[2]).toEqual({ label: "Warranty date", type: "date" });
  });

  it("401 unauthorized when there is no session, no LLM call, no write", async () => {
    const { POST } = await import("@/app/api/schema/add-field/route");
    getCurrentUser.mockResolvedValue(null);

    const res = await POST(postReq(validBody));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(callGeminiWithTimeout).not.toHaveBeenCalled();
    expect(addField).not.toHaveBeenCalled();
  });

  it("400 on a malformed body (missing message), no LLM, no write", async () => {
    const { POST } = await import("@/app/api/schema/add-field/route");
    const res = await POST(postReq({ slug: "acme" }));

    expect(res.status).toBe(400);
    expect(callGeminiWithTimeout).not.toHaveBeenCalled();
    expect(addField).not.toHaveBeenCalled();
  });

  it("403 when the caller is a Member (not Admin), no LLM, no write", async () => {
    const { POST } = await import("@/app/api/schema/add-field/route");
    membershipRead = {
      data: { organization_id: "org-1", role: "member" },
      error: null,
    };

    const res = await POST(postReq(validBody));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(callGeminiWithTimeout).not.toHaveBeenCalled();
    expect(addField).not.toHaveBeenCalled();
  });

  it("403 when the caller is Admin of a DIFFERENT org than the slug", async () => {
    const { POST } = await import("@/app/api/schema/add-field/route");
    adminOrgRead = { data: { slug: "other-org" }, error: null };

    const res = await POST(postReq(validBody));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(callGeminiWithTimeout).not.toHaveBeenCalled();
    expect(addField).not.toHaveBeenCalled();
  });

  it("clarify: needs_clarification → 200 clarify, NO write", async () => {
    const { POST } = await import("@/app/api/schema/add-field/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "needs_clarification",
      question: "Which table should Price go on - Jobs or Clients?",
    });

    const res = await POST(postReq({ slug: "acme", message: "add a price field" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("clarify");
    expect(body.data.assistantText).toContain("Which table");
    expect(addField).not.toHaveBeenCalled();
  });

  it("declined: out_of_scope → 200 declined, NO write", async () => {
    const { POST } = await import("@/app/api/schema/add-field/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "out_of_scope",
      reply: "I can only add a column right now.",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "delete the status column" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("declined");
    expect(addField).not.toHaveBeenCalled();
  });

  it("rejected: validator rejection → 200 rejected with fixed copy, no raw leak", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/add-field/route");
    addField.mockRejectedValue(new AppError(400, "addFieldFailed"));

    const res = await POST(postReq(validBody));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("rejected");
    expect(body.data.assistantText).toBe("rejection");
    expect(body.data.assistantText).not.toContain("addFieldFailed");
  });

  it("degraded: LLM timeout → 200 degraded, NO write, nothing leaked", async () => {
    const { POST } = await import("@/app/api/schema/add-field/route");
    callGeminiWithTimeout.mockRejectedValue(new Error("Gemini timeout"));

    const res = await POST(postReq(validBody));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("degraded");
    expect(body.data.assistantText).toBe("degraded");
    expect(addField).not.toHaveBeenCalled();
  });

  it("degraded: a write 5xx degrades gracefully (CRUD unaffected)", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/add-field/route");
    addField.mockRejectedValue(new AppError(500, "writeFailed", "boom sql"));

    const res = await POST(postReq(validBody));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("degraded");
    expect(body.data.assistantText).not.toContain("boom");
  });
});
