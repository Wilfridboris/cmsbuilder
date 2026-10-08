import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PendingClaimRow, SchemaDefinition } from "@/types/db";
import { ensureUniqueSlug } from "@/lib/claim/slug";
import { SYSTEM_ACTOR_ID } from "@/lib/data/mutate";

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

/**
 * The no-card free-trial window (Story 7.1, FR29). The trial clock starts at
 * claim finalization — `trial_expires_at` = claim time + this — and is stamped
 * exactly once, so a retry / consumed-token re-entry never resets it.
 */
export const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days.

export type CreatePendingClaimInput = {
  /** The anonymous session org id (resolved from the signed cookie). */
  sessionOrgId: string;
  email: string;
  /**
   * The business name the owner typed (Story 15.1). Written to
   * `organizations.name` on the session org at claim-submit so it carries across
   * the magic-link round trip with no new column; `finalizeClaim` no longer
   * derives or overwrites the name. Preserved verbatim (exact casing /
   * punctuation).
   */
  businessName: string;
  /** The visitor's OVERRIDDEN schema (1.7 hide/rename applied). */
  schema: SchemaDefinition;
  /** When the visitor accepted the privacy consent. */
  consentAt: Date;
  /** The privacy/terms version the visitor accepted. */
  policyVersion: string;
  /**
   * The name-derived, reserved-word-guarded base slug (Story 15.1); global
   * uniqueness is resolved at finalize via `ensureUniqueSlug`.
   */
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

  // Set the business name as the org's first-class display name on the SESSION
  // org now (Story 15.1). Because finalizeClaim promotes this same org
  // (session_org_id), the name carries across the magic-link round trip with no
  // new column, and finalize no longer derives/overwrites it. The exact typed
  // casing/punctuation is preserved (never a slug round-trip).
  const { error: nameError } = await adminClient
    .from("organizations")
    .update({ name: input.businessName, updated_at: new Date().toISOString() })
    .eq("id", input.sessionOrgId);
  if (nameError) {
    throw new ClaimError(
      "failed",
      `Failed to set org display name: ${nameError.message}`,
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
 *   4. Resolve the globally-unique slug from the name-derived base.
 *   5. Delegate the atomic promotion to the `finalize_claim` Postgres RPC (one
 *      transaction: membership insert + slug set + trial-once + synthetic-record
 *      soft-delete + token consume), so a mid-sequence fault can never leave a
 *      half-provisioned org. The display name is NOT touched here — it was set
 *      from the typed business name at claim-submit (Story 15.1).
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

  // Resolve the globally-unique slug from the name-derived, reserved-guarded base
  // (Story 15.1). `ensureUniqueSlug` excludes this org's own id so a not-yet-
  // consumed retry that already set the slug does not treat its own row as a
  // collision and keeps landing on the same value. The display name is NOT
  // derived here: it was set from the typed business name at claim-submit and is
  // authoritative.
  const slug = await ensureUniqueSlug(adminClient, claim.slug_base, orgId);
  const trialExpiresAt = new Date(Date.now() + TRIAL_DURATION_MS).toISOString();

  // Promote the org ATOMICALLY (Story 15.1): one Postgres transaction performs
  // the membership insert, slug set, trial-once, synthetic-record soft-delete,
  // and token consume. A mid-sequence fault rolls the whole thing back, so the
  // org is never left half-provisioned, and every write keeps its prior
  // idempotency guard (unique-index on membership, trial_expires_at IS NULL,
  // deleted_at IS NULL, consumed_at IS NULL) inside the function.
  const { error: rpcError } = await adminClient.rpc("finalize_claim", {
    p_claim_id: claim.id,
    p_org: orgId,
    p_user: userId,
    p_slug: slug,
    p_actor: SYSTEM_ACTOR_ID,
    p_trial_until: trialExpiresAt,
  });
  if (rpcError) {
    throw new ClaimError(
      "failed",
      `Failed to finalize claim: ${rpcError.message}`,
    );
  }

  return { slug, consentAcceptedAt: claim.consent_accepted_at };
}

/**
 * Finalize the claim for a verified email, resolving the token server-side.
 *
 * The `token_hash`/`verifyOtp` confirm flow (`/auth/confirm`) carries NO
 * `claim_token` — claim vs login is decided by the verified email. This resolves
 * the most-recent UNCONSUMED `pending_claims` row for the email and delegates to
 * the token-keyed `finalizeClaim` core (so all the idempotency / bootstrap
 * guarantees — including the expiry check — are shared, single-sourced). No such
 * row (none was ever created, or every one is already consumed) → `not-found`.
 *
 * Expiry is deliberately NOT filtered here: it is delegated to `finalizeClaim`,
 * which raises `ClaimError('expired')` for an expired most-recent claim so the
 * confirm route lands the claim re-request surface (`/?claim=expired`) rather
 * than collapsing an expired claim into `not-found` → `/login?login=no-org`
 * (frozen I/O matrix). A row selected here that is expired therefore surfaces as
 * `expired`, not `not-found`.
 *
 * Email match is case-insensitive: Supabase normalizes verified emails to
 * lowercase, and the pending claim stores the raw submitted casing, so an
 * exact-equality match could miss a legitimate claim.
 */
export async function finalizeClaimByEmail(
  email: string,
  userId: string,
  adminClient: SupabaseClient,
): Promise<FinalizeClaimResult> {
  const normalized = email.trim().toLowerCase();

  const { data: rows, error: lookupError } = await adminClient
    .from("pending_claims")
    .select("token, email, expires_at, consumed_at")
    .is("consumed_at", null)
    .order("created_at", { ascending: false });

  if (lookupError) {
    throw new ClaimError(
      "failed",
      `Failed to resolve pending claim by email: ${lookupError.message}`,
    );
  }

  // Most-recent UNCONSUMED claim for this email (rows arrive ordered created_at
  // DESC). Expiry is NOT filtered here — `finalizeClaim` owns that decision so an
  // expired claim surfaces as `expired`, not `not-found` (see the doc comment).
  const candidates = (rows ?? []) as Array<
    Pick<PendingClaimRow, "token" | "email" | "expires_at" | "consumed_at">
  >;
  const match = candidates.find(
    (row) => (row.email ?? "").trim().toLowerCase() === normalized,
  );

  if (!match) {
    throw new ClaimError(
      "not-found",
      "No unconsumed pending claim for this email.",
    );
  }

  return finalizeClaim({ token: match.token, userId, adminClient });
}
