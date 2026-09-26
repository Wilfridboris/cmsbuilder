import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { MemberRole } from "@/types/db";

/**
 * Returning-user org resolution (Story 2.2).
 *
 * A returning user who claimed in 2.1 has exactly one `org_members` row (admin);
 * an invited member (2.3) also joins a single org. Genuine multi-org membership
 * is not reachable until later, so login resolves to the MOST-RECENT membership
 * (`org_members.created_at DESC`) and lands the user there. A picker is deferred
 * (see the spec's "One org, no picker" design note); centralizing the resolution
 * here gives a future chooser a single call site to change.
 *
 * Reuses the `readOrgSlug` read pattern from `src/lib/claim/claim.ts`: two narrow
 * reads under the service-role client so the callback can resolve the landing
 * slug independent of RLS (the user's session is still what proves identity;
 * membership was already validated by requiring a magic link to their email).
 */
export type ResolvedOrg = { slug: string };

/**
 * Resolve the user's primary org slug for post-login landing.
 *
 * Returns `{ slug }` for the most-recent membership, or `null` when the user has
 * no membership (a valid session with no org — the callback routes this to the
 * translated no-org status, never a crash).
 */
export async function resolveUserPrimaryOrgSlug(
  userId: string,
  adminClient: SupabaseClient,
): Promise<ResolvedOrg | null> {
  // Most-recent membership first. A returning user has one row today; ordering
  // makes the single-org choice deterministic and future-proofs the picker seam.
  const { data: membership, error: memberError } = await adminClient
    .from("org_members")
    .select("organization_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (memberError) {
    throw new Error(`Failed to resolve user membership: ${memberError.message}`);
  }
  if (!membership) {
    return null;
  }

  const orgId = (membership as { organization_id: string }).organization_id;

  const { data: org, error: orgError } = await adminClient
    .from("organizations")
    .select("slug")
    .eq("id", orgId)
    .maybeSingle();

  if (orgError) {
    throw new Error(`Failed to resolve org slug: ${orgError.message}`);
  }

  const slug = (org as { slug: string } | null)?.slug ?? null;
  if (!slug) {
    return null;
  }

  return { slug };
}

/**
 * The caller's membership: the org they act in plus their role. Story 2.3 uses
 * this to admin-gate the invite route and the Settings page.
 */
export type ResolvedMembership = { orgId: string; slug: string; role: MemberRole };

/**
 * Resolve a user's org membership (org id + slug + role) for admin-gating.
 *
 * Sibling of `resolveUserPrimaryOrgSlug`: same most-recent-membership choice and
 * the same two-read pattern (org_members → organizations) under the service-role
 * client, but it also carries the authoritative `org_members.role` so the invite
 * route and the Settings page can reject a non-admin server-side (never UI-only).
 *
 * Returns `null` when the user has no membership (or the resolved org has no
 * slug), so callers can redirect / 403 rather than crash.
 */
export async function resolveUserOrgMembership(
  userId: string,
  adminClient: SupabaseClient,
): Promise<ResolvedMembership | null> {
  const { data: membership, error: memberError } = await adminClient
    .from("org_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (memberError) {
    throw new Error(`Failed to resolve user membership: ${memberError.message}`);
  }
  if (!membership) {
    return null;
  }

  const { organization_id: orgId, role } = membership as {
    organization_id: string;
    role: MemberRole;
  };

  const { data: org, error: orgError } = await adminClient
    .from("organizations")
    .select("slug")
    .eq("id", orgId)
    .maybeSingle();

  if (orgError) {
    throw new Error(`Failed to resolve org slug: ${orgError.message}`);
  }

  const slug = (org as { slug: string } | null)?.slug ?? null;
  if (!slug) {
    return null;
  }

  return { orgId, slug, role };
}
