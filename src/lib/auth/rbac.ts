import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import { resolveUserOrgMembership, type ResolvedMembership } from "@/lib/auth/org";

/**
 * RBAC enforcement primitive (Story 2.4) — the single reusable authority for
 * "the caller must be an Admin of their org."
 *
 * This is the one seam every current and future Admin-only server surface
 * (invite today; schema-mutation, billing, settings later) reuses so the check
 * is never re-invented and never drifts. Role is resolved AUTHORITATIVELY from
 * `org_members` via `resolveUserOrgMembership` (the DB read), not the JWT
 * `user_metadata` convenience copy — one source of truth, immune to a stale JWT
 * after any future role change.
 *
 * Enforcement is server-side and independent of any UI hiding (frontend hiding
 * is a UX affordance, never the sole gate):
 *   - `user === null` (no valid session)          → `AppError(401, 'unauthorized')`;
 *   - no `org_members` row / `role !== 'admin'`   → `AppError(403, 'forbidden')`;
 *   - an Admin of their org                        → returns the `ResolvedMembership`.
 *
 * Callers pass the JWT-validated `User` (from `getCurrentUser()`) and the
 * service-role `adminClient` (the narrow membership-read seam), so the guard can
 * resolve membership under RLS-independent reads while identity stays proven by
 * the caller's session.
 */
export async function requireAdmin(
  user: User | null,
  adminClient: SupabaseClient,
): Promise<ResolvedMembership> {
  // 1. No valid session → 401. Distinct from the 403 below so an expired session
  //    surfaces a "sign in again" message rather than a "not allowed" one.
  if (!user) {
    throw new AppError(401, "unauthorized");
  }

  // 2. Resolve the caller's membership authoritatively from org_members. A
  //    non-member resolves to null; a Member resolves with role 'member'. Both
  //    are 403 — the guarded surface is Admin-only and server-enforced.
  const membership = await resolveUserOrgMembership(user.id, adminClient);
  if (!membership || membership.role !== "admin") {
    throw new AppError(403, "forbidden");
  }

  return membership;
}
