import "server-only";

import type { InvoiceLanguageCode } from "@/lib/invoicing/tax";
import {
  escapeHtml,
  renderTransactionalEmail,
  sendTransactional,
} from "@/lib/resend/transactional";
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

/**
 * Build the transactional email (subject + HTML + plain text) for the invoice's
 * language. Interpolates the invoice number into the localized copy. Deliberately
 * plain: no brand marketing, no unsubscribe link, no tracking. The shared HTML shell
 * + escaping live in `transactional.ts`; only the invoice-specific paragraphs are here.
 *
 * Interpolation stays manual `.replace` (not ICU) on purpose: the invoice copy has no
 * plurals, and routing French copy (apostrophes) through `IntlMessageFormat` would
 * risk ICU treating `'` as an escape character.
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

  const innerHtml = [
    `                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(c.greeting)}</p>`,
    `                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#333333;">${bodyHtml}</p>`,
    `                <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#555555;">${escapeHtml(c.linkIntro)}</p>`,
    `                <p style="margin:0 0 24px;font-size:14px;line-height:1.6;"><a href="${linkHtml}" style="color:#2563eb;">${escapeHtml(`invoice-${numberHtml}`)}</a></p>`,
    `                <p style="margin:0;font-size:15px;line-height:1.6;">${escapeHtml(c.signature)}</p>`,
  ].join("\n");

  const html = renderTransactionalEmail({ langAttr, subject, innerHtml });
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
  const { subject, html, text } = buildEmail(
    input.language,
    input.invoiceNumber,
    input.link,
  );

  const filename = `invoice-${input.invoiceNumber}.pdf`;
  const content = Buffer.from(input.pdfBytes).toString("base64");

  await sendTransactional({
    to: input.to,
    replyTo: input.replyTo,
    subject,
    html,
    text,
    attachments: [{ filename, content }],
  });
}
