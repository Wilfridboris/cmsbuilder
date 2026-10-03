import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import type { FieldDefinition, TableDefinition } from "@/types/db";

/**
 * Unit coverage for the public `POST /api/intake/[slug]` handler (Story 6.2) WITHOUT
 * a live DB or auth provider — mirroring the sibling `route-records.test.ts` pattern
 * (mock the resolver + the guarded `mutate` + the admin client + `reportError`, feed a
 * fake `NextRequest`, assert `status` + the `{ data, error }` envelope). It locks the
 * frozen I/O & Edge-Case Matrix rows that live in the HANDLER rather than the pure
 * helpers:
 *   - happy path            → 200 { ok: true }; mutate inserts the allowlisted +
 *                             coerced data under INTAKE_ACTOR_ID, scoped to the
 *                             resolved org, into the resolved table;
 *   - extra / relation keys → dropped (only allowlisted non-relation fields written);
 *   - bad number format     → 400 generic, no write;
 *   - empty submission      → 400 generic, no write;
 *   - unknown / absent slug → 400 generic, no write, no internals;
 *   - idempotent retry      → the client's stable key is passed straight through;
 *   - mutate failure        → 500 generic, never leaks internals.
 *
 * `getIntakeTarget` (the shared resolver) and `mutate` are mocked; the REAL
 * `coerceAddValue` runs so per-field coercion/rejection is exercised end-to-end.
 */

const getIntakeTarget = vi.fn();
const mutate = vi.fn();
const createAdminClient = vi.fn(() => ({ __admin: true }));
const INTAKE_ACTOR_ID = "00000000-0000-0000-0000-0000000000b0";
// Story 6.4 notification seams — mocked so the handler's best-effort notification
// behavior (who is emailed, when, and that a failure never blocks the 200) is
// asserted here, while the email content itself is unit-tested in
// `intake-notification-email.test.ts`.
const resolveAdminEmails = vi.fn();
const resolveOrgLanguage = vi.fn();
const sendIntakeSubmissionEmail = vi.fn();
const reportError = vi.fn();

vi.mock("@/lib/data/intake", () => ({ getIntakeTarget }));
vi.mock("@/lib/data/mutate", () => ({ mutate, INTAKE_ACTOR_ID }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/orgs/org-recipients", () => ({
  resolveAdminEmails,
  resolveOrgLanguage,
}));
vi.mock("@/lib/resend/intake-notification", () => ({ sendIntakeSubmissionEmail }));
vi.mock("@/lib/observability/report", () => ({ reportError }));

function postReq(body: unknown): NextRequest {
  // `nextUrl.origin` is read by the 6.4 notification path to build the absolute
  // dashboard CTA; the 6.2 rows ignore it.
  return {
    json: async () => body,
    nextUrl: { origin: "https://app.example.com" },
  } as unknown as NextRequest;
}

function paramsFor(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

const FIELDS: FieldDefinition[] = [
  { key: "full_name", label: "Full Name", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "quantity", label: "Quantity", type: "number" },
  { key: "subscribe", label: "Subscribe?", type: "boolean" },
];

const TABLE: TableDefinition = { key: "leads", label: "Leads", fields: FIELDS };

const TARGET = {
  orgId: "org-1",
  orgName: "Acme Plumbing",
  table: TABLE,
  fields: FIELDS,
};

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClient.mockReturnValue({ __admin: true });
  getIntakeTarget.mockResolvedValue(TARGET);
  mutate.mockResolvedValue({ data: { id: "rec-1", version: 1 }, error: null });
  // Notification defaults: one resolvable admin, EN, a successful send.
  resolveAdminEmails.mockResolvedValue(["owner@example.com"]);
  resolveOrgLanguage.mockResolvedValue("en");
  sendIntakeSubmissionEmail.mockResolvedValue(undefined);
});

const VALID_BODY = {
  values: { full_name: "Ada Lovelace", email: "ada@example.ca", subscribe: true },
  idempotencyKey: "k",
};

describe("POST /api/intake/[slug] — happy path", () => {
  it("inserts allowlisted + coerced data under INTAKE_ACTOR_ID, scoped to the resolved org/table", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/route");

    const res = await POST(
      postReq({
        values: {
          full_name: "Ada Lovelace",
          email: "ada@example.ca",
          quantity: "3",
          subscribe: true,
        },
        idempotencyKey: "form-key-1",
      }),
      paramsFor("acme"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ ok: true });

    // The write re-resolved the target server-side (never trusting the client).
    expect(getIntakeTarget).toHaveBeenCalledWith("acme");

    const call = mutate.mock.calls[0];
    // identity: admin client + dedicated anonymous actor + resolved org id.
    expect(call[0]).toEqual({
      client: { __admin: true },
      actorId: INTAKE_ACTOR_ID,
      orgId: "org-1",
    });
    expect(call[1]).toBe("insert");
    expect(call[2]).toBe("leads");
    // Coerced: number parsed, boolean a real boolean.
    expect(call[3]).toEqual({
      full_name: "Ada Lovelace",
      email: "ada@example.ca",
      quantity: 3,
      subscribe: true,
    });
    // The client's stable idempotency key is passed straight through for dedupe.
    expect(call[4]).toEqual({ idempotencyKey: "form-key-1" });
  });

  it("omits blank scalar fields but a boolean always writes a value", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/route");

    const res = await POST(
      postReq({
        values: { full_name: "  ", email: "ada@example.ca", subscribe: false },
        idempotencyKey: "k",
      }),
      paramsFor("acme"),
    );

    expect(res.status).toBe(200);
    // Blank `full_name` and absent `quantity` are omitted; the boolean writes false.
    expect(mutate.mock.calls[0][3]).toEqual({
      email: "ada@example.ca",
      subscribe: false,
    });
  });
});

describe("POST /api/intake/[slug] — allowlist is the authority", () => {
  it("drops extra and relation keys not in the server-resolved field set", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/route");

    const res = await POST(
      postReq({
        values: {
          email: "ada@example.ca",
          // Not in the allowlist — a stray key the client invented.
          is_admin: true,
          // A relation-shaped key the client should never be able to write.
          client: "some-other-record-id",
          table_key: "organizations",
        },
        idempotencyKey: "k",
      }),
      paramsFor("acme"),
    );

    expect(res.status).toBe(200);
    // Only the one allowlisted field reaches the record; booleans in the allowlist
    // still write their default false.
    expect(mutate.mock.calls[0][3]).toEqual({
      email: "ada@example.ca",
      subscribe: false,
    });
    expect(mutate.mock.calls[0][3]).not.toHaveProperty("is_admin");
    expect(mutate.mock.calls[0][3]).not.toHaveProperty("client");
    expect(mutate.mock.calls[0][3]).not.toHaveProperty("table_key");
  });
});

describe("POST /api/intake/[slug] — rejections (no write)", () => {
  it("400 generic on a non-numeric number field, never calling mutate", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/route");

    const res = await POST(
      postReq({
        values: { email: "ada@example.ca", quantity: "not-a-number" },
        idempotencyKey: "k",
      }),
      paramsFor("acme"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("genericError");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("400 generic when a scalar field value is a non-primitive (object/array), never calling mutate", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/route");

    const res = await POST(
      postReq({
        // A scalar field handed an object would otherwise stringify to
        // "[object Object]" and be written verbatim — reject instead.
        values: { full_name: { first: "Ada" }, email: ["a@b.ca"] },
        idempotencyKey: "k",
      }),
      paramsFor("acme"),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("genericError");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("400 generic on a fully-empty scalar submission (no field filled)", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/route");
    // A scalar-only target so there is no boolean forcing a value.
    getIntakeTarget.mockResolvedValue({
      ...TARGET,
      fields: [{ key: "full_name", label: "Full Name", type: "text" }],
      table: {
        key: "leads",
        label: "Leads",
        fields: [{ key: "full_name", label: "Full Name", type: "text" }],
      },
    });

    const res = await POST(
      postReq({ values: { full_name: "   " }, idempotencyKey: "k" }),
      paramsFor("acme"),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("genericError");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("400 generic for an unknown/absent slug (resolver returns null), no write, no internals", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/route");
    getIntakeTarget.mockResolvedValue(null);

    const res = await POST(
      postReq({ values: { email: "ada@example.ca" }, idempotencyKey: "k" }),
      paramsFor("ghost"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("genericError");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("400 generic on a malformed body (missing idempotencyKey), never resolving the target", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/route");

    const res = await POST(
      postReq({ values: { email: "ada@example.ca" } }),
      paramsFor("acme"),
    );

    expect(res.status).toBe(400);
    expect(getIntakeTarget).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("POST /api/intake/[slug] — write failure is masked", () => {
  it("500 generic when mutate reports an error (no internals leaked)", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/route");
    mutate.mockResolvedValue({ data: null, error: "The write could not be completed." });

    const res = await POST(
      postReq({ values: { email: "ada@example.ca" }, idempotencyKey: "k" }),
      paramsFor("acme"),
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toBe("genericError");
    // A failed write never triggers the notification path.
    expect(resolveAdminEmails).not.toHaveBeenCalled();
    expect(sendIntakeSubmissionEmail).not.toHaveBeenCalled();
  });

  it("treats a retried submit as the same logical write (stable idempotency key passed through)", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/route");
    // The guarded insert dedupes on the key; the route's job is only to pass the
    // client's stable per-instance key through unchanged on every retry.
    const payload = {
      values: { email: "ada@example.ca" },
      idempotencyKey: "stable-instance-key",
    };

    await POST(postReq(payload), paramsFor("acme"));
    await POST(postReq(payload), paramsFor("acme"));

    expect(mutate.mock.calls[0][4]).toEqual({ idempotencyKey: "stable-instance-key" });
    expect(mutate.mock.calls[1][4]).toEqual({ idempotencyKey: "stable-instance-key" });
  });
});

describe("POST /api/intake/[slug] — owner notification (Story 6.4)", () => {
  it("emails the single resolved admin with the submission context, returns 200", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/route");

    const res = await POST(postReq(VALID_BODY), paramsFor("acme"));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ ok: true });
    // Resolution ran against the resolved org via the hoisted admin client.
    expect(resolveAdminEmails).toHaveBeenCalledWith({ __admin: true }, "org-1");
    expect(sendIntakeSubmissionEmail).toHaveBeenCalledTimes(1);
    const arg = sendIntakeSubmissionEmail.mock.calls[0]![0];
    expect(arg).toMatchObject({
      to: "owner@example.com",
      language: "en",
      orgName: "Acme Plumbing",
      tableLabel: "Leads",
      slug: "acme",
      fields: FIELDS,
      appOrigin: "https://app.example.com",
    });
    // The written payload is handed to the summary builder.
    expect(arg.data).toMatchObject({ email: "ada@example.ca", subscribe: true });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("emails every resolved admin on the success path (one send per admin)", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/route");
    resolveAdminEmails.mockResolvedValue(["a@x.com", "b@x.com", "c@x.com"]);

    const res = await POST(postReq(VALID_BODY), paramsFor("acme"));

    expect(res.status).toBe(200);
    expect(sendIntakeSubmissionEmail).toHaveBeenCalledTimes(3);
    expect(sendIntakeSubmissionEmail.mock.calls.map((c) => c![0].to)).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("emails every resolved admin; a failing send aborts the batch, logs once, still 200", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/route");
    resolveAdminEmails.mockResolvedValue(["a@x.com", "b@x.com", "c@x.com"]);
    sendIntakeSubmissionEmail
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("resend 500"))
      .mockResolvedValue(undefined);

    const res = await POST(postReq(VALID_BODY), paramsFor("acme"));

    expect(res.status).toBe(200);
    // Second send throws, so the third is never attempted (batch aborts).
    expect(sendIntakeSubmissionEmail).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0]![1]).toEqual({ route: "/api/intake/[slug]" });
  });

  it("writes the record and sends no email when the org has no resolvable admin", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/route");
    resolveAdminEmails.mockResolvedValue([]);

    const res = await POST(postReq(VALID_BODY), paramsFor("acme"));

    expect(res.status).toBe(200);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(resolveOrgLanguage).not.toHaveBeenCalled();
    expect(sendIntakeSubmissionEmail).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("still returns 200 and logs when the notification send fails (data capture never blocked)", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/route");
    sendIntakeSubmissionEmail.mockRejectedValue(new Error("resend down"));

    const res = await POST(postReq(VALID_BODY), paramsFor("acme"));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ ok: true });
    // The record was still written before the failing notification.
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0]![1]).toEqual({ route: "/api/intake/[slug]" });
  });

  it("still returns 200 when admin resolution itself throws, never attempting a send", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/route");
    resolveAdminEmails.mockRejectedValue(new Error("org_members query failed"));

    const res = await POST(postReq(VALID_BODY), paramsFor("acme"));

    expect(res.status).toBe(200);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(sendIntakeSubmissionEmail).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});
