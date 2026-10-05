import { renderToStaticMarkup } from "react-dom/server";
import { useLocale } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `next/navigation`'s `useRouter` needs an app-router context the node test env
// lacks; stub it to a no-op `refresh` so the provider renders standalone.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import {
  LocaleProvider,
  persistLocale,
  readStoredLocale,
  resolveMountReconcile,
} from "@/components/i18n/LocaleProvider";
import { LocaleToggle } from "@/components/i18n/LocaleToggle";

/**
 * I/O-matrix coverage for the Story 8.1 instant EN/FR toggle engine.
 *
 * The repo test env is `node` (no jsdom, no React effect/interaction renderer),
 * so the no-reload swap and effect-driven mount reconciliation are verified two
 * ways here and finished in manual review (Playwright):
 *   1. the persistence + reconciliation DECISION logic is extracted into pure,
 *      exported helpers (`persistLocale`, `readStoredLocale`,
 *      `resolveMountReconcile`) and exercised directly against a stubbed
 *      `window`/`document` — this is where the matrix rows (switch writes
 *      localStorage + cookie, return visit reconciles once, no-preference falls
 *      back to EN) are actually asserted;
 *   2. a `renderToStaticMarkup` smoke test confirms the provider drives
 *      next-intl's `useLocale()` from its `initialLocale` prop (the active
 *      catalog the toggle reads), independent of any cookie.
 *
 * Note: the spec names this file `src/components/i18n/LocaleProvider.test.tsx`,
 * but the project's Vitest config only runs tests under the `tests/` tree (all
 * unit tests live under `tests/unit/`), so it is placed here so it actually runs.
 */

// --- Minimal localStorage + document stubs for the node env --------------------

function createMemoryStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null =>
      Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
    setItem: (key: string, value: string): void => {
      store[key] = value;
    },
    removeItem: (key: string): void => {
      delete store[key];
    },
    clear: (): void => {
      for (const key of Object.keys(store)) delete store[key];
    },
  };
}

const COOKIE = "NEXT_LOCALE";

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: createMemoryStorage() });
  vi.stubGlobal("document", {
    cookie: "",
    documentElement: { lang: "en" },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readStoredLocale", () => {
  it("returns null when no preference is stored (falls back to EN upstream)", () => {
    expect(readStoredLocale()).toBeNull();
  });

  it("returns the stored locale when a valid one is present", () => {
    window.localStorage.setItem(COOKIE, "fr");
    expect(readStoredLocale()).toBe("fr");
  });

  it("ignores a junk stored value", () => {
    window.localStorage.setItem(COOKIE, "xx");
    expect(readStoredLocale()).toBeNull();
  });
});

describe("persistLocale (switch writes both, no backend)", () => {
  it("writes localStorage, mirrors the NEXT_LOCALE cookie, and sets <html lang>", () => {
    persistLocale("fr");

    expect(window.localStorage.getItem(COOKIE)).toBe("fr");
    expect(document.cookie).toContain(`${COOKIE}=fr`);
    expect(document.cookie).toContain("path=/");
    expect(document.cookie).toMatch(/max-age=\d+/);
    expect(document.cookie.toLowerCase()).toContain("samesite=lax");
    expect(document.documentElement.lang).toBe("fr");
  });
});

describe("resolveMountReconcile (return visit reconciles once)", () => {
  it("applies the stored locale when it differs from the active locale", () => {
    // Cookie cleared → server painted EN, but localStorage still says FR.
    expect(resolveMountReconcile("en", "fr")).toBe("fr");
  });

  it("does nothing when the stored locale already matches (no redundant refresh)", () => {
    expect(resolveMountReconcile("fr", "fr")).toBeNull();
  });

  it("does nothing when there is no stored preference", () => {
    expect(resolveMountReconcile("en", null)).toBeNull();
  });
});

describe("LocaleProvider initial render", () => {
  // A probe that surfaces whatever locale next-intl resolves from the provider.
  function LocaleProbe() {
    return <span data-locale={useLocale()} />;
  }

  it("drives next-intl useLocale() from initialLocale=fr", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="fr">
        <LocaleProbe />
      </LocaleProvider>,
    );
    expect(html).toContain('data-locale="fr"');
  });

  it("drives next-intl useLocale() from initialLocale=en", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="en">
        <LocaleProbe />
      </LocaleProvider>,
    );
    expect(html).toContain('data-locale="en"');
  });
});

describe("LocaleToggle render (active segment / label wiring)", () => {
  it("marks the active (FR) segment pressed, the inactive (EN) one not, and omits the active segment's 'switch to' label", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="fr">
        <LocaleToggle />
      </LocaleProvider>,
    );

    // Exactly one segment is pressed (FR), one is not (EN).
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');

    // Both visible locale labels render from the catalog.
    expect(html).toContain("EN");
    expect(html).toContain("FR");

    // The inactive (EN) segment carries its sr-only "switch to" label; the
    // active (FR) segment must NOT — an invitation to switch to the current
    // language would contradict aria-pressed="true".
    expect(html).toContain("Passer en anglais"); // switchTo.en, on inactive EN
    expect(html).not.toContain("Passer en français"); // switchTo.fr, suppressed on active FR
  });
});
