import "server-only";

import { Resend } from "resend";

import { AppError } from "@/types/api";
import type { InvoiceLanguageCode } from "@/lib/invoicing/tax";
import en from "@/lib/i18n/en.json";
import fr from "@/lib/i18n/fr.json";

/**
 * The app's FIRST direct Resend send (Story 12.6). Unlike auth/invite emails (which
 * GoTrue owns over Supabase SMTP), an invoice email needs a PDF attachment, a
 * per-invoice reply-to (the owner's own address), and CASL strictly-transactional
 * framing — which only a direct `emails.send` gives. Modeled on
 * `scheza-marketing/src/lib/resend.ts` (send shape) + `.../i18n/emails.ts` (localized
 * html+text).
 *
 * Strictly transactional (CASL): no marketing copy, no unsubscribe/marketing footer,
 * no tracking pixel. `from` = `RESEND_FROM_EMAIL`; `replyTo` = the acting admin's own
 * email; subject + body resolve from the invoice's FROZEN `language` (never the
 * viewer's cookie locale). A provider failure surfaces as `AppError(502, "sendFailed")`
 * and never leaks raw provider output.
 */

/** The `InvoiceEmail.*` copy block for one language (structurally identical en/fr). */
type EmailLabels = (typeof en)["InvoiceEmail"];

const CATALOGS: Record<InvoiceLanguageCode, EmailLabels> = {
  en: en.InvoiceEmail,
  fr: fr.InvoiceEmail,
};

export type SendInvoiceEmailInput = {
  /** The confirmed recipient address (validated by the route before calling). */
  to: string;
  /** Reply-to: the acting admin's own login email (the owner's address). */
  replyTo: string;
  /** The invoice's FROZEN language — drives subject + body copy. */
  language: InvoiceLanguageCode;
  /** The display invoice number (already zero-padded via `formatInvoiceNumber`). */
  invoiceNumber: string;
  /** The frozen PDF bytes to attach. */
  pdfBytes: Uint8Array;
  /** The public `/i/[token]` link, included as an online-view fallback. */
  link: string;
};

/** Escape the handful of HTML-significant characters in interpolated copy. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build the transactional email (subject + HTML + plain text) for the invoice's
 * language. Interpolates the invoice number into the localized copy. Deliberately
 * plain: no brand marketing, no unsubscribe link, no tracking.
 */
function buildEmail(
  language: InvoiceLanguageCode,
  invoiceNumber: string,
  link: string,
): { subject: string; html: string; text: string } {
  const c = CATALOGS[language];
  const subject = c.subject.replace("{number}", invoiceNumber);
  const body = c.body.replace("{number}", invoiceNumber);
  const langAttr = language === "fr" ? "fr" : "en";

  const numberHtml = escapeHtml(invoiceNumber);
  const bodyHtml = escapeHtml(body);
  const linkHtml = escapeHtml(link);

  const html = `<!doctype html>
<html lang="${langAttr}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:24px;background-color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:8px;">
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(c.greeting)}</p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#333333;">${bodyHtml}</p>
                <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#555555;">${escapeHtml(c.linkIntro)}</p>
                <p style="margin:0 0 24px;font-size:14px;line-height:1.6;"><a href="${linkHtml}" style="color:#2563eb;">${escapeHtml(`invoice-${numberHtml}`)}</a></p>
                <p style="margin:0;font-size:15px;line-height:1.6;">${escapeHtml(c.signature)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${c.greeting}\n\n${body}\n\n${c.linkIntro}\n${link}\n\n${c.signature}`;

  return { subject, html, text };
}

/**
 * Send the invoice as a strictly-transactional email with the frozen PDF attached.
 * Throws `AppError(502, "sendFailed")` on any provider error or thrown SDK call — the
 * route maps it to the matrix's `sendFailed` and raw provider output never leaks.
 */
export async function sendInvoiceEmail(
  input: SendInvoiceEmailInput,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new AppError(502, "sendFailed", "Missing RESEND_API_KEY or RESEND_FROM_EMAIL");
  }

  const { subject, html, text } = buildEmail(
    input.language,
    input.invoiceNumber,
    input.link,
  );

  const resend = new Resend(apiKey);
  const filename = `invoice-${input.invoiceNumber}.pdf`;
  const content = Buffer.from(input.pdfBytes).toString("base64");

  try {
    const { error } = await resend.emails.send({
      from,
      to: input.to,
      replyTo: input.replyTo,
      subject,
      html,
      text,
      attachments: [{ filename, content }],
    });
    if (error) {
      // Mask the provider message — never surface it to the caller.
      throw new AppError(502, "sendFailed", error.message);
    }
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(502, "sendFailed", (err as Error)?.message);
  }
}
