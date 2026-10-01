import "server-only";

import { Resend } from "resend";

import { AppError } from "@/types/api";

/**
 * Shared transactional-email primitives (retro [A3a]).
 *
 * Both direct Resend senders — `sendInvoiceEmail` (Story 12.6) and
 * `sendTrialReminderEmail` (Story 7.4) — are strictly transactional (CASL): no
 * marketing copy, no unsubscribe/marketing footer, no tracking pixel. They shared a
 * byte-identical HTML shell, `escapeHtml`, and Resend send/mask tail; those live here
 * once so the two senders only supply their own inner paragraphs + subject.
 *
 * `import "server-only"`: reads `RESEND_*` env and sends mail — never a client bundle.
 */

/** Escape the handful of HTML-significant characters in interpolated copy. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Wrap pre-built inner `<p>` blocks in the shared transactional HTML shell (the
 * responsive table scaffold both emails use). `innerHtml` is the already-escaped,
 * already-indented paragraph block; `subject` is escaped into the `<title>`.
 */
export function renderTransactionalEmail(params: {
  langAttr: "en" | "fr";
  subject: string;
  innerHtml: string;
}): string {
  return `<!doctype html>
<html lang="${params.langAttr}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(params.subject)}</title>
  </head>
  <body style="margin:0;padding:24px;background-color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:8px;">
            <tr>
              <td style="padding:32px;">
${params.innerHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Send a strictly-transactional email via Resend, masking any provider error as
 * `AppError(502, "sendFailed")` (raw provider output never leaks). `replyTo` and
 * `attachments` are included only when supplied, so a reminder (neither) and an
 * invoice (both) each produce exactly the payload they did before. Throws
 * `AppError(502, "sendFailed")` when the `RESEND_*` env is missing.
 */
export async function sendTransactional(message: {
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: string }[];
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new AppError(
      502,
      "sendFailed",
      "Missing RESEND_API_KEY or RESEND_FROM_EMAIL",
    );
  }

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from,
      to: message.to,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.attachments ? { attachments: message.attachments } : {}),
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
