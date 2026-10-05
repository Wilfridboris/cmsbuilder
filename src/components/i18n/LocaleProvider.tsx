"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";

import {
  defaultLocale,
  isLocale,
  LOCALE_COOKIE,
  type Locale,
} from "@/lib/i18n/config";
import en from "@/lib/i18n/en.json";
import fr from "@/lib/i18n/fr.json";

/**
 * Client-driven locale provider (Story 8.1) — the no-reload instant-swap engine.
 *
 * next-intl v4 in cookie mode exposes no client `setLocale`. We realize an
 * instant, backend-free switch by holding BOTH pre-loaded catalogs and keeping
 * the active `locale` in React state. A switch is a local state update, so every
 * client-rendered surface re-renders in the new language immediately (<300ms, no
 * network) — client state (open dialogs, form input, the query cache) survives
 * because nothing unmounts.
 *
 * `setLocale(next)` additionally:
 *   - writes `localStorage` (canonical) and mirrors the `NEXT_LOCALE` cookie via
 *     `document.cookie` so the next visit's SSR first paint matches — no API/DB;
 *   - sets `document.documentElement.lang`;
 *   - fires `router.refresh()`, a SOFT RSC refresh (NOT a page reload) that
 *     reconciles the ~18 server-rendered (`getTranslations`) surfaces (nav, server
 *     pages). Client state is preserved across the refresh.
 *
 * First paint / `<html lang>` come from the server cookie read (`request.ts`), so
 * there is no FOUC. On mount we reconcile from `localStorage` ONLY when it
 * disagrees with the active locale (e.g. the cookie was cleared) — applying the
 * stored choice once and refreshing so server chrome follows.
 */

const catalogs = { en, fr } as const;

/** One year, in seconds — matches a durable language preference. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const STORAGE_KEY = LOCALE_COOKIE;

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Read the persisted locale from `localStorage` (canonical). SSR-safe. Exported
 * for unit coverage of the "no stored preference → null" matrix row.
 */
export function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    // localStorage can throw (privacy mode, disabled storage); treat as absent.
    return null;
  }
}

/**
 * Persist the chosen locale to `localStorage` + the `NEXT_LOCALE` cookie and set
 * `<html lang>`. Exported for unit coverage of the "switch writes both" matrix
 * row. No backend call is made.
 */
export function persistLocale(next: Locale): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Non-fatal: the cookie mirror below still restores the choice next visit.
  }
  // Mirror to the cookie the server reads for SSR first paint. Lax is correct
  // for a same-site UI preference; no backend call is made.
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
  document.documentElement.lang = next;
}

/**
 * Decide whether the mount reconciliation should apply a stored locale: only
 * when a valid stored preference exists AND it disagrees with the active locale
 * (e.g. the cookie was cleared). Pure — exported so the "return visit reconciles
 * once" matrix row is unit-testable without a DOM/effect runtime.
 */
export function resolveMountReconcile(
  active: Locale,
  stored: Locale | null,
): Locale | null {
  if (stored && stored !== active) {
    return stored;
  }
  return null;
}

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(() =>
    isLocale(initialLocale) ? initialLocale : defaultLocale,
  );

  const setLocale = useCallback(
    (next: Locale) => {
      if (!isLocale(next) || next === locale) {
        return;
      }
      // Instant: local state swaps the active catalog with no network.
      setLocaleState(next);
      // Persist + mirror so the next SSR first paint matches.
      persistLocale(next);
      // Soft RSC refresh so server-rendered chrome (nav, server pages) follows.
      // This is NOT a full reload; client state is preserved.
      router.refresh();
    },
    [locale, router],
  );

  // Reconcile from the canonical `localStorage` on mount. The server already
  // painted from the cookie, so this only acts when the two disagree (e.g. the
  // cookie was cleared but the stored preference remains) — applied once by
  // dispatching the same `setLocale` used by the toggle (state swap + persist +
  // soft refresh). Reading the client-only store can only happen after mount, so
  // this sync-from-external-source lives in an effect by necessity.
  const reconciled = useRef(false);
  useEffect(() => {
    if (reconciled.current) {
      return;
    }
    reconciled.current = true;
    const next = resolveMountReconcile(locale, readStoredLocale());
    if (next) {
      // Necessary sync-from-external-store: the canonical `localStorage` is
      // client-only and unreadable during render/SSR, so the one-time
      // reconciliation can only run after mount. Guarded by `reconciled` so it
      // fires at most once and never cascades.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocale(next);
    }
    // Intentionally run once on mount; `locale`/`setLocale` are read fresh inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <NextIntlClientProvider locale={locale} messages={catalogs[locale]}>
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}

/**
 * Access the client locale context. Exposes `setLocale` (the instant swap) and
 * the active `locale`. Must be called under `<LocaleProvider>`.
 */
export function useLocaleSwitcher(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (ctx === null) {
    throw new Error("useLocaleSwitcher must be used within <LocaleProvider>");
  }
  return ctx;
}
