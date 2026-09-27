import { z } from "zod";

/**
 * Zod validator for `POST /api/schema/fields` (Story 3.7 Admin add-relation-field),
 * factored into a plain module (NOT the route file) so Next's route
 * type-generator doesn't reject it as an unexpected non-handler export — and so
 * it's importable by pure schema-shape unit tests. Mirrors
 * `src/app/api/schema/columns/schemas.ts`.
 *
 * The body describes ONE new single-reference relation field: the table it is
 * added to (`tableKey`), its human label, and the `targetTable` it points at. The
 * server re-derives the full definition from the stored schema and runs the
 * focused `validateRelationField` gate, so a client can never post an arbitrary
 * schema or a non-relation field through this route.
 */
export const addRelationFieldSchema = z.object({
  slug: z.string().trim().min(1),
  tableKey: z.string().trim().min(1),
  label: z.string().trim().min(1).max(120),
  targetTable: z.string().trim().min(1),
});
