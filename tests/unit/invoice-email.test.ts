import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/types/api";

/**
 * Unit test for `sendInvoiceEmail` (Story 12.6) — the app's first direct Resend send.
 * The `resend` SDK is mocked at its boundary so the REAL `sendInvoiceEmail` (localized
 * subject/body build, attachment encoding, reply-to wiring, error masking) executes.
 *
 * Pins the CASL-critical + I/O-matrix behaviors:
 *   - sends with the frozen PDF attached (base64 content, invoice-{number}.pdf filename);
 *   - `replyTo` = the acting admin's own address; `from` = RESEND_FROM_EMAIL;
 *   - en and fr resolve the correct frozen-language subject + body;
 *   - a provider error surfaces as AppError(502, "sendFailed") with no provider leak.
 */

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
vi.mock("resend", () => ({
  // A real constructor so `new Resend(apiKey)` works; each instance exposes the mocked
  // `emails.send` boundary.
  Resend: class {
    emails = { send: mockSend };
  },
}));

// Import AFTER the mock so the SDK boundary is stubbed.
import { sendInvoiceEmail } from "@/lib/resend/send";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // "%PDF-1"

function baseInput() {
  return {
    to: "customer@example.com",
    replyTo: "owner@example.com",
    language: "en" as const,
    invoiceNumber: "000123",
    pdfBytes: PDF,
    link: "https://app.example.com/i/aTokenValue",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_FROM_EMAIL = "Scheza <invoices@scheza.com>";
  mockSend.mockResolvedValue({ data: { id: "e_1" }, error: null });
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
});

describe("sendInvoiceEmail", () => {
  it("sends with the PDF attached, correct from + replyTo (en subject/body)", async () => {
    await sendInvoiceEmail(baseInput());

    expect(mockSend).toHaveBeenCalledTimes(1);
    const params = mockSend.mock.calls[0]![0];

    expect(params.from).toBe("Scheza <invoices@scheza.com>");
    expect(params.to).toBe("customer@example.com");
    expect(params.replyTo).toBe("owner@example.com");

    // en subject + body carry the invoice number.
    expect(params.subject).toBe("Invoice 000123");
    expect(params.text).toContain("invoice 000123");
    expect(params.html).toContain("Hello,");

    // The frozen PDF is attached as base64 with the invoice-{number}.pdf filename.
    expect(params.attachments).toHaveLength(1);
    expect(params.attachments[0].filename).toBe("invoice-000123.pdf");
    expect(params.attachments[0].content).toBe(Buffer.from(PDF).toString("base64"));

    // Transactional: the online-view link is present in text + html.
    expect(params.text).toContain("https://app.example.com/i/aTokenValue");
    expect(params.html).toContain("https://app.example.com/i/aTokenValue");
  });

  it("resolves the FROZEN language (fr subject/body), not the viewer locale", async () => {
    await sendInvoiceEmail({ ...baseInput(), language: "fr" });

    const params = mockSend.mock.calls[0]![0];
    expect(params.subject).toBe("Facture 000123");
    expect(params.text).toContain("Bonjour,");
    expect(params.text).toContain("facture 000123");
    // No em-dash in the localized copy.
    expect(params.text).not.toContain("—");
  });

  it("surfaces a provider error as AppError(502, sendFailed) with no leak", async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: { message: "smtp exploded: secret-provider-detail" },
    });

    await expect(sendInvoiceEmail(baseInput())).rejects.toMatchObject({
      statusCode: 502,
      userMessage: "sendFailed",
    });
  });

  it("surfaces a thrown SDK call as AppError(502, sendFailed)", async () => {
    mockSend.mockRejectedValue(new Error("network down"));

    const err = await sendInvoiceEmail(baseInput()).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(502);
    expect(err.userMessage).toBe("sendFailed");
  });

  it("fails with sendFailed when RESEND_FROM_EMAIL is missing (no send attempted)", async () => {
    delete process.env.RESEND_FROM_EMAIL;

    await expect(sendInvoiceEmail(baseInput())).rejects.toMatchObject({
      statusCode: 502,
      userMessage: "sendFailed",
    });
    expect(mockSend).not.toHaveBeenCalled();
  });
});
