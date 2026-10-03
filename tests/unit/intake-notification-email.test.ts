import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/types/api";
import type { FieldDefinition } from "@/types/db";

/**
 * Unit coverage for `sendIntakeSubmissionEmail` (Story 6.4, FR28) — the public
 * intake-submission notification send. The `resend` SDK is mocked at its boundary so
 * the REAL sender executes (localized subject/chrome build, type-formatted field
 * summary, error masking). Pins:
 *   - the summary carries each submitted field's authored label + type-formatted value;
 *   - NO relation data appears (the caller passes only non-relation `fields`);
 *   - the subject names the org;
 *   - the FR catalog is used when `language='fr'`, EN otherwise, no em-dash either way;
 *   - a provider error surfaces as AppError(502,"sendFailed") with no leak;
 *   - a blank or omitted field is not listed.
 */

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mockSend };
  },
}));

import { sendIntakeSubmissionEmail } from "@/lib/resend/intake-notification";

const FIELDS: FieldDefinition[] = [
  { key: "full_name", label: "Full name", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "quoted_amount", label: "Quoted Amount", type: "currency" },
  { key: "scheduled_date", label: "Scheduled Date", type: "date" },
  { key: "is_urgent", label: "Urgent", type: "boolean" },
  { key: "notes", label: "Notes", type: "text" },
];

function baseInput() {
  return {
    to: "owner@example.com",
    language: "en" as const,
    orgName: "Acme Plumbing",
    tableLabel: "Leads",
    slug: "acme",
    fields: FIELDS,
    data: {
      full_name: "Jordan Avery",
      email: "jordan@example.com",
      quoted_amount: 777.77,
      scheduled_date: "2026-10-20",
      is_urgent: true,
      // notes omitted → must not be listed
    } as Record<string, unknown>,
    appOrigin: "https://app.example.com",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_FROM_EMAIL = "Scheza <notify@scheza.com>";
  mockSend.mockResolvedValue({ data: { id: "e_1" }, error: null });
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
});

describe("sendIntakeSubmissionEmail", () => {
  it("EN: subject names the org, summary carries each submitted field's label + type-formatted value", async () => {
    await sendIntakeSubmissionEmail(baseInput());

    expect(mockSend).toHaveBeenCalledTimes(1);
    const p = mockSend.mock.calls[0]![0];
    expect(p.from).toBe("Scheza <notify@scheza.com>");
    expect(p.to).toBe("owner@example.com");

    // Subject names the org.
    expect(p.subject).toContain("Acme Plumbing");

    // Each submitted field: authored label + type-formatted value.
    expect(p.text).toContain("Full name: Jordan Avery");
    expect(p.text).toContain("Email: jordan@example.com");
    expect(p.text).toContain("Quoted Amount: $777.77");
    expect(p.text).toContain("Scheduled Date: Oct 20, 2026");
    expect(p.text).toContain("Urgent: Yes");

    // HTML carries the labels/values too.
    expect(p.html).toContain("Full name");
    expect(p.html).toContain("Jordan Avery");
    expect(p.html).toContain("$777.77");

    // Owner-dashboard CTA link.
    expect(p.text).toContain("https://app.example.com/acme");
    expect(p.html).toContain("https://app.example.com/acme");

    // No em-dash.
    expect(p.text).not.toContain("—");
    expect(p.html).not.toContain("—");

    // The two-line signature renders on two lines: <br /> in HTML, newline in text.
    expect(p.html).toContain("Thank you,<br />The Scheza team");
    expect(p.text).toContain("Thank you,\nThe Scheza team");
  });

  it("omits blank or absent fields from the summary", async () => {
    const input = baseInput();
    input.data = {
      full_name: "Jordan Avery",
      notes: "   ", // blank → formatCell returns "" → not listed
    };
    await sendIntakeSubmissionEmail(input);
    const p = mockSend.mock.calls[0]![0];
    expect(p.text).toContain("Full name: Jordan Avery");
    expect(p.text).not.toContain("Notes:");
    // A field with no key in `data` is never listed.
    expect(p.text).not.toContain("Email:");
    expect(p.text).not.toContain("Quoted Amount:");
  });

  it("contains NO relation data — only the passed non-relation fields are summarized", async () => {
    // The route only ever passes `target.fields` (relation-free). Even if a relation
    // key leaks into `data`, it is never listed because it is not in `fields`.
    const input = baseInput();
    input.data = {
      full_name: "Jordan Avery",
      customer: "11111111-2222-3333-4444-555555555555", // a relation id, not in FIELDS
    };
    await sendIntakeSubmissionEmail(input);
    const p = mockSend.mock.calls[0]![0];
    expect(p.text).not.toContain("11111111-2222-3333-4444-555555555555");
    expect(p.html).not.toContain("11111111-2222-3333-4444-555555555555");
  });

  it("FR: uses the French catalog, no em-dash", async () => {
    await sendIntakeSubmissionEmail({ ...baseInput(), language: "fr" });
    const p = mockSend.mock.calls[0]![0];
    expect(p.subject).toContain("Acme Plumbing");
    expect(p.text).toContain("Bonjour,");
    // The FR chrome is used; the submitted values stay verbatim.
    expect(p.text).toContain("Full name: Jordan Avery");
    expect(p.text).not.toContain("—");
    expect(p.html).not.toContain("—");
  });

  it("uses a relative dashboard link when no appOrigin is provided", async () => {
    await sendIntakeSubmissionEmail({ ...baseInput(), appOrigin: undefined });
    const p = mockSend.mock.calls[0]![0];
    expect(p.text).toContain("\n/acme\n");
  });

  it("surfaces a provider error as AppError(502, sendFailed) with no leak", async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: { message: "smtp exploded: secret-detail" },
    });
    await expect(sendIntakeSubmissionEmail(baseInput())).rejects.toMatchObject({
      statusCode: 502,
      userMessage: "sendFailed",
    });
  });

  it("surfaces a thrown SDK call as AppError(502, sendFailed)", async () => {
    mockSend.mockRejectedValue(new Error("network down"));
    const err = await sendIntakeSubmissionEmail(baseInput()).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(502);
    expect(err.userMessage).toBe("sendFailed");
  });

  it("fails with sendFailed when RESEND env is missing (no send attempted)", async () => {
    delete process.env.RESEND_FROM_EMAIL;
    await expect(sendIntakeSubmissionEmail(baseInput())).rejects.toMatchObject({
      statusCode: 502,
      userMessage: "sendFailed",
    });
    expect(mockSend).not.toHaveBeenCalled();
  });
});
