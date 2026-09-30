import { z } from "zod";

/**
 * Zod validator for `POST /api/stripe/portal` (Story 7.3), in a plain module
 * (NOT the route file) so Next's route type-generator doesn't reject it as an
 * unexpected non-handler export, and so it's importable by pure schema-shape unit
 * tests. Mirrors `api/stripe/checkout/schemas.ts`.
 *
 * The body carries only the org `slug` (used to run the admin gate). Unlike
 * checkout there is no `tier`: the portal always opens the org's single existing
 * subscription. A missing/invalid slug maps to `AppError(400, "genericError")`
 * in the route.
 */
export const portalBodySchema = z.object({
  slug: z.string().min(1),
});

export type PortalBody = z.infer<typeof portalBodySchema>;
