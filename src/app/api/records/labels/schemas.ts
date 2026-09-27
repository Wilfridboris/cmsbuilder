import { z } from "zod";

/**
 * Zod validator for `GET /api/records/labels` (Story 3.7 batched label display),
 * factored into a plain module (NOT the route file) so Next's route
 * type-generator doesn't reject it as an unexpected non-handler export — and so
 * it's importable by pure schema-shape unit tests. Mirrors
 * `src/app/api/records/schemas.ts`.
 *
 * `ids` arrives as a comma-separated list in the query string; it is capped so a
 * single request can never ask for an unbounded `id IN (...)`. `table` is the
 * TARGET table whose display labels are resolved.
 */
export const MAX_LABEL_IDS = 200;

export const labelsQuerySchema = z.object({
  slug: z.string().trim().min(1),
  table: z.string().trim().min(1),
  ids: z
    .string()
    .trim()
    .min(1)
    .transform((raw) =>
      raw
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    )
    .refine((ids) => ids.length > 0 && ids.length <= MAX_LABEL_IDS, {
      message: "ids must be 1..MAX_LABEL_IDS non-empty values",
    }),
});
