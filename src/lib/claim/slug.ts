import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Slug provisioning for the claim flow (Story 2.1).
 *
 * The public URL is AUTO-DERIVED from the generation intent (trade + city) — the
 * visitor never chooses it in this story. `deriveSlug` produces a stable,
 * kebab-case base (e.g. `plumbing-laval`); `ensureUniqueSlug` appends `-2`,
 * `-3`… on an `organizations.slug` collision so every claimed org lands on a
 * unique, human-readable URL.
 */

/**
 * Kebab-case a single segment: lowercase, strip diacritics, collapse any run of
 * non-alphanumerics to a single hyphen, and trim leading/trailing hyphens.
 * Returns "" for input with no usable characters (caller handles the fallback).
 */
function kebab(input: string): string {
  return input
    .normalize("NFKD")
    // Drop combining marks left by NFKD (é → e).
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A safe, non-empty base used when trade + city yield nothing usable. */
const SLUG_FALLBACK = "app";

/**
 * Derive the base slug from the generation intent. Uses the stable trade-type
 * key (never a translated label, so the slug is locale-stable) plus the city.
 * A purely non-Latin / empty result degrades to a safe constant rather than an
 * empty slug.
 */
export function deriveSlug(intent: { tradeType: string; city: string }): string {
  const base = [intent.tradeType, intent.city]
    .map((part) => kebab(part ?? ""))
    .filter((part) => part.length > 0)
    .join("-");
  return base.length > 0 ? base : SLUG_FALLBACK;
}

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
