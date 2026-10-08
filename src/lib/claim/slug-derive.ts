import { kebabCase } from "@/lib/utils";

/**
 * Pure, client-safe slug derivation + reserved-word guard (Story 15.1).
 *
 * These helpers are isolated from `src/lib/claim/slug.ts` (which is
 * `server-only` because it also exports `ensureUniqueSlug`, the service-role
 * uniqueness check) so the claim modal can compute the best-effort slug PREVIEW
 * in the browser without pulling the admin client into the client bundle. The
 * server module re-exports these so there is still a single source of truth.
 */

/** Kebab-case a single segment through the one shared normalizer. */
function kebab(input: string): string {
  return kebabCase(input);
}

/** A safe, non-empty base used when the derived slug would be empty. */
export const SLUG_FALLBACK = "app";

/**
 * Top-level route labels a slug must never shadow. The slug keys `/{slug}`
 * tenant routes AND the public intake-form URLs, so a slug equal to a system
 * route folder (or `/api/*`) would collide with a real page. Keep in sync with
 * the top-level folders under `src/app` and the API namespace.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "login",
  "auth",
  "forms",
  "generate",
  "demo",
  "i",
  "api",
  // The PWA start_url route (src/app/home/route.ts): a business named "Home"
  // slugifies to `home` and would otherwise shadow it.
  "home",
  // Public legal + first-run surfaces that also live at the root.
  "privacy",
  "terms",
]);

/** Suffix appended to a reserved base so it no longer shadows a system route. */
const RESERVED_SUFFIX = "app";

/**
 * Derive the base slug from the business name. Kebab-cases the name through the
 * shared normalizer so punctuation and accents degrade predictably
 * (`"Joe's Plumbing"` -> `joes-plumbing`). A name that normalizes to nothing
 * degrades to the safe constant rather than an empty slug. The result is NOT yet
 * reserved-word-guarded; callers pipe it through {@link guardReservedSlug}.
 */
export function deriveSlugFromName(name: string): string {
  // Drop apostrophes/quotes FIRST so a possessive reads naturally
  // (`"Joe's Plumbing"` -> `joes-plumbing`, not `joe-s-plumbing`). The shared
  // normalizer would otherwise treat them as word separators.
  const base = kebab((name ?? "").replace(/['’"]/g, ""));
  return base.length > 0 ? base : SLUG_FALLBACK;
}

/**
 * Guard a derived slug base against reserved top-level routes and the empty /
 * degenerate case. An empty base becomes the fallback; a base matching a
 * {@link RESERVED_SLUGS} entry is suffixed (e.g. `login` -> `login-app`). A
 * normal business name passes through untouched. Does NOT resolve global
 * uniqueness (`ensureUniqueSlug` owns that at finalize).
 */
export function guardReservedSlug(base: string): string {
  const normalized = kebab(base ?? "");
  if (normalized.length === 0) {
    return SLUG_FALLBACK;
  }
  if (RESERVED_SLUGS.has(normalized)) {
    return `${normalized}-${RESERVED_SUFFIX}`;
  }
  return normalized;
}
