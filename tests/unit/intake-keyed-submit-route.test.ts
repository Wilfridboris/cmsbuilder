import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import type {
  FieldDefinition,
  SchemaDefinition,
  TableDefinition,
} from "@/types/db";

/**
 * Unit coverage for the NEW public FORM-KEYED handler
 * `POST /api/intake/[slug]/[formSlug]` (Epic 14, Story 14.2), the headline multi-form
 * write surface. The shared `submitToTarget` write/coerce/notify envelope is proven in
 * `intake-submit-route.test.ts` against the legacy route; this file locks the delta
 * unique to the keyed route — the two keyed I/O & Edge-Case Matrix rows at the HANDLER
 * layer:
 *   - keyed submission happy path → 200 { ok: true }; the resolver is called with BOTH
 *     `orgSlug` AND `formSlug` (never trusting the client for the table), and the write
 *     lands under INTAKE_ACTOR_ID scoped to the resolved org/table;
 *   - keyed unavailable (unknown/unpublished form, null/stale target) → 400 generic,
 *     NO write, no internals — the resolver's null collapses to the same envelope.
 *
 * `resolvePublicFormTarget` and `mutate` are mocked; the REAL `submitToTarget` runs so
 * the keyed route's wiring into the shared write path is exercised end-to-end.
 */

const resolvePublicFormTarget = vi.fn();
const mutate = vi.fn();
const createAdminClient = vi.fn(() => ({ __admin: true }));
const INTAKE_ACTOR_ID = "00000000-0000-0000-0000-0000000000b0";
const resolveAdminEmails = vi.fn();
const resolveOrgLanguage = vi.fn();
const sendIntakeSubmissionEmail = vi.fn();
const reportError = vi.fn();

vi.mock("@/lib/data/forms-public", () => ({ resolvePublicFormTarget }));
vi.mock("@/lib/data/mutate", () => ({ mutate, INTAKE_ACTOR_ID }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/orgs/org-recipients", () => ({
  resolveAdminEmails,
  resolveOrgLanguage,
}));
vi.mock("@/lib/resend/intake-notification", () => ({ sendIntakeSubmissionEmail }));
vi.mock("@/lib/observability/report", () => ({ reportError }));

function postReq(body: unknown): NextRequest {
  return {
    json: async () => body,
    nextUrl: { origin: "https://app.example.com" },
  } as unknown as NextRequest;
}

function paramsFor(slug: string, formSlug: string) {
  return { params: Promise.resolve({ slug, formSlug }) };
}

const FIELDS: FieldDefinition[] = [
  { key: "full_name", label: "Full Name", type: "text" },
  { key: "email", label: "Email", type: "email" },
];

const TABLE: TableDefinition = { key: "leads", label: "Leads", fields: FIELDS };
const SCHEMA: SchemaDefinition = { tables: [TABLE] };

const TARGET = {
  orgId: "org-1",
  orgSlug: "acme",
  orgName: "Acme Plumbing",
  table: TABLE,
  fields: FIELDS,
  schema: SCHEMA,
};

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClient.mockReturnValue({ __admin: true });
  resolvePublicFormTarget.mockResolvedValue(TARGET);
  mutate.mockResolvedValue({ data: { id: "rec-1", version: 1 }, error: null });
  resolveAdminEmails.mockResolvedValue([]);
  resolveOrgLanguage.mockResolvedValue("en");
  sendIntakeSubmissionEmail.mockResolvedValue(undefined);
});

describe("POST /api/intake/[slug]/[formSlug] — keyed happy path", () => {
  it("resolves the KEYED form (orgSlug + formSlug) and writes under INTAKE_ACTOR_ID", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/[formSlug]/route");

    const res = await POST(
      postReq({
        values: { full_name: "Ada Lovelace", email: "ada@example.ca" },
        idempotencyKey: "form-key-1",
      }),
      paramsFor("acme", "job-request"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ ok: true });

    // The write re-resolved the target server-side, keyed by BOTH segments — never
    // trusting the client for the table or the form.
    expect(resolvePublicFormTarget).toHaveBeenCalledWith({
      orgSlug: "acme",
      formSlug: "job-request",
    });

    const call = mutate.mock.calls[0];
    expect(call[0]).toEqual({
      client: { __admin: true },
      actorId: INTAKE_ACTOR_ID,
      orgId: "org-1",
    });
    expect(call[1]).toBe("insert");
    expect(call[2]).toBe("leads");
  });
});

describe("POST /api/intake/[slug]/[formSlug] — unavailable collapses to 400", () => {
  it("400 generic when the keyed form is unknown/unpublished (resolver null), no write", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/[formSlug]/route");
    resolvePublicFormTarget.mockResolvedValue(null);

    const res = await POST(
      postReq({ values: { email: "ada@example.ca" }, idempotencyKey: "k" }),
      paramsFor("acme", "unpublished-form"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("genericError");
    expect(mutate).not.toHaveBeenCalled();
  });
});
