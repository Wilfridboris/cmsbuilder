import { z } from "zod";

/**
 * Zod validator for `POST /api/schema/add-field` (Story 5.1 — add a column via
 * chat), factored into a plain module (NOT the route file) so Next's route
 * type-generator doesn't reject it as an unexpected non-handler export — and so
 * it's importable by pure schema-shape unit tests. Mirrors
 * `src/app/api/schema/fields/schemas.ts`.
 *
 * The body is the ephemeral chat turn: the org `slug`, the owner's free-text
 * `message`, the optional `currentTableKey` (the table currently viewed, used for
 * unambiguous target inference), and the optional ephemeral `conversation` so a
 * clarifying-question round-trip carries context. Conversation history is NEVER
 * persisted server-side — it lives only in the browser session and is re-sent with
 * each request. The server re-derives the schema from storage and runs every
 * guard, so a client can never post an arbitrary schema through this route.
 */
export const addFieldChatSchema = z.object({
  slug: z.string().trim().min(1),
  message: z.string().trim().min(1).max(2000),
  currentTableKey: z.string().trim().min(1).max(200).optional(),
  conversation: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .max(20)
    .optional(),
});

export type AddFieldChatBody = z.infer<typeof addFieldChatSchema>;
