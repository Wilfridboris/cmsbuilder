import { z } from "zod";

/**
 * Zod validators for the `/api/forms` route family (Epic 14, Story 14.1), factored into
 * a plain module (NOT the route files) so Next's route type-generator doesn't reject
 * them as unexpected non-handler exports — and so they're importable by pure
 * schema-shape unit tests with no HTTP harness. Mirrors `api/invoices/schemas.ts`.
 *
 * Every user-facing validation failure carries a `Forms.error.*` KEY so the route maps
 * it to the matrix status; raw Zod defaults never reach the client (they collapse to
 * `genericError` via `firstFormErrorKey`).
 */

/** The GET list query / slug-gate body: just the org slug. */
export const listQuerySchema = z.object({
  slug: z.string().trim().min(1),
});

/**
 * The create-form body: the org `slug` plus a non-empty `title`. A blank / whitespace
 * title is rejected with `Forms.error.titleRequired` (the matrix's empty-title row).
 */
export const createBodySchema = z.object({
  slug: z.string().trim().min(1),
  title: z.string().trim().min(1, "Forms.error.titleRequired"),
});

export type CreateBody = z.infer<typeof createBodySchema>;

/**
 * The rename body: the org `slug` plus the new non-empty `title`. The slug is NOT
 * touched here (slug is edited separately). A blank title -> `titleRequired`.
 */
export const renameBodySchema = z.object({
  slug: z.string().trim().min(1),
  title: z.string().trim().min(1, "Forms.error.titleRequired"),
});

export type RenameBody = z.infer<typeof renameBodySchema>;

/**
 * The slug-edit body: the org `slug` (the gate) plus the requested `slug` value for the
 * form. The value is non-empty here; the mutator normalizes it to kebab-case and rejects
 * a normalize-to-empty value with `Forms.error.slugInvalid`, or a collision with
 * `Forms.error.slugTaken`.
 */
export const slugBodySchema = z.object({
  slug: z.string().trim().min(1),
  newSlug: z.string().trim().min(1, "Forms.error.slugInvalid"),
});

export type SlugBody = z.infer<typeof slugBodySchema>;

/** The DELETE query: just the org slug. */
export const deleteQuerySchema = z.object({
  slug: z.string().trim().min(1),
});

/**
 * Pull the first `Forms.error.*` KEY out of a Zod failure, or `genericError` when the
 * failure carries only a Zod default message (e.g. a bad slug shape). Keeps raw
 * validation strings from ever reaching the client.
 */
export function firstFormErrorKey(error: z.ZodError): string {
  const message = error.issues[0]?.message ?? "";
  return message.startsWith("Forms.error.") ? message : "genericError";
}
