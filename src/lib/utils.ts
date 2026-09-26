import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, de-duplicating Tailwind utilities. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Deterministic, non-cryptographic 32-bit hash (FNV-1a) of a string, rendered
 * as lowercase base-36. Used to derive a stable synthetic key when a name has
 * no Latin fold and would otherwise normalize to empty. Pure and dependency-free
 * so the same input always yields the same key (no `Math.random`/timestamp).
 */
function stableHash(input: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // FNV prime multiply, kept in 32-bit range via Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  // `>>> 0` coerces to an unsigned 32-bit int before base-36 rendering.
  return (hash >>> 0).toString(36);
}

/**
 * Normalize a user-provided table/field name into a safe `snake_case` key
 * before it is persisted as a `table_key` or field `key`.
 *
 * Story 1.1 provided the original ASCII-only helper. Story 2.6 (retro F8) folds
 * diacritics to their ASCII base *before* stripping, so Latin-accented names —
 * the French-generation path the epic commits to (FR35) — survive as readable
 * keys instead of being mangled or emptied (`numéro`→`numero`, `coût`→`cout`,
 * `région`→`region`) and instead of collapsing into false duplicate collisions.
 *
 * ASCII inputs normalize **identically to before** (regression-guarded): the
 * NFD-decompose + combining-mark strip is a no-op on ASCII, and the trailing
 * pipeline is unchanged.
 *
 * A name with no Latin fold (Cyrillic, Arabic, CJK, …) can still normalize to
 * empty; rather than reject the schema on an un-foldable key, we return a
 * deterministic synthetic key (`field_<stable-hash-of-original>`). It is stable,
 * `[a-z0-9_]`, and collision-resistant across distinct originals; the
 * human-readable original always survives untouched in the `label`.
 *
 * The Schema Validator, provisioner, and mutation layer consume this helper, so
 * behavior must stay deterministic. (The validator keeps its empty-key check as
 * defense-in-depth, but this function no longer returns empty.)
 */
export function normalizeTableName(input: string): string {
  const key = input
    .trim()
    .normalize("NFD") // decompose accented chars into base + combining mark
    .replace(/[\u0300-\u036f]/g, "") // drop the combining diacritical marks (U+0300–U+036F)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (key) {
    return key;
  }

  // No Latin fold survived (non-Latin script or punctuation-only input). Derive
  // a deterministic synthetic key from the original so the schema never rejects
  // on emptiness; hash the trimmed original for stability.
  return `field_${stableHash(input.trim())}`;
}
