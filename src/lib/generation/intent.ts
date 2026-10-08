import { z } from "zod";

import { locales, type Locale } from "@/lib/i18n/config";

/**
 * The typed capture contract + client-side persistence seam for the guided
 * "Mad Libs" prompt intake (Story 1.3).
 *
 * This is the ONLY thing Story 1.3 produces: an anonymous visitor's structured
 * business description, validated by a shared Zod schema and persisted to the
 * anonymous client-side session (sessionStorage). Story 1.4's `/api/generate`
 * reads this payload — nothing here touches the database, Supabase, or the LLM.
 */

/** Stable enum keys for the fixed trade-type options (never translated). */
export const TRADE_KEYS = [
  "hvac",
  "plumbing",
  "roofing",
  "snow_removal",
  "landscaping",
  "electrical",
  "general_contracting",
  "other",
] as const;

/** A trade-type enum key. Labels are translated via next-intl, keyed by this. */
export type TradeType = (typeof TRADE_KEYS)[number];

/**
 * The captured payload shape. `tradeType` (key) and `city` are preserved
 * verbatim to seed Story 1.4's Ontario localization; `submittedLocale` records
 * the UI locale at submit time (NOT a language detection — 1.4 detects language
 * from the prompt text itself).
 */
export type GenerationIntent = {
  /**
   * The business name the owner typed on the landing prompt (Story 15.1). This
   * becomes the org's first-class display name (`organizations.name`) and the
   * basis for the derived dashboard slug. Preserved verbatim (capitalization /
   * punctuation) — never round-tripped through a slug.
   */
  businessName: string;
  tradeType: TradeType;
  city: string;
  /**
   * The free-form business description (Story 15.1, formerly `whatYouTrack`).
   * Drives the OUTPUT language (FR35) and the inferred schema.
   */
  description: string;
  /**
   * Optional explicit list of things the owner wants to track (Story 15.1).
   * Blended into generation as an additional hint the model honors alongside
   * inference. Empty / absent when the owner did not add any.
   */
  explicitItems?: string;
  submittedLocale: Locale;
};

/** Field length bounds — mirrored by the I/O matrix and unit tests. */
export const BUSINESS_NAME_MIN = 1;
export const BUSINESS_NAME_MAX = 80;
export const CITY_MAX = 80;
export const DESCRIPTION_MIN = 3;
export const DESCRIPTION_MAX = 280;
export const EXPLICIT_ITEMS_MAX = 280;

/**
 * Build the prompt-intent validation schema, injecting a translation resolver
 * so error text lives in the i18n catalogs (not the schema). The same factory
 * powers the RHF resolver (called with next-intl's `t`) and the unit tests
 * (called with an identity resolver `(k) => k`).
 *
 * Validation is submit-only at the form level (RHF `mode: 'onSubmit'`); the
 * schema itself trims `city`/`whatYouTrack` so a whitespace-only value is
 * treated as empty.
 */
export const createPromptIntentSchema = (t: (key: string) => string) =>
  z.object({
    businessName: z
      .string()
      .trim()
      .min(BUSINESS_NAME_MIN, t("validation.businessNameRequired"))
      .max(BUSINESS_NAME_MAX, t("validation.businessNameTooLong")),
    tradeType: z.enum(TRADE_KEYS, { message: t("validation.tradeRequired") }),
    city: z
      .string()
      .trim()
      .min(1, t("validation.cityRequired"))
      .max(CITY_MAX, t("validation.cityTooLong")),
    description: z
      .string()
      .trim()
      .min(DESCRIPTION_MIN, t("validation.descriptionRequired"))
      .max(DESCRIPTION_MAX, t("validation.descriptionTooLong")),
    // Optional explicit-items field: empty is allowed; only the max bound
    // applies. Trimmed so a whitespace-only value is treated as empty.
    explicitItems: z
      .string()
      .trim()
      .max(EXPLICIT_ITEMS_MAX, t("validation.explicitItemsTooLong"))
      .optional(),
  });

/** The validated form values (before `submittedLocale` is attached). */
export type PromptIntentInput = z.infer<ReturnType<typeof createPromptIntentSchema>>;

/** sessionStorage key holding the captured intent — the seam Story 1.4 reads. */
export const INTENT_STORAGE_KEY = "scheza.generation.intent";

/**
 * Minimal storage contract satisfied by `sessionStorage`. Injectable so unit
 * tests can pass an in-memory fake (and so a server render can pass nothing).
 */
export type IntentStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Resolve the storage to use, defaulting to `window.sessionStorage` in the
 * browser. Returns `null` when no storage is available (e.g. SSR) so callers
 * degrade gracefully rather than throwing.
 */
function resolveStorage(storage?: IntentStorage): IntentStorage | null {
  if (storage) {
    return storage;
  }
  if (typeof window !== "undefined" && window.sessionStorage) {
    return window.sessionStorage;
  }
  return null;
}

/**
 * A revalidating parser used by `readIntent` — a locale-agnostic mirror of the
 * capture schema. Uses `TRADE_KEYS`/length bounds directly (no translation
 * resolver needed: on read we only care whether the stored shape is valid).
 */
const storedIntentSchema = z.object({
  businessName: z.string().trim().min(BUSINESS_NAME_MIN).max(BUSINESS_NAME_MAX),
  tradeType: z.enum(TRADE_KEYS),
  city: z.string().trim().min(1).max(CITY_MAX),
  description: z.string().trim().min(DESCRIPTION_MIN).max(DESCRIPTION_MAX),
  explicitItems: z.string().trim().max(EXPLICIT_ITEMS_MAX).optional(),
  submittedLocale: z.enum(locales),
});

/**
 * Server-safe body schema for `POST /api/generate` (Story 1.4). It is the exact
 * locale-agnostic mirror of `storedIntentSchema` (the shape the client persists
 * and POSTs) — reused rather than redefined so the capture and the route can
 * never drift. Locale-specific error messages are irrelevant server-side: the
 * route only cares whether the posted shape is valid, and returns a single
 * translated message on failure.
 */
export const generationIntentBodySchema = storedIntentSchema;

/**
 * Persist a captured intent to the anonymous session. No-op (returns silently)
 * when no storage is available. Serialization failures are swallowed — capture
 * must never throw into the submit handler.
 */
export function saveIntent(
  intent: GenerationIntent,
  storage?: IntentStorage,
): void {
  const store = resolveStorage(storage);
  if (!store) {
    return;
  }
  try {
    store.setItem(INTENT_STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // Storage may be full or unavailable; capture is best-effort.
  }
}

/**
 * Re-read + re-validate the persisted intent. Returns `null` for absent or
 * corrupt storage (bad JSON, wrong shape, out-of-range values) — never throws.
 * This is the seam Story 1.4's `/api/generate` consumes.
 */
export function readIntent(storage?: IntentStorage): GenerationIntent | null {
  const store = resolveStorage(storage);
  if (!store) {
    return null;
  }

  let raw: string | null;
  try {
    raw = store.getItem(INTENT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = storedIntentSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
