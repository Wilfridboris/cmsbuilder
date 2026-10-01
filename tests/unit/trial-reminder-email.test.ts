import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/types/api";

/**
 * Unit coverage for `sendTrialReminderEmail` (Story 7.4) — the second direct Resend
 * send. The `resend` SDK is mocked at its boundary so the REAL sender executes
 * (localized ICU subject/body build, link wiring, error masking). Pins:
 *   - Day-12 subject/body carry the pluralized days-remaining (EN + FR);
 *   - Day-14 subject/body are the at-expiry copy;
 *   - EN and FR both resolve and contain NO em-dash;
 *   - a provider error surfaces as AppError(502,"sendFailed") with no leak.
 */

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mockSend };
  },
}));

import { sendTrialReminderEmail } from "@/lib/resend/trial-reminder";

function baseInput() {
  return {
    to: "owner@example.com",
    language: "en" as const,
    stage: "day12" as const,
    daysRemaining: 2,
    slug: "acme",
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

describe("sendTrialReminderEmail", () => {
  it("Day-12 EN: pluralized days in subject + body, absolute billing link, no em-dash", async () => {
    await sendTrialReminderEmail(baseInput());

    expect(mockSend).toHaveBeenCalledTimes(1);
    const p = mockSend.mock.calls[0]![0];
    expect(p.from).toBe("Scheza <billing@scheza.com>");
    expect(p.to).toBe("owner@example.com");
    expect(p.subject).toContain("2 days");
    expect(p.text).toContain("2 days");
    expect(p.text).toContain("https://app.example.com/acme/settings#billing");
    expect(p.html).toContain("https://app.example.com/acme/settings#billing");
    expect(p.text).not.toContain("—");
    expect(p.html).not.toContain("—");
  });

  it("Day-12 EN: singular form for one day", async () => {
    await sendTrialReminderEmail({ ...baseInput(), daysRemaining: 1 });
    const p = mockSend.mock.calls[0]![0];
    expect(p.subject).toContain("1 day");
    expect(p.subject).not.toContain("1 days");
  });

  it("Day-12 FR: pluralized days, no em-dash", async () => {
    await sendTrialReminderEmail({ ...baseInput(), language: "fr" });
    const p = mockSend.mock.calls[0]![0];
    expect(p.subject).toContain("2 jours");
    expect(p.text).toContain("Bonjour,");
    expect(p.text).not.toContain("—");
    expect(p.html).not.toContain("—");
  });

  it("Day-14 EN: at-expiry copy, no em-dash", async () => {
    await sendTrialReminderEmail({ ...baseInput(), stage: "day14", daysRemaining: 0 });
    const p = mockSend.mock.calls[0]![0];
    expect(p.subject).toBe("Your Scheza trial has ended");
    expect(p.text).toContain("has ended");
    expect(p.text).not.toContain("—");
  });

  it("Day-14 FR: at-expiry copy, no em-dash", async () => {
    await sendTrialReminderEmail({
      ...baseInput(),
      language: "fr",
      stage: "day14",
      daysRemaining: 0,
    });
    const p = mockSend.mock.calls[0]![0];
    expect(p.subject).toBe("Votre essai Scheza est terminé");
    expect(p.text).not.toContain("—");
  });

  it("uses a relative link when no appOrigin is provided", async () => {
    await sendTrialReminderEmail({ ...baseInput(), appOrigin: undefined });
    const p = mockSend.mock.calls[0]![0];
    expect(p.text).toContain("/acme/settings#billing");
  });

  it("surfaces a provider error as AppError(502, sendFailed) with no leak", async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: { message: "smtp exploded: secret-detail" },
    });
    await expect(sendTrialReminderEmail(baseInput())).rejects.toMatchObject({
      statusCode: 502,
      userMessage: "sendFailed",
    });
  });

  it("surfaces a thrown SDK call as AppError(502, sendFailed)", async () => {
    mockSend.mockRejectedValue(new Error("network down"));
    const err = await sendTrialReminderEmail(baseInput()).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(502);
    expect(err.userMessage).toBe("sendFailed");
  });

  it("fails with sendFailed when RESEND env is missing (no send attempted)", async () => {
    delete process.env.RESEND_FROM_EMAIL;
    await expect(sendTrialReminderEmail(baseInput())).rejects.toMatchObject({
      statusCode: 502,
      userMessage: "sendFailed",
    });
    expect(mockSend).not.toHaveBeenCalled();
  });
});
