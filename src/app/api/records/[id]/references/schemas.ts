import { z } from "zod";

/**
 * Zod validator for `GET /api/records/[id]/references` (Story 3.8 safe-delete
 * guard), factored into a plain module (NOT the route file) so Next's route
 * type-generator doesn't reject it as an unexpected non-handler export — and so
 * it's importable by pure schema-shape unit tests. Mirrors
 * `src/app/api/records/schemas.ts`.
 *
 * `slug` scopes the org; `table` is the table the target record belongs to (used
 * to enumerate the schema's inbound relation pairs). The record id is a path
 * param, validated in the route handler.
 */
export const referencesQuerySchema = z.object({
  slug: z.string().trim().min(1),
  table: z.string().trim().min(1),
});
