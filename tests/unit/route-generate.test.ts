import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for the `POST /api/generate` orchestration (Story 1.4) WITHOUT a
 * live LLM or DB. The pipeline collaborators (Gemini client, validator, provision,
 * records read-back, admin client) are mocked; `session.ts` is REAL so the signed
 * cookie round-trip is exercised end-to-end. Asserts: 502 + `data:null` on two
 * consecutive failures (with no provisioning), 200 + a signed `Set-Cookie` on
 * success, org reuse from a valid incoming cookie, and 422 on a malformed body
 * with no LLM call.
 */

const callGeminiWithTimeout = vi.fn();
const validateGeneratedSchema = vi.fn();
const provisionGeneration = vi.fn();
const getSchema = vi.fn();
const listRecords = vi.fn();

vi.mock("@/lib/gemini/client", () => ({ callGeminiWithTimeout }));
vi.mock("@/lib/gemini/prompts", () => ({
  buildGenerationPrompt: () => "inflated prompt",
  GENERATION_RESPONSE_SCHEMA: {},
}));
vi.mock("@/lib/schema/validator", () => ({ validateGeneratedSchema }));
vi.mock("@/lib/generation/provision", () => ({ provisionGeneration }));
vi.mock("@/lib/data/records", () => ({ getSchema, listRecords }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/observability/report", () => ({
  reportError: vi.fn(),
  reportRejection: vi.fn(),
}));

const VALID_INTENT = {
  tradeType: "hvac",
  city: "Barrie",
  whatYouTrack: "jobs, quotes, clients",
  submittedLocale: "en",
};

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
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GENERATE_SESSION_SECRET = "test-secret";
  // Default happy-path wiring; individual tests override as needed.
  callGeminiWithTimeout.mockResolvedValue({ schema: SCHEMA, seedRows: {} });
  validateGeneratedSchema.mockReturnValue({ valid: true, sanitized: SCHEMA });
  provisionGeneration.mockResolvedValue({ orgId: "org-new", schema: SCHEMA });
  getSchema.mockResolvedValue({ data: SCHEMA, error: null });
  listRecords.mockResolvedValue({
    data: [{ id: "r1", version: 1, data: { name: "Maple Ridge" } }],
    error: null,
  });
});

afterEach(() => {
  delete process.env.GENERATE_SESSION_SECRET;
});

describe("POST /api/generate", () => {
  it("returns 200 with the reveal payload and sets a signed session cookie", async () => {
    const { POST } = await import("@/app/api/generate/route");
    const { SESSION_COOKIE_NAME, decodeSessionValue } = await import(
      "@/lib/generation/session"
    );

    const res = await POST(makeReq(VALID_INTENT));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.schema).toEqual(SCHEMA);
    expect(body.data.records.clients).toHaveLength(1);

    // A fresh org was minted (no incoming cookie).
    expect(provisionGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: undefined }),
    );
    // The Set-Cookie is a valid signed value that decodes back to the org id.
    const cookie = res.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie?.value).toBeTruthy();
    expect(decodeSessionValue(cookie!.value)).toBe("org-new");
  });

  it("reuses the org id from a valid incoming signed cookie", async () => {
    const { POST } = await import("@/app/api/generate/route");
    const { encodeSessionValue } = await import("@/lib/generation/session");
    provisionGeneration.mockResolvedValue({ orgId: "org-existing", schema: SCHEMA });

    const signed = encodeSessionValue("org-existing");
    const res = await POST(makeReq(VALID_INTENT, signed));

    expect(res.status).toBe(200);
    expect(provisionGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-existing" }),
    );
  });

  it("degrades to 502 with data:null after two consecutive failures, without provisioning", async () => {
    const { POST } = await import("@/app/api/generate/route");
    callGeminiWithTimeout.mockRejectedValue(new Error("boom"));

    const res = await POST(makeReq(VALID_INTENT));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBeTruthy();
    // Exactly one retry (two attempts), and nothing was provisioned.
    expect(callGeminiWithTimeout).toHaveBeenCalledTimes(2);
    expect(provisionGeneration).not.toHaveBeenCalled();
  });

  it("returns 422 for a malformed body and never calls the LLM", async () => {
    const { POST } = await import("@/app/api/generate/route");

    const res = await POST(makeReq({ tradeType: "hvac" })); // missing fields
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(callGeminiWithTimeout).not.toHaveBeenCalled();
  });
});
