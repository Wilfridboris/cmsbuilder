import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, isLocale, LOCALE_COOKIE } from '@/lib/i18n/config';
import en from '@/lib/i18n/en.json';
import fr from '@/lib/i18n/fr.json';

const catalogs = { en, fr } as const;

/**
 * Per-request next-intl configuration. Resolves the active locale from the
 * NEXT_LOCALE cookie (set by the language toggle in a later story) and loads
 * the matching message catalog. No URL locale prefix is used.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : defaultLocale;

  return {
    locale,
    messages: catalogs[locale],
  };
});
