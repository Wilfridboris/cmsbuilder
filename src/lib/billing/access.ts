import "server-only";

import { AppError } from "@/types/api";
import type { SubscriptionStatus } from "@/types/db";

/**
 * Read-only write gate (Story 7.4, FR29). The single pure predicate that decides
 * whether an org may perform a guarded mutation, plus the assertion the writable
 * identity resolvers use to reject a non-writable org before any write.
 *
 * Mirrors `tiers.ts`'s module style: a small, dependency-light server-only module
 * that is the ONE place the "is this org writable?" rule lives, so the write-route
 * seam and the cron never re-derive it.
 *
 * The rule (Boundaries): `read_only`, the terminal `deleted` tombstone (Story 8.5),
 * and `trial` whose `trial_expires_at` has passed, are the only non-writable states.
 * `trial` (not expired), `active`, and `past_due` are writable — a failed-payment
 * customer in `past_due` is mid-dunning and must NOT be locked out (NFR-R4). An
 * expired trial is treated as read-only ON THE FLY so enforcement is correct even in
 * the window between the expiry instant and the next daily cron run that persists the
 * `trial` -> `read_only` flip.
 */

/** The subset of the org row the writable check needs (read as part of org resolution). */
export type AccessFields = {
  subscription_status: SubscriptionStatus;
  trial_expires_at: string | null;
};

/**
 * True when the org may NOT perform guarded writes: it is recorded `read_only`, or
 * it is still `trial` but `trial_expires_at` is non-null and at/before `now`. A
 * `trial` with a null expiry (never claimed / clock not started) is writable — the
 * gate never blocks a pre-claim/seed state. `active` and `past_due` are writable.
 */
export function isReadOnly(
  status: SubscriptionStatus,
  trialExpiresAt: string | null,
  now: Date = new Date(),
): boolean {
  // Story 8.5: the terminal `deleted` tombstone is non-writable too — an org whose
  // Day-30 purge has run must never accept a guarded write.
  if (status === "read_only" || status === "deleted") {
    return true;
  }
  if (status === "trial" && trialExpiresAt !== null) {
    return new Date(trialExpiresAt).getTime() <= now.getTime();
  }
  return false;
}

/**
 * True when the org is in the Story 8.5 offboarding grace period: a voluntary
 * cancellation stamped `offboarding_initiated_at` (the grace clock started) and the
 * Day-30 cascade has not yet run (`offboarding_purged_at` is null). This is the UI /
 * layout signal that distinguishes a delete-bound cancellation from a trial-expiry /
 * dunning `read_only` — both of which are plain `read_only` with no initiated stamp.
 * It intentionally does NOT re-check `subscription_status`: the webhook only stamps
 * `offboarding_initiated_at` while writing `read_only`, so the two always agree.
 */
export function isOffboarding(fields: {
  offboarding_initiated_at: string | null;
  offboarding_purged_at: string | null;
}): boolean {
  return (
    fields.offboarding_initiated_at !== null &&
    fields.offboarding_purged_at === null
  );
}

/** True for the terminal `deleted` tombstone (the Day-30 purge has run). */
export function isDeleted(status: SubscriptionStatus): boolean {
  return status === "deleted";
}

/**
 * Assert the resolved org may perform a guarded write. Throws
 * `AppError(403, "readOnly")` when {@link isReadOnly} holds — surfaced through the
 * standard `{ data, error }` envelope / `handleError`, never leaking internals.
 * Reads are never routed through this; only the writable-identity resolvers call it.
 */
export function assertWritable(fields: AccessFields): void {
  if (isReadOnly(fields.subscription_status, fields.trial_expires_at)) {
    throw new AppError(403, "readOnly");
  }
}
