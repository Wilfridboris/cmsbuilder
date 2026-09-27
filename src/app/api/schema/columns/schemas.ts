import { z } from "zod";

/**
 * Zod validator for the `/api/schema/columns` route (Story 3.5), factored into a
 * plain module (NOT the route file) so Next's route type-generator doesn't reject
 * it as an unexpected non-handler export — and so it's importable by pure
 * schema-shape unit tests. Mirrors `src/app/api/records/schemas.ts`.
 *
 * The body is a TARGETED patch: the endpoint only ever toggles the `hidden` flag
 * of ONE existing field on ONE table. The server re-derives the full definition
 * from the stored schema, so a client can never post an arbitrary schema.
 */
export const setColumnVisibilitySchema = z.object({
  slug: z.string().trim().min(1),
  tableKey: z.string().trim().min(1),
  fieldKey: z.string().trim().min(1),
  hidden: z.boolean(),
});
