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

/**
 * The publish-toggle body (Story 14.3): the org `slug` (the gate) plus a `published`
 * boolean. Checked FIRST in the PATCH handler (a `published` boolean discriminates the
 * publish branch from slug-edit / rename). The mutator re-evaluates the publish gate and
 * rejects a blocked publish with `Forms.error.publishBlocked`.
 */
export const publishBodySchema = z.object({
  slug: z.string().trim().min(1),
  published: z.boolean(),
});

export type PublishBody = z.infer<typeof publishBodySchema>;

/**
 * The target-table body (Story 14.4): the org `slug` (the gate) plus the chosen
 * `targetTableKey`. Discriminated in the PATCH handler after publish and before slug/
 * rename. The mutator validates the key names a currently-visible table and rejects a
 * non-visible target with `Forms.error.targetInvalid` (or `Forms.error.targetLocked` on
 * a published form).
 */
export const targetBodySchema = z.object({
  slug: z.string().trim().min(1),
  targetTableKey: z.string().trim().min(1),
});

export type TargetBody = z.infer<typeof targetBodySchema>;

/**
 * The per-field customization body (Story 14.5): the org `slug` (the gate) plus the full
 * ordered `fieldConfig` array for the form's non-relation fields. Discriminated in the
 * PATCH handler AFTER the target branch and BEFORE slug/rename (its `fieldConfig` array
 * key is unique to this shape). Each entry customizes one target-table field by `key`;
 * `label`/`helpText` are optional public overrides, `included` is the visibility toggle,
 * `order` the render position. The mutator re-validates every entry against the current
 * target table (dropping relation/stale keys, FR78), so a forged key never persists —
 * the Zod shape here is only a structural gate.
 */
export const fieldConfigBodySchema = z.object({
  slug: z.string().trim().min(1),
  fieldConfig: z.array(
    z.object({
      key: z.string().trim().min(1),
      label: z.string().optional(),
      helpText: z.string().optional(),
      included: z.boolean().optional(),
      order: z.number().int().optional(),
    }),
  ),
});

export type FieldConfigBody = z.infer<typeof fieldConfigBodySchema>;

/**
 * The intro-text body (Story 14.6): the org `slug` (the gate) plus the owner-authored
 * `introText`. An empty string is allowed (it clears the intro — the mutator trims and
 * stores `null` when blank). Capped at 500 characters server-side; an over-length value
 * is rejected with `Forms.error.introTooLong`. Discriminated in the PATCH handler AFTER
 * the field-config branch and BEFORE slug/rename (its `introText` string key is unique to
 * this shape).
 */
export const introTextBodySchema = z.object({
  slug: z.string().trim().min(1),
  introText: z.string().max(500, "Forms.error.introTooLong"),
});

export type IntroTextBody = z.infer<typeof introTextBodySchema>;

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
