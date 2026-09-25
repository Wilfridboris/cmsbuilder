import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PendingClaimRow, SchemaDefinition } from "@/types/db";
import { ensureUniqueSlug } from "@/lib/claim/slug";

/**
 * Core claim bootstrap (Story 2.1) — the ONLY place the service-role admin
 * client is used for a claim beyond the initial schema/pending-claim
 * persistence. Every subsequent tenant write goes through `mutate.ts` under the
 * user's RLS-scoped client.
 *
 * Two entry points:
 *
 *   - `createPendingClaim` (claim POST, pre-auth): overwrite the session org's
 *     `org_schemas.definition` with the visitor's OVERRIDDEN schema (so the 1.7
 *     hide/rename edits survive the round trip), insert a `pending_claims` row
 *     carrying email + consent timestamp + the derived slug base, and return its
 *     random `token`. The token is embedded in the magic link.
 *
 *   - `finalizeClaim` (auth callback, authenticated): resolve the token,
 *     validate it (unused + unexpired), then promote the session org IN PLACE —
 *     insert an `org_members` admin row (`principal_type:'human'`), set a unique
 *     slug, and soft-delete every synthetic `records` row for the org. Idempotent
 *     on re-entry: a token already consumed for the SAME org+user is a safe no-op
 *     that returns the org's current slug so the callback can still land the user.
 *
 * The consent timestamp is also written to the authenticated user's metadata by
 * the caller (the callback), per the frozen constraint.
 */

/** How long a pending claim is honored before the link must be re-requested. */
export const PENDING_CLAIM_TTL_MS = 60 * 60 * 1000; // 1 hour — mirrors magic-link life.

/** System actor id for the claim-time soft-delete of synthetic records. */
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-0000000000a0";

export type CreatePendingClaimInput = {
  /** The anonymous session org id (resolved from the signed cookie). */
  sessionOrgId: string;
  email: string;
  /** The visitor's OVERRIDDEN schema (1.7 hide/rename applied). */
  schema: SchemaDefinition;
  /** When the visitor accepted the privacy consent. */
  consentAt: Date;
  /** The privacy/terms version the visitor accepted. */
  policyVersion: string;
  /** The auto-derived base slug (trade + city); uniqueness resolved at finalize. */
  slugBase: string;
};

export type FinalizeClaimInput = {
  token: string;
  /** The now-authenticated user's id (from the exchanged session). */
  userId: string;
  adminClient: SupabaseClient;
};

export type FinalizeClaimResult = {
  slug: string;
  /**
   * The true consent moment — captured at claim-submit time and stored on the
   * pending claim. The callback writes THIS onto the user's metadata so the
   * audited consent timestamp reflects when the user actually agreed, not when
   * the (possibly much-later) magic-link callback ran.
   */
  consentAcceptedAt: string;
};

/** Distinguishes an unresolvable / expired token from an operational failure. */
export class ClaimError extends Error {
  constructor(
    readonly kind: "not-found" | "expired" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "ClaimError";
  }
}

/**
 * Persist the overridden schema + a pending-claim row for the session org, and
 * return the random token to embed in the magic link. Service-role only.
 *
 * The schema is written FIRST so a later insert failure never leaves a claimed
 * org with a partially-applied schema. The token is 256 bits of CSPRNG entropy,
 * base64url — opaque and unguessable.
 */
export async function createPendingClaim(
  input: CreatePendingClaimInput,
  adminClient: SupabaseClient,
): Promise<{ token: string }> {
  // Carry the 1.7 overrides into the live schema before the round trip.
  const { error: schemaError } = await adminClient.from("org_schemas").upsert(
    {
      organization_id: input.sessionOrgId,
      definition: input.schema,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  if (schemaError) {
    throw new ClaimError(
      "failed",
      `Failed to persist claim schema: ${schemaError.message}`,
    );
  }

  const token = randomBytes(32).toString("base64url");
  const now = Date.now();

  const { error: claimError } = await adminClient.from("pending_claims").insert({
    id: randomUUID(),
    token,
    email: input.email,
    session_org_id: input.sessionOrgId,
    consent_accepted_at: input.consentAt.toISOString(),
    policy_version: input.policyVersion,
    slug_base: input.slugBase,
    expires_at: new Date(now + PENDING_CLAIM_TTL_MS).toISOString(),
  });
  if (claimError) {
    throw new ClaimError(
      "failed",
      `Failed to create pending claim: ${claimError.message}`,
    );
  }

  return { token };
}

/** Read the org's current slug (used to return a stable slug on idempotent re-entry). */
async function readOrgSlug(
  adminClient: SupabaseClient,
  orgId: string,
): Promise<string | null> {
  const { data, error } = await adminClient
    .from("organizations")
    .select("slug")
    .eq("id", orgId)
    .maybeSingle();
  if (error) {
    throw new ClaimError("failed", `Failed to read org slug: ${error.message}`);
  }
  return (data?.slug as string | undefined) ?? null;
}

/**
 * Finalize a claim: promote the session org in place. Idempotent.
 *
 * Steps (all under the service-role admin client — the narrow bootstrap):
 *   1. Resolve the token → pending claim. Missing → `not-found`.
 *   2. If already consumed, return the org's current slug (no-op re-entry).
 *   3. If expired, raise `expired` (the callback surfaces the re-request path).
 *   4. Insert the `org_members` admin row (human). A duplicate membership (the
 *      unique(org_id,user_id) index) is treated as already-present — idempotent.
 *   5. Resolve + set a unique slug on the org.
 *   6. Soft-delete every synthetic `records` row for the org.
 *   7. Mark the claim consumed so a later callback with the same token no-ops.
 */
export async function finalizeClaim(
  input: FinalizeClaimInput,
): Promise<FinalizeClaimResult> {
  const { token, userId, adminClient } = input;

  const { data: claimRow, error: lookupError } = await adminClient
    .from("pending_claims")
    .select(
      "id, session_org_id, slug_base, expires_at, consumed_at, consent_accepted_at",
    )
    .eq("token", token)
    .maybeSingle();

  if (lookupError) {
    throw new ClaimError(
      "failed",
      `Failed to resolve pending claim: ${lookupError.message}`,
    );
  }
  if (!claimRow) {
    throw new ClaimError("not-found", "No pending claim for this token.");
  }

  const claim = claimRow as Pick<
    PendingClaimRow,
    | "id"
    | "session_org_id"
    | "slug_base"
    | "expires_at"
    | "consumed_at"
    | "consent_accepted_at"
  >;
  const orgId = claim.session_org_id;

  // Idempotent re-entry: the token was already consumed — just return the slug.
  if (claim.consumed_at) {
    const slug = await readOrgSlug(adminClient, orgId);
    if (!slug) {
      throw new ClaimError("failed", "Claimed org is missing a slug.");
    }
    return { slug, consentAcceptedAt: claim.consent_accepted_at };
  }

  // Expired token → re-request path. No partial bootstrap.
  if (new Date(claim.expires_at).getTime() < Date.now()) {
    throw new ClaimError("expired", "This claim link has expired.");
  }

  // 4. Admin membership (human). Unique(org_id,user_id) makes this idempotent:
  // a duplicate is a no-op, not a failure.
  const { error: memberError } = await adminClient.from("org_members").insert({
    id: randomUUID(),
    organization_id: orgId,
    user_id: userId,
    principal_type: "human",
    role: "admin",
  });
  if (memberError && !isUniqueViolation(memberError.code)) {
    throw new ClaimError(
      "failed",
      `Failed to create admin membership: ${memberError.message}`,
    );
  }

  // 5. Provision a unique, human-readable slug on the org.
  const slug = await ensureUniqueSlug(adminClient, claim.slug_base, orgId);
  const { error: slugError } = await adminClient
    .from("organizations")
    .update({ slug, updated_at: new Date().toISOString() })
    .eq("id", orgId);
  if (slugError) {
    throw new ClaimError("failed", `Failed to set org slug: ${slugError.message}`);
  }

  // 6. Clear the synthetic demo records (soft-delete — data retained, excluded
  // from reads). The live schema stays; only seeded rows drop out.
  const { error: clearError } = await adminClient
    .from("records")
    .update({
      deleted_at: new Date().toISOString(),
      actor_id: SYSTEM_ACTOR_ID,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId)
    .is("deleted_at", null);
  if (clearError) {
    throw new ClaimError(
      "failed",
      `Failed to clear synthetic records: ${clearError.message}`,
    );
  }

  // 7. Consume the token so a later callback with the same token no-ops.
  const { error: consumeError } = await adminClient
    .from("pending_claims")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", claim.id);
  if (consumeError) {
    throw new ClaimError(
      "failed",
      `Failed to consume pending claim: ${consumeError.message}`,
    );
  }

  return { slug, consentAcceptedAt: claim.consent_accepted_at };
}

function isUniqueViolation(code: string | undefined): boolean {
  return code === "23505";
}
