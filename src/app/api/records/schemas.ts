import { z } from "zod";

/**
 * Zod validators for the `/api/records` route family (Story 3.2), factored into
 * a plain module (NOT the route files) so Next's route type-generator doesn't
 * reject them as unexpected non-handler exports — and so they're importable by
 * pure schema-shape unit tests with no HTTP harness.
 */

export const listQuerySchema = z.object({
  slug: z.string().trim().min(1),
  table: z.string().trim().min(1),
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
