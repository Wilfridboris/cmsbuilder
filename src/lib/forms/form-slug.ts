import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { kebabCase } from "@/lib/utils";

/**
 * Form slug derivation + org-scoped uniqueness (Epic 14, Story 14.1).
 *
 * A form's public URL segment is kebab-cased from its title and UNIQUE within the org.
 * `deriveFormSlug` produces the stable base (with a safe fallback for a title that has
 * no Latin alphanumerics — non-Latin-only); `ensureUniqueFormSlug` appends `-2`/`-3`…
 * on a collision WITHIN the same org, reading the `forms` table under the caller's
 * RLS-scoped client (never the admin client — that distinguishes this from
 * `claim/slug.ts`, which uniques `organizations` via the service-role bootstrap client).
 *
 * The DB `UNIQUE (organization_id, slug)` constraint is the authoritative backstop:
 * this pre-check races a concurrent create, so the mutator also catches a 23505 and
 * retries with the next suffix.
 */

/** A safe, non-empty base used when a title yields no kebab-able characters. */
const FORM_SLUG_FALLBACK = "form";

/**
 * Derive the base slug from a form title: kebab-case it, degrading a purely non-Latin
 * (or empty) result to the safe `form` constant rather than an empty slug. The result
 * is still subject to org-uniqueing by {@link ensureUniqueFormSlug}.
 */
export function deriveFormSlug(title: string): string {
  const base = kebabCase(title ?? "");
  return base.length > 0 ? base : FORM_SLUG_FALLBACK;
}

/**
 * Return `base` if free within `orgId`, else the first `base-N` (N ≥ 2) that is not
 * already a `forms.slug` in that org. `excludeFormId` excludes the form being edited so
 * a slug PATCH that keeps (or re-normalizes to) the form's own slug is not treated as a
 * self-collision. Reads under the caller's RLS-scoped client, scoped by
 * `organization_id` (RLS already hides other orgs; the explicit `eq` is defense in
 * depth and lets the query use the org index).
 */
export async function ensureUniqueFormSlug(
  client: SupabaseClient,
  orgId: string,
  base: string,
  excludeFormId?: string,
): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;

    let query = client
      .from("forms")
      .select("id")
      .eq("organization_id", orgId)
      .eq("slug", candidate);
    if (excludeFormId) {
      query = query.neq("id", excludeFormId);
    }

    const { data, error } = await query.limit(1).maybeSingle();
    if (error) {
      throw new Error(`Failed to check form slug availability: ${error.message}`);
    }
    if (!data) {
      return candidate;
    }
  }
}
