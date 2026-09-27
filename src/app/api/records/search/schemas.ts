import { z } from "zod";

/**
 * Zod validator for `GET /api/records/search` (Story 3.7 relation typeahead),
 * factored into a plain module (NOT the route file) so Next's route
 * type-generator doesn't reject it as an unexpected non-handler export — and so
 * it's importable by pure schema-shape unit tests. Mirrors
 * `src/app/api/records/schemas.ts`.
 *
 * `slug` scopes the org; `table` is the TARGET table being searched; `query` is
 * the (possibly empty) typeahead text — an empty query lists the first N rows so
 * the picker shows candidates before the user types.
 */
export const searchQuerySchema = z.object({
  slug: z.string().trim().min(1),
  table: z.string().trim().min(1),
  query: z.string().max(200).optional().default(""),
});
