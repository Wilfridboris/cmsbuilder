import { z } from "zod";

import type { BusinessProfileRow } from "@/types/db";

/**
 * Zod validators for the `/api/business-profile` route (Story 12.1), factored into
 * a plain module (NOT the route file) so Next's route type-generator doesn't reject
 * them as unexpected non-handler exports — and so they're importable by pure
 * schema-shape unit tests with no HTTP harness. Mirrors `api/records/schemas.ts`.
 *
 * The PUT body carries the org `slug` plus every editable Business Profile field.
 * Validation enforces the frozen Boundaries: legal name required, entity type +
 * default language constrained to their CHECK vocabularies, and the GST/HST
 * number ↔ effective-date pairing (both present or both empty). Each failure
 * carries a `BusinessProfile.error.*` KEY so the route maps it to the matrix
 * status; raw messages never reach the client.
 *
 * The logo is uploaded on its own multipart route (`logo/route.ts`) and is NOT
 * part of this body — `logo_path` is server-owned and never client-supplied here.
 */

/** Entity-type vocabulary — matches the DB CHECK on `entity_type`. */
export const ENTITY_TYPES = [
  "sole_proprietor",
  "partnership",
  "corporation",
  "nonprofit",
  "other",
] as const;

/** Default-language vocabulary — matches the DB CHECK on `default_language`. */
export const PROFILE_LANGUAGES = ["en", "fr"] as const;

/**
 * A free-text field that treats "" as absent: trims, then maps an empty string to
 * `undefined` so the row stores NULL rather than "". Keeps the registration
 * pairing predicate ("both present or both empty") honest — a blank input is
 * empty, not a value.
 */
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

/**
 * True when `v` is a real `YYYY-MM-DD` calendar date. The format regex alone
 * accepts impossible dates (e.g. `2024-13-45`), which would pass Zod and then be
 * rejected by the Postgres `date` column as a generic 500; re-constructing the
 * date and comparing the parts rejects those at validation time instead.
 */
function isCalendarDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return false;
  }
  const [year, month, day] = v.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * The GST/HST registration date as `YYYY-MM-DD`, or absent. A non-empty value
 * must be a real calendar date; anything malformed (bad format OR an impossible
 * date like `2024-13-45`) is rejected with the pairing KEY (the route returns 400)
 * rather than leaking a date-parse message or bubbling up a DB error.
 */
const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional()
  .refine(
    (v) => v === undefined || isCalendarDate(v),
    "BusinessProfile.error.registrationPairRequired",
  );

export const putBodySchema = z
  .object({
    slug: z.string().trim().min(1),

    // Legal name is the only required field.
    legalName: z
      .string()
      .trim()
      .min(1, "BusinessProfile.error.legalNameRequired"),

    operatingName: optionalText,
    entityType: z.enum(ENTITY_TYPES).optional(),
    jurisdiction: optionalText,

    gstHstNumber: optionalText,
    gstHstEffectiveDate: optionalDate,

    businessAddress: optionalText,
    mailingAddress: optionalText,

    defaultPaymentTerms: optionalText,
    defaultLanguage: z.enum(PROFILE_LANGUAGES).default("en"),

    paymentInstructions: z
      .object({
        etransferEmail: optionalText,
        chequePayableTo: optionalText,
        chequeAddress: optionalText,
        cardLink: optionalText,
      })
      .default({}),
  })
  .superRefine((value, ctx) => {
    // Registration pairing: the number and the effective date must both be
    // present (registered) or both empty (unregistered). One without the other
    // is rejected before any write with the pairing KEY.
    const hasNumber = value.gstHstNumber !== undefined;
    const hasDate = value.gstHstEffectiveDate !== undefined;
    if (hasNumber !== hasDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gstHstEffectiveDate"],
        message: "BusinessProfile.error.registrationPairRequired",
      });
    }
  });

export type PutBody = z.infer<typeof putBodySchema>;

/** The GET query: just the org slug. */
export const getQuerySchema = z.object({
  slug: z.string().trim().min(1),
});

/**
 * Map a validated `PutBody` to the persisted column shape (minus the server-owned
 * `organization_id` / `actor_id` / timestamps / `logo_path`). Absent optionals
 * become NULL so a cleared field really clears. Shared by the mutation layer.
 */
export type BusinessProfileWritable = Pick<
  BusinessProfileRow,
  | "legal_name"
  | "operating_name"
  | "entity_type"
  | "jurisdiction"
  | "gst_hst_number"
  | "gst_hst_effective_date"
  | "business_address"
  | "mailing_address"
  | "default_payment_terms"
  | "default_language"
  | "payment_etransfer_email"
  | "payment_cheque_payable_to"
  | "payment_cheque_address"
  | "payment_card_link"
>;

export function toWritableProfile(body: PutBody): BusinessProfileWritable {
  return {
    legal_name: body.legalName,
    operating_name: body.operatingName ?? null,
    entity_type: body.entityType ?? null,
    jurisdiction: body.jurisdiction ?? null,
    gst_hst_number: body.gstHstNumber ?? null,
    gst_hst_effective_date: body.gstHstEffectiveDate ?? null,
    business_address: body.businessAddress ?? null,
    mailing_address: body.mailingAddress ?? null,
    default_payment_terms: body.defaultPaymentTerms ?? null,
    default_language: body.defaultLanguage,
    payment_etransfer_email: body.paymentInstructions.etransferEmail ?? null,
    payment_cheque_payable_to: body.paymentInstructions.chequePayableTo ?? null,
    payment_cheque_address: body.paymentInstructions.chequeAddress ?? null,
    payment_card_link: body.paymentInstructions.cardLink ?? null,
  };
}
