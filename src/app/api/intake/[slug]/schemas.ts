import { z } from "zod";

/**
 * Zod validator for the public intake POST (`/api/intake/[slug]`, Story 6.2),
 * factored into a plain module (NOT the route file) so Next's route type-generator
 * doesn't reject it as an unexpected non-handler export, and so the shape is unit-
 * testable with no HTTP harness. Mirrors `api/records/schemas.ts`.
 *
 * `values` is an untrusted bag of raw draft values keyed by field key. The handler
 * re-resolves the eligible-field allowlist server-side and ignores every key not on
 * it, so this schema only needs to prove the envelope shape — it never decides the
 * table or the columns.
 */
export const intakeBodySchema = z.object({
  /** Raw draft values keyed by field key (strings, numbers, or booleans). */
  values: z.record(z.string(), z.unknown()),
  /** A per-form-instance key so a retried submit dedupes to one logical write. */
  idempotencyKey: z.string().trim().min(1),
  /**
   * Honeypot carrier (Story 14.7): a hidden, autofill-suppressed field a human never
   * reaches. Declared here because Zod strips unknown keys — without it the bot's value
   * would be dropped before `submitToTarget` could see it. Non-empty after trim ⇒ a
   * silent bot drop (handled in `submit.ts`), indistinguishable from a real success.
   */
  website: z.string().optional(),
});
