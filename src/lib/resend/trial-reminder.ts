import "server-only";

import { Resend } from "resend";
import { IntlMessageFormat } from "intl-messageformat";

import { AppError } from "@/types/api";
import en from "@/lib/i18n/en.json";
import fr from "@/lib/i18n/fr.json";

/**
 * Trial-conversion reminder email (Story 7.4). Mirrors `sendInvoiceEmail` in
 * `send.ts`: the same Resend client instantiation, the same lazy
 * `RESEND_API_KEY`/`RESEND_FROM_EMAIL` reads, and the same `AppError(502,
 * "sendFailed")` masking on any provider error — so a failed send surfaces one
 * controlled code and never leaks raw provider output.
 *
 * Strictly transactional (CASL): a lifecycle notice that the owner's own trial is
 * ending / has ended, with no marketing copy, no unsubscribe footer, and no
 * tracking pixel. Subject + body resolve from the recipient org's language (the
 * admin's default), localized EN/FR from the i18n catalogs, no em-dashes.
 *
 * Two stages, each sent at most once by the daily lifecycle cron:
 *   - `day12`: ~2 days before expiry — "your trial ends in N days";
 *   - `day14`: ~at expiry — "your trial has ended, data is view-only".
 */

type Language = "en" | "fr";
type Stage = "day12" | "day14";

const CATALOGS: Record<Language, (typeof en)["Trial"]["email"]> = {
  en: en.Trial.email,
  fr: fr.Trial.email,
};

export type SendTrialReminderEmailInput = {
  /** The recipient admin address (resolved by the cron from `org_members`). */
  to: string;
  /** The recipient org's language (its default) — drives subject + body copy. */
  language: Language;
  /** Which reminder stage this is. */
  stage: Stage;
  /** Days remaining until expiry (used in the Day-12 copy; ignored for Day-14). */
  daysRemaining: number;
  /** The org slug, used to build the billing-settings link in the CTA. */
  slug: string;
  /**
   * The app origin (e.g. `https://scheza.com`), passed by the cron from its own
   * request so the CTA link is absolute. Falls back to a relative path when absent
   * (no new env var is introduced).
   */
  appOrigin?: string;
};

/** Escape the handful of HTML-significant characters in interpolated copy. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Format an ICU message (with the `{days, plural, ...}` form) for a language. */
function formatIcu(
  message: string,
  language: Language,
  values: Record<string, number>,
): string {
  return new IntlMessageFormat(message, language).format(values) as string;
}

/**
 * Build the transactional reminder email (subject + HTML + plain text) for the
 * org's language and the given stage. Deliberately plain: no brand marketing, no
 * unsubscribe link, no tracking.
 */
function buildEmail(
  language: Language,
  stage: Stage,
  daysRemaining: number,
  link: string,
): { subject: string; html: string; text: string } {
  const c = CATALOGS[language];
  const values = { days: daysRemaining };

  const subject =
    stage === "day12"
      ? formatIcu(c.day12Subject, language, values)
      : formatIcu(c.day14Subject, language, values);
  const body =
    stage === "day12"
      ? formatIcu(c.day12Body, language, values)
      : formatIcu(c.day14Body, language, values);

  const langAttr = language === "fr" ? "fr" : "en";
  const bodyHtml = escapeHtml(body);
  const linkHtml = escapeHtml(link);
  const signatureHtml = escapeHtml(c.signature).replace(/\n/g, "<br />");

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
                <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#555555;">${escapeHtml(c.cta)}</p>
                <p style="margin:0 0 24px;font-size:14px;line-height:1.6;"><a href="${linkHtml}" style="color:#2563eb;">${linkHtml}</a></p>
                <p style="margin:0;font-size:15px;line-height:1.6;">${signatureHtml}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `${c.greeting}\n\n${body}\n\n${c.cta}\n${link}\n\n${c.signature}`;

  return { subject, html, text };
}

/**
 * Build the billing-settings link for the CTA. Absolute when the cron passes its
 * request `appOrigin`; relative otherwise (no new env var introduced).
 */
function buildBillingLink(slug: string, appOrigin?: string): string {
  const base = appOrigin?.replace(/\/$/, "") ?? "";
  return `${base}/${slug}/settings#billing`;
}

/**
 * Send a trial-reminder email. Throws `AppError(502, "sendFailed")` on any provider
 * error or thrown SDK call — the cron logs it and leaves the stage's `*_sent_at`
 * stamp unset so the reminder retries next run; raw provider output never leaks.
 */
export async function sendTrialReminderEmail(
  input: SendTrialReminderEmailInput,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new AppError(
      502,
      "sendFailed",
      "Missing RESEND_API_KEY or RESEND_FROM_EMAIL",
    );
  }

  const { subject, html, text } = buildEmail(
    input.language,
    input.stage,
    input.daysRemaining,
    buildBillingLink(input.slug, input.appOrigin),
  );

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from,
      to: input.to,
      subject,
      html,
      text,
    });
    if (error) {
      throw new AppError(502, "sendFailed", error.message);
    }
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(502, "sendFailed", (err as Error)?.message);
  }
}
