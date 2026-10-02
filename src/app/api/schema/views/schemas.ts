import { z } from "zod";

/**
 * Zod validator for the `/api/schema/views` route (Story 5.6), factored into a
 * plain module (NOT the route file) so Next's route type-generator doesn't reject
 * it as an unexpected non-handler export — and so it's importable by pure
 * schema-shape unit tests. Mirrors `src/app/api/schema/columns/schemas.ts`.
 *
 * The body is a TARGETED, non-LLM action (a button click or Undo carries no
 * natural language, so it must never spend a Gemini call):
 *   - `remove`  removes an EXISTING view by `viewKey`; the server re-derives the
 *     full definition from the stored schema, so a client can never post an
 *     arbitrary schema;
 *   - `restore` (the Undo of a removal) re-adds a view's `{label, sourceTableKey,
 *     filters, sort}` through the already-validated `addView` — the freed key
 *     re-derives identically. `filters`/`sort` are passed through to the focused
 *     `validateAddView`, which re-validates every field/operator before any write,
 *     so the restore shape is kept permissive here (the validator is the gate).
 *
 * A discriminated union keys each action's required fields off `action`.
 */
const filterSchema = z.object({
  field: z.string(),
  operator: z.string(),
  value: z.unknown().optional(),
  value2: z.unknown().optional(),
});

const sortSchema = z
  .object({
    field: z.string(),
    direction: z.string(),
  })
  .nullable();

export const schemaViewsSchema = z.discriminatedUnion("action", [
  z.object({
    slug: z.string().trim().min(1),
    action: z.literal("remove"),
    viewKey: z.string().trim().min(1),
  }),
  z.object({
    slug: z.string().trim().min(1),
    action: z.literal("restore"),
    view: z.object({
      label: z.string().trim().min(1),
      sourceTableKey: z.string().trim().min(1),
      filters: z.array(filterSchema).default([]),
      sort: sortSchema.default(null),
    }),
  }),
]);

export type SchemaViewsBody = z.infer<typeof schemaViewsSchema>;
