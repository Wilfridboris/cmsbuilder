/**
 * next-intl routing / locale-detection configuration.
 *
 * Story 1.1 scaffold: establishes the i18n seam. The MVP uses a client-side
 * bundle swap with no URL locale prefix (per architecture.md — EN/FR toggle,
 * no page reload, choice persisted in a cookie). The active locale is resolved
 * from the `NEXT_LOCALE` cookie, defaulting to English.
 */

export const locales = ['en', 'fr'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

/** Cookie that stores the visitor's chosen locale (read by the request config). */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export function isLocale(value: string | undefined | null): value is Locale {
  return value != null && (locales as readonly string[]).includes(value);
}
