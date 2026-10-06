import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/types/api";

/**
 * Unit coverage for `sendOffboardingReminderEmail` (Story 8.5). The `resend` SDK is
 * mocked at its boundary so the REAL sender executes (localized subject/body build,
 * {date} interpolation, link wiring, error masking). Pins:
 *   - each stage (day1/day7/day25) carries the right subject + body (EN + FR);
 *   - the localized deletion date is rendered into subject + body;
 *   - the CTA link points at the Settings #offboarding section;
 *   - EN and FR both resolve and contain NO em-dash;
 *   - a provider error surfaces as AppError(502,"sendFailed") with no leak.
 */

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mockSend };
  },
}));

import { sendOffboardingReminderEmail } from "@/lib/resend/offboarding-reminder";

function baseInput() {
  return {
    to: "owner@example.com",
    language: "en" as const,
    stage: "day1" as const,
    slug: "acme",
    deletionDate: "November 5, 2026",
    appOrigin: "https://app.example.com",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_FROM_EMAIL = "Scheza <billing@scheza.com>";
  mockSend.mockResolvedValue({ data: { id: "e_1" }, error: null });
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
});

describe("sendOffboardingReminderEmail", () => {
  it("Day-1 EN: renders the deletion date, settings#offboarding link, no em-dash", async () => {
    await sendOffboardingReminderEmail(baseInput());

    expect(mockSend).toHaveBeenCalledTimes(1);
    const p = mockSend.mock.calls[0]![0];
    expect(p.from).toBe("Scheza <billing@scheza.com>");
    expect(p.to).toBe("owner@example.com");
    expect(p.subject).toContain("November 5, 2026");
    expect(p.text).toContain("November 5, 2026");
    expect(p.text).toContain(
      "https://app.example.com/acme/settings#offboarding",
    );
    expect(p.html).toContain(
      "https://app.example.com/acme/settings#offboarding",
    );
    expect(p.text).not.toContain("—");
    expect(p.html).not.toContain("—");
  });

  it("Day-7 EN: reminder copy with the date", async () => {
    await sendOffboardingReminderEmail({ ...baseInput(), stage: "day7" });
    const p = mockSend.mock.calls[0]![0];
    expect(p.subject).toContain("November 5, 2026");
    expect(p.text).toContain("November 5, 2026");
    expect(p.text).not.toContain("—");
  });

  it("Day-25 EN: last-reminder copy with the date", async () => {
    await sendOffboardingReminderEmail({ ...baseInput(), stage: "day25" });
    const p = mockSend.mock.calls[0]![0];
    expect(p.subject.toLowerCase()).toContain("last reminder");
    expect(p.subject).toContain("November 5, 2026");
    expect(p.text).not.toContain("—");
  });

  it("Day-1 FR: French copy, date rendered, no em-dash", async () => {
    await sendOffboardingReminderEmail({
      ...baseInput(),
      language: "fr",
      deletionDate: "5 novembre 2026",
    });
    const p = mockSend.mock.calls[0]![0];
    expect(p.text).toContain("Bonjour,");
    expect(p.subject).toContain("5 novembre 2026");
    expect(p.text).toContain("5 novembre 2026");
    expect(p.text).not.toContain("—");
    expect(p.html).not.toContain("—");
  });

  it("Day-25 FR: last-reminder French copy", async () => {
    await sendOffboardingReminderEmail({
      ...baseInput(),
      language: "fr",
      stage: "day25",
      deletionDate: "5 novembre 2026",
    });
    const p = mockSend.mock.calls[0]![0];
    expect(p.subject).toContain("Dernier rappel");
    expect(p.text).not.toContain("—");
  });

  it("uses a relative link when no appOrigin is provided", async () => {
    await sendOffboardingReminderEmail({ ...baseInput(), appOrigin: undefined });
    const p = mockSend.mock.calls[0]![0];
    expect(p.text).toContain("/acme/settings#offboarding");
  });

  it("surfaces a provider error as AppError(502, sendFailed) with no leak", async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: { message: "smtp exploded: secret-detail" },
    });
    await expect(
      sendOffboardingReminderEmail(baseInput()),
    ).rejects.toMatchObject({ statusCode: 502, userMessage: "sendFailed" });
  });

  it("surfaces a thrown SDK call as AppError(502, sendFailed)", async () => {
    mockSend.mockRejectedValue(new Error("network down"));
    const err = await sendOffboardingReminderEmail(baseInput()).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(502);
    expect(err.userMessage).toBe("sendFailed");
  });
});
