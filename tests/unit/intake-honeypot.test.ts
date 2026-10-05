import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import type {
  FieldDefinition,
  SchemaDefinition,
  TableDefinition,
} from "@/types/db";

/**
 * Unit coverage for the Story 14.7 honeypot in the shared write path
 * (`submitToTarget`). A non-empty top-level `website` body key means a bot filled a
 * hidden field a human never reaches — the server must return the SAME `{ ok: true }` a
 * real success returns while writing NOTHING, emailing NO ONE, and reporting nothing, so
 * the bot cannot tell it was rejected. An empty/absent `website` proceeds to the normal
 * write.
 *
 * The REAL `submitToTarget` runs; `mutate`, the admin client, the notification seams, and
 * `reportError` are mocked (mirroring `intake-submit-route.test.ts`) so we can assert the
 * drop short-circuits BEFORE any of them.
 */

const mutate = vi.fn();
const createAdminClient = vi.fn(() => ({ __admin: true }));
const INTAKE_ACTOR_ID = "00000000-0000-0000-0000-0000000000b0";
const resolveAdminEmails = vi.fn();
const resolveOrgLanguage = vi.fn();
const sendIntakeSubmissionEmail = vi.fn();
const reportError = vi.fn();

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
  operatingName: null,
  logoUrl: null,
  introText: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClient.mockReturnValue({ __admin: true });
  mutate.mockResolvedValue({ data: { id: "rec-1", version: 1 }, error: null });
  resolveAdminEmails.mockResolvedValue(["owner@example.com"]);
  resolveOrgLanguage.mockResolvedValue("en");
  sendIntakeSubmissionEmail.mockResolvedValue(undefined);
});

describe("submitToTarget — honeypot (Story 14.7)", () => {
  it("silently drops a non-empty `website`: returns { ok: true } with NO write, email, or report", async () => {
    const { submitToTarget } = await import("@/lib/intake/submit");

    const result = await submitToTarget(
      postReq({
        values: { full_name: "Spam Bot", email: "bot@spam.example" },
        idempotencyKey: "k",
        website: "http://spam.example",
      }),
      TARGET,
      "/api/intake/[slug]",
    );

    // Indistinguishable from a real success envelope.
    expect(result).toEqual({ ok: true });
    // But nothing downstream of the drop ran.
    expect(mutate).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(resolveAdminEmails).not.toHaveBeenCalled();
    expect(sendIntakeSubmissionEmail).not.toHaveBeenCalled();
    // A honeypot trip is an expected/benign decision — never a Sentry event.
    expect(reportError).not.toHaveBeenCalled();
  });

  it("drops even when the honeypot is only whitespace-padded content (trim-aware)", async () => {
    const { submitToTarget } = await import("@/lib/intake/submit");

    const result = await submitToTarget(
      postReq({
        values: { email: "bot@spam.example" },
        idempotencyKey: "k",
        website: "   bot filled this   ",
      }),
      TARGET,
      "/api/intake/[slug]",
    );

    expect(result).toEqual({ ok: true });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only honeypot as empty and proceeds to the normal write", async () => {
    const { submitToTarget } = await import("@/lib/intake/submit");

    const result = await submitToTarget(
      postReq({
        values: { full_name: "Ada", email: "ada@example.ca" },
        idempotencyKey: "k",
        // A human never types here, but a browser/extension might leave a stray space;
        // trim-to-empty must be treated as empty (false-positive-proof).
        website: "   ",
      }),
      TARGET,
      "/api/intake/[slug]",
    );

    expect(result).toEqual({ ok: true });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][3]).toEqual({
      full_name: "Ada",
      email: "ada@example.ca",
    });
  });

  it("proceeds to the normal write when `website` is absent (a real human submission)", async () => {
    const { submitToTarget } = await import("@/lib/intake/submit");

    const result = await submitToTarget(
      postReq({
        values: { full_name: "Ada", email: "ada@example.ca" },
        idempotencyKey: "k",
      }),
      TARGET,
      "/api/intake/[slug]",
    );

    expect(result).toEqual({ ok: true });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(sendIntakeSubmissionEmail).toHaveBeenCalledTimes(1);
  });
});
