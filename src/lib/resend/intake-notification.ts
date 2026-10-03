import "server-only";

import { IntlMessageFormat } from "intl-messageformat";

import type { FieldDefinition } from "@/types/db";
import {
  escapeHtml,
  renderTransactionalEmail,
  sendTransactional,
} from "@/lib/resend/transactional";
import { formatCell, type CellStrings } from "@/lib/format";
import en from "@/lib/i18n/en.json";
import fr from "@/lib/i18n/fr.json";

/**
 * New-intake-submission notification email (Story 6.4, FR28). Mirrors the
 * trial-reminder sender (`trial-reminder.ts`): the same shared transactional
 * primitives (`renderTransactionalEmail` + `escapeHtml` + `sendTransactional`), the
 * same `<p>`-based inner HTML + plain-text twin, and the same `AppError(502,
 * "sendFailed")` masking on any provider error.
 *
 * Strictly transactional (CASL): a notice to the org's own admins that a public
 * intake form was submitted, with no marketing copy, no unsubscribe footer, and no
 * tracking pixel. Subject + chrome resolve from the org's default language (EN/FR);
 * the authored field labels and the submitted values are shown verbatim, never
 * translated.
 *
 * FR78: the email lists ONLY the written payload's scalar fields — the caller passes
 * `fields` from the intake target (which already excludes relation fields), so no
 * relationship/lookup value, id, label, or count can ever appear here.
 */

type Language = "en" | "fr";

const CATALOGS: Record<Language, (typeof en)["IntakeForm"]["email"]> = {
  en: en.IntakeForm.email,
  fr: fr.IntakeForm.email,
};

/** The yes/no/empty strings `formatCell` needs, from the `Generate.cell*` catalog. */
const CELL_STRINGS: Record<Language, CellStrings> = {
  en: {
    empty: en.Generate.cellEmpty,
    yes: en.Generate.cellYes,
    no: en.Generate.cellNo,
  },
  fr: {
    empty: fr.Generate.cellEmpty,
    yes: fr.Generate.cellYes,
    no: fr.Generate.cellNo,
  },
};

export type SendIntakeSubmissionEmailInput = {
  /** The recipient admin address (resolved by the caller from `org_members`). */
  to: string;
  /** The org's default language — drives the subject + chrome copy. */
  language: Language;
  /** The business name, shown in the subject + greeting. */
  orgName: string;
  /** The authored label of the table the submission landed in. */
  tableLabel: string;
  /** The org slug, used to build the owner-dashboard CTA link. */
  slug: string;
  /**
   * The intake target's eligible, non-relation fields in definition order (FR78:
   * excludes relation fields, so the summary can never surface relationship data).
   */
  fields: FieldDefinition[];
  /** The written record payload: only keys present here are listed. */
  data: Record<string, unknown>;
  /**
   * The app origin (e.g. `https://scheza.com`), passed by the route from its own
   * request so the CTA link is absolute. Falls back to a relative path when absent
   * (no new env var is introduced).
   */
  appOrigin?: string;
};

/** Format an ICU message (with an `{orgName}` argument) for a language. */
function formatIcu(
  message: string,
  language: Language,
  values: Record<string, string>,
): string {
  return new IntlMessageFormat(message, language).format(values) as string;
}

/** Build the owner-dashboard link for the CTA. Absolute when `appOrigin` is passed. */
function buildDashboardLink(slug: string, appOrigin?: string): string {
  const base = appOrigin?.replace(/\/$/, "") ?? "";
  return `${base}/${slug}`;
}

/**
 * The submitted-field summary: one `{ label, value }` per field (in definition
 * order) whose key is present in the written payload and whose formatted value is
 * non-blank. Values are type-formatted via the shared `formatCell`; labels and
 * values are authored/submitted content shown verbatim.
 */
function buildSummaryRows(
  fields: FieldDefinition[],
  data: Record<string, unknown>,
  cellStrings: CellStrings,
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  for (const field of fields) {
    if (!(field.key in data)) {
      continue;
    }
    const value = formatCell(data[field.key], field.type, cellStrings);
    if (value === "") {
      continue;
    }
    rows.push({ label: field.label, value });
  }
  return rows;
}

/**
 * Build the transactional notification email (subject + HTML + plain text) for the
 * org's language. Deliberately plain: no brand marketing, no unsubscribe link, no
 * tracking.
 */
function buildEmail(
  input: SendIntakeSubmissionEmailInput,
  link: string,
): { subject: string; html: string; text: string } {
  const c = CATALOGS[input.language];
  const langAttr = input.language === "fr" ? "fr" : "en";

  const subject = formatIcu(c.subject, input.language, { orgName: input.orgName });
  const intro = formatIcu(c.intro, input.language, {
    tableLabel: input.tableLabel,
  });

  const rows = buildSummaryRows(
    input.fields,
    input.data,
    CELL_STRINGS[input.language],
  );

  const linkHtml = escapeHtml(link);
  const signatureHtml = escapeHtml(c.signature).replace(/\n/g, "<br />");

  const rowsHtml = rows
    .map(
      (row) =>
        `                <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#333333;"><strong>${escapeHtml(
          row.label,
        )}:</strong> ${escapeHtml(row.value)}</p>`,
    )
    .join("\n");

  const innerHtml = [
    `                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(c.greeting)}</p>`,
    `                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#333333;">${escapeHtml(intro)}</p>`,
    `                <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#555555;font-weight:600;">${escapeHtml(c.detailsHeading)}</p>`,
    rowsHtml,
    `                <p style="margin:24px 0 8px;font-size:14px;line-height:1.6;color:#555555;">${escapeHtml(c.cta)}</p>`,
    `                <p style="margin:0 0 24px;font-size:14px;line-height:1.6;"><a href="${linkHtml}" style="color:#2563eb;">${linkHtml}</a></p>`,
    `                <p style="margin:0;font-size:15px;line-height:1.6;">${signatureHtml}</p>`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  const html = renderTransactionalEmail({ langAttr, subject, innerHtml });

  const rowsText = rows.map((row) => `${row.label}: ${row.value}`).join("\n");
  const text = [
    c.greeting,
    "",
    intro,
    "",
    c.detailsHeading,
    rowsText,
    "",
    c.cta,
    link,
    "",
    c.signature,
  ].join("\n");

  return { subject, html, text };
}

/**
 * Send a new-submission notification email. Throws `AppError(502, "sendFailed")` on
 * any provider error, thrown SDK call, or missing `RESEND_*` env — the caller (the
 * intake route) catches it, reports it, and still returns 200 so a notification
 * failure never blocks data capture (FR28).
 */
export async function sendIntakeSubmissionEmail(
  input: SendIntakeSubmissionEmailInput,
): Promise<void> {
  const { subject, html, text } = buildEmail(
    input,
    buildDashboardLink(input.slug, input.appOrigin),
  );

  await sendTransactional({ to: input.to, subject, html, text });
}
