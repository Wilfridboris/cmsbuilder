import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for the `POST /api/generate` orchestration (Stories 1.4 + 1.5)
 * WITHOUT a live LLM or DB. The pipeline collaborators (Gemini client, validator,
 * provision, records read-back, admin client) are mocked; `session.ts` is REAL so
 * the signed cookie round-trip is exercised end-to-end. Asserts: 200 + a signed
 * `Set-Cookie` on success, org reuse from a valid incoming cookie, 422 on a
 * malformed body with no LLM call, and — the Story 1.5 seam — that two consecutive
 * generation failures provision the hardcoded fallback template (200 + `isFallback`
 * + cookie, NOT a 502), degrading to a last-resort 502 ONLY if the fallback
 * provisioning itself throws.
 */

const callGeminiWithTimeout = vi.fn();
const validateGeneratedSchema = vi.fn();
const provisionGeneration = vi.fn();
const getSchema = vi.fn();
const listRecords = vi.fn();
const reportError = vi.fn();
const reportCritical = vi.fn();

// REAL classifier + model id: the route branches on `isModelNotFoundError` and
// tags the critical report with `GEMINI_MODEL`, so the mock forwards to the
// actual module for both rather than stubbing the decision. Only the network
// entry point (`callGeminiWithTimeout`) is replaced with a spy.
vi.mock("@/lib/gemini/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gemini/client")>(
    "@/lib/gemini/client",
  );
  return {
    callGeminiWithTimeout,
    isModelNotFoundError: actual.isModelNotFoundError,
    GEMINI_MODEL: actual.GEMINI_MODEL,
  };
});
vi.mock("@/lib/gemini/prompts", () => ({
  buildGenerationPrompt: () => "inflated prompt",
  GENERATION_RESPONSE_SCHEMA: {},
}));
vi.mock("@/lib/schema/validator", () => ({ validateGeneratedSchema }));
vi.mock("@/lib/generation/provision", () => ({ provisionGeneration }));
vi.mock("@/lib/data/records", () => ({ getSchema, listRecords }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/observability/report", () => ({
  reportError,
  reportCritical,
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
    // A real generation is not a fallback.
    expect(body.data.isFallback).toBe(false);

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

  it("provisions the fallback template (200 + isFallback + cookie) after two consecutive failures", async () => {
    const { POST } = await import("@/app/api/generate/route");
    const { UNIVERSAL_FIELD_SERVICE_TEMPLATE } = await import(
      "@/lib/generation/fallback"
    );
    const { SESSION_COOKIE_NAME, decodeSessionValue } = await import(
      "@/lib/generation/session"
    );
    callGeminiWithTimeout.mockRejectedValue(new Error("boom"));
    // Read-back returns whatever was provisioned; make it the fallback schema so
    // the 200 reveal reflects the template.
    const fallbackDefinition = {
      ...UNIVERSAL_FIELD_SERVICE_TEMPLATE,
      isFallback: true,
    };
    provisionGeneration.mockResolvedValue({
      orgId: "org-fallback",
      schema: fallbackDefinition,
    });
    getSchema.mockResolvedValue({ data: fallbackDefinition, error: null });
    listRecords.mockResolvedValue({ data: [], error: null });

    const res = await POST(makeReq(VALID_INTENT));

    // No error screen: the fallback path returns 200, not a 502.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.isFallback).toBe(true);
    // Exactly one retry (two attempts) before the fallback fires.
    expect(callGeminiWithTimeout).toHaveBeenCalledTimes(2);
    // The fallback template + seed rows were handed to provisioning with the flag
    // and a distinct idempotency-key prefix (so its rows can't collide with a
    // prior real generation's `gen-seed-*` keys in a reused org).
    expect(provisionGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: expect.objectContaining({ isFallback: true }),
        idempotencyPrefix: "fallback",
      }),
    );
    // A session cookie is still set on the fallback reveal.
    const cookie = res.cookies.get(SESSION_COOKIE_NAME);
    expect(decodeSessionValue(cookie!.value)).toBe("org-fallback");
  });

  it("escalates a double model-not-found failure to reportCritical (with the model id), still serving the 200 fallback", async () => {
    const { POST } = await import("@/app/api/generate/route");
    // A retired/unresolvable model: the live API returns 404 on every call.
    const modelNotFound = Object.assign(
      new Error("models/gemini-3.8-flash is not found for API version v1beta"),
      { status: 404 },
    );
    callGeminiWithTimeout.mockRejectedValue(modelNotFound);

    const res = await POST(makeReq(VALID_INTENT));

    // User-facing behavior is unchanged: still the 200 fallback reveal.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.isFallback).toBe(true);

    // Both attempt failures paged at CRITICAL severity, carrying the offending
    // model id + the stable reason marker so the alert is actionable.
    expect(reportCritical).toHaveBeenCalledTimes(2);
    expect(reportCritical).toHaveBeenCalledWith(
      modelNotFound,
      expect.objectContaining({
        reason: "gemini-model-unresolved",
        model: "gemini-3.8-flash",
      }),
    );
    // A model-not-found failure must NOT also go through the ordinary path.
    expect(reportError).not.toHaveBeenCalledWith(
      modelNotFound,
      expect.anything(),
    );
  });

  it("keeps a generic double failure on ordinary reportError (never reportCritical), still serving the 200 fallback", async () => {
    const { POST } = await import("@/app/api/generate/route");
    const transient = new Error("Gemini timeout");
    callGeminiWithTimeout.mockRejectedValue(transient);

    const res = await POST(makeReq(VALID_INTENT));

    // Still the 200 fallback reveal — no error screen.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.isFallback).toBe(true);

    // A transient failure stays at ordinary severity: no false page.
    expect(reportCritical).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(
      transient,
      expect.objectContaining({ attempt: 1 }),
    );
    expect(reportError).toHaveBeenCalledWith(
      transient,
      expect.objectContaining({ attempt: 2 }),
    );
  });

  it("degrades to a last-resort 502 only if the fallback provisioning itself throws", async () => {
    const { POST } = await import("@/app/api/generate/route");
    callGeminiWithTimeout.mockRejectedValue(new Error("boom"));
    // Fallback provisioning fails too (e.g. total DB outage).
    provisionGeneration.mockRejectedValue(new Error("db down"));

    const res = await POST(makeReq(VALID_INTENT));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBeTruthy();
    // Two generation attempts, then exactly one fallback provisioning attempt.
    expect(callGeminiWithTimeout).toHaveBeenCalledTimes(2);
    expect(provisionGeneration).toHaveBeenCalledTimes(1);
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
