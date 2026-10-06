import { z } from "zod";

/**
 * Zod validator for the `/api/export` route (Story 8.4), factored into a plain
 * module (NOT the route file) so Next's route type-generator doesn't reject it as
 * an unexpected non-handler export, and so it stays importable by pure tests.
 */
export const exportQuerySchema = z.object({
  slug: z.string().trim().min(1),
});
