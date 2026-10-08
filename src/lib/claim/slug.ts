import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Pure, client-safe derivation + reserved-word guard live in a sibling module so
// the claim modal can compute the slug preview in the browser without pulling in
// this server-only module. Re-exported here so server callers keep one import.
export {
  SLUG_FALLBACK,
  RESERVED_SLUGS,
  deriveSlugFromName,
  guardReservedSlug,
} from "@/lib/claim/slug-derive";

/**
 * Slug provisioning for the claim flow (Story 2.1, name-based since 15.1).
 *
 * The dashboard slug is derived from the business name the owner typed
 * (`deriveSlugFromName`), passed through the reserved-word guard
 * (`guardReservedSlug`, both re-exported from the client-safe `slug-derive`
 * module above), then resolved to a globally-unique value by `ensureUniqueSlug`
 * at finalize (appends `-2`, `-3`… on an `organizations.slug` collision). This
 * module owns only the service-role uniqueness check; the pure derivation is
 * client-safe so the claim modal can preview it.
 */

/**
 * Return `base` if free, else the first `base-N` (N ≥ 2) that is not already an
 * `organizations.slug`. Excludes the claiming org's own id so a re-run (the
 * idempotent finalize path) that already set the slug does not treat its own row
 * as a collision. Reads via the service-role admin client (bootstrap-only).
 */
export async function ensureUniqueSlug(
  adminClient: SupabaseClient,
  base: string,
  excludeOrgId?: string,
): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;

    let query = adminClient
      .from("organizations")
      .select("id")
      .eq("slug", candidate);
    if (excludeOrgId) {
      query = query.neq("id", excludeOrgId);
    }

    const { data, error } = await query.limit(1).maybeSingle();
    if (error) {
      throw new Error(`Failed to check slug availability: ${error.message}`);
    }
    if (!data) {
      return candidate;
    }
  }
}
