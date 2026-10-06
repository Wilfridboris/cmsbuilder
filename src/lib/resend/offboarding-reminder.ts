import "server-only";

import {
  escapeHtml,
  renderTransactionalEmail,
  sendTransactional,
} from "@/lib/resend/transactional";
import en from "@/lib/i18n/en.json";
import fr from "@/lib/i18n/fr.json";

/**
 * Offboarding warning email (Story 8.5, FR39). Mirrors `sendTrialReminderEmail`: the
 * same shared transactional primitives (`renderTransactionalEmail`, `escapeHtml`,
 * `sendTransactional`), the same lazy `RESEND_*` reads, and the same
 * `AppError(502, "sendFailed")` masking so a failed send surfaces one controlled code
 * and never leaks raw provider output.
 *
 * Strictly transactional (CASL): a lifecycle notice that the owner's own account is
 * scheduled to close, with no marketing copy, no unsubscribe footer, and no tracking
 * pixel. Subject + body resolve from the recipient org's language (EN/FR), no
 * em-dashes. The CTA points at the Settings "Close account" section where the export
 * lives (so the owner can download their data before deletion).
 *
 * Three stages, each sent at most once by the daily offboarding cron:
 *   - `day1`:  grace started — "your account will be deleted on {date}";
 *   - `day7`:  one week in — reminder with the same deletion date;
 *   - `day25`: five days left — final reminder.
 */

type Language = "en" | "fr";
type Stage = "day1" | "day7" | "day25";

const CATALOGS: Record<Language, (typeof en)["Offboarding"]["email"]> = {
  en: en.Offboarding.email,
  fr: fr.Offboarding.email,
};

export type SendOffboardingReminderEmailInput = {
  /** The recipient admin address (resolved by the cron from `org_members`). */
  to: string;
  /** The recipient org's language (its default) — drives subject + body copy. */
  language: Language;
  /** Which warning stage this is. */
  stage: Stage;
  /** The org slug, used to build the export/settings link in the CTA. */
  slug: string;
  /** The localized, pre-formatted deletion date (e.g. "November 4, 2026"). */
  deletionDate: string;
  /**
   * The app origin (e.g. `https://scheza.com`), passed by the cron from its own
   * request so the CTA link is absolute. Falls back to a relative path when absent
   * (no new env var is introduced).
   */
  appOrigin?: string;
};

/**
 * Build the transactional warning email (subject + HTML + plain text) for the org's
 * language and stage. Deliberately plain: no brand marketing, no unsubscribe link,
 * no tracking. `{date}` interpolation is a plain substring replace on the already
 * localized date string (no ICU plural needed here).
 */
function buildEmail(
  language: Language,
  stage: Stage,
  deletionDate: string,
  link: string,
): { subject: string; html: string; text: string } {
  const c = CATALOGS[language];
  const stageCopy = c[stage];

  const subject = stageCopy.subject.replace("{date}", deletionDate);
  const body = stageCopy.body.replace("{date}", deletionDate);

  const langAttr = language === "fr" ? "fr" : "en";
  const bodyHtml = escapeHtml(body);
  const linkHtml = escapeHtml(link);
  const signatureHtml = escapeHtml(c.signature).replace(/\n/g, "<br />");

  const innerHtml = [
    `                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(c.greeting)}</p>`,
    `                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#333333;">${bodyHtml}</p>`,
    `                <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#555555;">${escapeHtml(c.cta)}</p>`,
    `                <p style="margin:0 0 24px;font-size:14px;line-height:1.6;"><a href="${linkHtml}" style="color:#2563eb;">${linkHtml}</a></p>`,
    `                <p style="margin:0;font-size:15px;line-height:1.6;">${signatureHtml}</p>`,
  ].join("\n");

  const html = renderTransactionalEmail({ langAttr, subject, innerHtml });
  const text = `${c.greeting}\n\n${body}\n\n${c.cta}\n${link}\n\n${c.signature}`;

  return { subject, html, text };
}

/**
 * Build the Settings "Close account" link for the CTA (the export lives in that
 * section). Absolute when the cron passes its request `appOrigin`; relative otherwise
 * (no new env var introduced).
 */
function buildOffboardingLink(slug: string, appOrigin?: string): string {
  const base = appOrigin?.replace(/\/$/, "") ?? "";
  return `${base}/${slug}/settings#offboarding`;
}

/**
 * Send an offboarding warning email. Throws `AppError(502, "sendFailed")` on any
 * provider error or thrown SDK call — the cron logs it and leaves the stage's
 * `*_sent_at` stamp unset so the warning retries next run; raw provider output never
 * leaks.
 */
export async function sendOffboardingReminderEmail(
  input: SendOffboardingReminderEmailInput,
): Promise<void> {
  const { subject, html, text } = buildEmail(
    input.language,
    input.stage,
    input.deletionDate,
    buildOffboardingLink(input.slug, input.appOrigin),
  );

  await sendTransactional({ to: input.to, subject, html, text });
}
