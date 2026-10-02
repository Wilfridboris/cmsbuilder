import { z } from "zod";

/**
 * Zod validator for the `/api/schema/tables` route (Story 5.7), factored into a
 * plain module (NOT the route file) so Next's route type-generator doesn't reject
 * it as an unexpected non-handler export — and so it's importable by pure
 * schema-shape unit tests. Mirrors `src/app/api/schema/views/schemas.ts`.
 *
 * The body is a TARGETED, non-LLM action (a confirm-button click, an Undo, or a
 * Settings Restore carries no natural language, so it must never spend a Gemini
 * call). Both actions re-derive the full definition from the stored schema, so a
 * client can never post an arbitrary schema:
 *   - `hide`    sets an EXISTING table's append-only `hidden` flag to true (the
 *     confirm button and the add-table Undo). The mutator refuses to hide the last
 *     visible table, so the dashboard can never empty;
 *   - `restore` flips it back to false (the chat show-again Undo and the Settings
 *     Restore control).
 *
 * A discriminated union keys each action off `action`; both carry `{ slug,
 * tableKey }`.
 */
export const schemaTablesSchema = z.discriminatedUnion("action", [
  z.object({
    slug: z.string().trim().min(1),
    action: z.literal("hide"),
    tableKey: z.string().trim().min(1),
  }),
  z.object({
    slug: z.string().trim().min(1),
    action: z.literal("restore"),
    tableKey: z.string().trim().min(1),
  }),
]);

export type SchemaTablesBody = z.infer<typeof schemaTablesSchema>;
