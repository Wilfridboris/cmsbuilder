import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PWA_DISMISSED_KEY,
  PWA_INSTALLED_KEY,
  persistInstallDecision,
  readInstallSuppressed,
} from "@/components/pwa/InstallPrompt";

/**
 * I/O-matrix coverage for the Story 8.2 PWA install prompt (spec-8-2).
 *
 * The repo test env is `node` (no jsdom, no React effect/event runtime), so — as
 * with `locale-provider.test.tsx` — the persistence + gating DECISION logic is
 * extracted into pure, exported helpers (`readInstallSuppressed`,
 * `persistInstallDecision`) and asserted directly against a stubbed `window`.
 * The event wiring (`beforeinstallprompt` capture, `prompt()` replay, the banner
 * render) is finished in manual review (Playwright), per the spec's Verification
 * section. These unit tests cover the matrix rows that decide WHETHER the banner
 * shows and WHICH flag each outcome persists.
 */

// --- Minimal localStorage stub for the node env (mirrors locale-provider) ------

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

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: createMemoryStorage() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readInstallSuppressed (whether the banner may show)", () => {
  it("is NOT suppressed when neither flag is set (banner may show once beforeinstallprompt fires)", () => {
    expect(readInstallSuppressed()).toBe(false);
  });

  it("is suppressed after a dismissal (previously-dismissed -> no banner)", () => {
    window.localStorage.setItem(PWA_DISMISSED_KEY, "1");
    expect(readInstallSuppressed()).toBe(true);
  });

  it("is suppressed after an install (previously-installed -> no banner)", () => {
    window.localStorage.setItem(PWA_INSTALLED_KEY, "1");
    expect(readInstallSuppressed()).toBe(true);
  });

  it("is suppressed off the browser (SSR-safe: nothing flashes during a non-interactive render)", () => {
    vi.unstubAllGlobals(); // remove the window stub -> typeof window === "undefined"
    expect(readInstallSuppressed()).toBe(true);
  });

  it("is suppressed when localStorage throws (a storage fault must never become an un-dismissable nag)", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("storage disabled");
        },
      },
    });
    expect(readInstallSuppressed()).toBe(true);
  });
});

describe("persistInstallDecision (which flag each outcome records, and that it suppresses re-show)", () => {
  it("dismiss records the dismissed flag (not the installed one) and suppresses re-show", () => {
    persistInstallDecision("dismissed");

    expect(window.localStorage.getItem(PWA_DISMISSED_KEY)).toBe("1");
    expect(window.localStorage.getItem(PWA_INSTALLED_KEY)).toBeNull();
    // The banner must not reappear on later dashboard visits.
    expect(readInstallSuppressed()).toBe(true);
  });

  it("install (accept / appinstalled) records the installed flag (not the dismissed one) and suppresses re-show", () => {
    persistInstallDecision("installed");

    expect(window.localStorage.getItem(PWA_INSTALLED_KEY)).toBe("1");
    expect(window.localStorage.getItem(PWA_DISMISSED_KEY)).toBeNull();
    expect(readInstallSuppressed()).toBe(true);
  });

  it("does not throw off the browser (SSR-safe no-op)", () => {
    vi.unstubAllGlobals();
    expect(() => persistInstallDecision("dismissed")).not.toThrow();
  });
});
