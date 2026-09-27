import { z } from "zod";

/**
 * Zod validators for the `/api/records` route family (Story 3.2), factored into
 * a plain module (NOT the route files) so Next's route type-generator doesn't
 * reject them as unexpected non-handler exports — and so they're importable by
 * pure schema-shape unit tests with no HTTP harness.
 */

/**
 * One relation filter from a repeatable `rel` query param (Story 3.8), encoded
 * `"<fieldKey>:<uuid>"`. Split on the FIRST colon only (a field key never
 * contains one; a UUID never does either, but be defensive). Both parts must be
 * non-empty. Invalid entries reject the whole request (400) so a malformed
 * filter never silently widens the result set.
 */
export const RELATION_FILTER_RE = /^([^:]+):(.+)$/;

export const relationFilterSchema = z
  .string()
  .trim()
  .min(1)
  .transform((raw, ctx) => {
    const match = RELATION_FILTER_RE.exec(raw);
    if (!match) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "bad rel param" });
      return z.NEVER;
    }
    const field = match[1].trim();
    const targetId = match[2].trim();
    if (field === "" || targetId === "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "bad rel param" });
      return z.NEVER;
    }
    return { field, targetId };
  });

export const listQuerySchema = z.object({
  slug: z.string().trim().min(1),
  table: z.string().trim().min(1),
  // Repeatable `rel` params → relation filters. Absent → no relation filters.
  rel: z.array(relationFilterSchema).optional().default([]),
});

export const createBodySchema = z.object({
  slug: z.string().trim().min(1),
  table: z.string().trim().min(1),
  data: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().trim().min(1),
});

export const deleteQuerySchema = z.object({
  slug: z.string().trim().min(1),
  expectedVersion: z.coerce.number().int().nonnegative(),
});

export const updateBodySchema = z.object({
  slug: z.string().trim().min(1),
  table: z.string().trim().min(1),
  data: z.record(z.string(), z.unknown()),
  expectedVersion: z.coerce.number().int().nonnegative(),
});
