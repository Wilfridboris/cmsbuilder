/**
 * The privacy/terms policy version the consent checkbox accepts (Story 2.1).
 *
 * Relocated out of the `POST /api/claim` route module (Story 15.1): Next's typed
 * routes reject a non-handler named export from a route file (the build blocker
 * noted in epic-15 context), and `/auth/confirm` needs this constant too. Living
 * in a plain lib module lets both the claim route and the confirm route import
 * it without tripping the route-module export constraint. Bump on policy change.
 */
export const CURRENT_POLICY_VERSION = "2026-09-24";
