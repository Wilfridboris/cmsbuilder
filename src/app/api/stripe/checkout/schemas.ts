import { z } from "zod";

import { TIERS } from "@/lib/billing/tiers";

/**
 * Zod validator for `POST /api/stripe/checkout` (Story 7.2), in a plain module
 * (NOT the route file) so Next's route type-generator doesn't reject it as an
 * unexpected non-handler export, and so it's importable by pure schema-shape unit
 * tests. Mirrors `api/invoices/schemas.ts`.
 *
 * The body carries the org `slug` (used to run the admin gate) and the `tier`
 * (validated against the flat-tier set). 7.2's button only ever posts the default
 * tier, but the route stays tier-parameterized so 7.5's tier change reuses it. An
 * invalid/missing tier maps to `AppError(400, "invalidTier")` in the route.
 */
export const checkoutBodySchema = z.object({
  slug: z.string().min(1),
  tier: z.enum(TIERS),
});

export type CheckoutBody = z.infer<typeof checkoutBodySchema>;
