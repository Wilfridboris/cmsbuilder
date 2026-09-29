import { z } from "zod";

/**
 * Zod validators for the `/api/invoices` route family (Story 12.2), factored into
 * a plain module (NOT the route files) so Next's route type-generator doesn't
 * reject them as unexpected non-handler exports — and so they're importable by
 * pure schema-shape unit tests with no HTTP harness. Mirrors
 * `api/business-profile/schemas.ts` and `api/records/schemas.ts`.
 *
 * The draft body carries the org `slug`, an optional loose `customerRecordId`,
 * an optional `province`, a `language` enum, an optional `version` (present on an
 * update for the optimistic-concurrency gate), and a non-empty `lineItems[]` (a
 * draft needs at least one line). Every failure carries a `Invoice.error.*` KEY so
 * the route maps it to the matrix status; raw Zod defaults never reach the client.
 */

/** Invoice language vocabulary — matches the DB CHECK on `invoices.language`. */
export const INVOICE_LANGUAGES = ["en", "fr"] as const;

/**
 * A free-text field that treats "" as absent: trims, then maps an empty string to
 * `undefined` so the row stores NULL rather than "".
 */
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

/**
 * A single line item as submitted by the client. `description` must be non-empty
 * (`descriptionRequired`); `quantity` and `unitPrice` must be finite non-negative
 * numbers (`amountInvalid`). `amount` is NOT accepted from the client — it is
 * computed server-side by the canonical `computeLineAmount` (Invariant I2).
 */
export const lineItemSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Invoice.error.descriptionRequired"),
  quantity: z
    .number({ message: "Invoice.error.amountInvalid" })
    .finite("Invoice.error.amountInvalid")
    .nonnegative("Invoice.error.amountInvalid"),
  unitPrice: z
    .number({ message: "Invoice.error.amountInvalid" })
    .finite("Invoice.error.amountInvalid")
    .nonnegative("Invoice.error.amountInvalid"),
});

export type LineItemInput = z.infer<typeof lineItemSchema>;

/**
 * The shared draft-body shape (create + update). `version` is optional (present
 * only on an update, for the version gate). `lineItems` must have at least one
 * entry — a draft with zero lines is rejected (`lineItemsRequired`).
 */
export const draftBodySchema = z.object({
  slug: z.string().trim().min(1),
  customerRecordId: z
    .string()
    .uuid("Invoice.error.customerRecordInvalid")
    .optional(),
  province: optionalText,
  language: z.enum(INVOICE_LANGUAGES).default("en"),
  version: z.number().int().nonnegative().optional(),
  lineItems: z
    .array(lineItemSchema)
    .min(1, "Invoice.error.lineItemsRequired"),
});

export type DraftBody = z.infer<typeof draftBodySchema>;

/**
 * The issue-invoice body (Story 12.4): the org `slug` and the REQUIRED `version` the
 * caller last read (the optimistic-concurrency gate — issuing a stale or non-draft row
 * is a 409). No `issue_date` is accepted: it is server-authoritative (TODAY), never
 * client-supplied (no back/forward dating).
 */
export const issueBodySchema = z.object({
  slug: z.string().trim().min(1),
  version: z.number().int().nonnegative(),
});

export type IssueBody = z.infer<typeof issueBodySchema>;

/** The GET list query: just the org slug. */
export const listQuerySchema = z.object({
  slug: z.string().trim().min(1),
});

/** The single-invoice GET / DELETE query: just the org slug. */
export const getQuerySchema = z.object({
  slug: z.string().trim().min(1),
});

/**
 * Pull the first `Invoice.error.*` KEY out of a Zod failure, or `genericError`
 * when the failure carries only a Zod default message (e.g. a bad slug shape).
 * Keeps raw validation strings from ever reaching the client.
 */
export function firstInvoiceErrorKey(error: z.ZodError): string {
  const message = error.issues[0]?.message ?? "";
  return message.startsWith("Invoice.error.") ? message : "genericError";
}

/** A validated line item mapped to the write shape the mutation layer consumes. */
export type WritableLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
};

/**
 * Map a validated `DraftBody` to the write input the mutation layer consumes
 * (minus the server-owned `slug`). The `amount` per line is NOT here — the
 * mutation layer computes it with `computeLineAmount` (I2).
 */
export type WritableDraft = {
  customerRecordId: string | null;
  province: string | null;
  language: (typeof INVOICE_LANGUAGES)[number];
  version: number | null;
  lineItems: WritableLineItem[];
};

export function toWritableDraft(body: DraftBody): WritableDraft {
  return {
    customerRecordId: body.customerRecordId ?? null,
    province: body.province ?? null,
    language: body.language,
    version: body.version ?? null,
    lineItems: body.lineItems.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    })),
  };
}
