"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * PWA install prompt (Story 8.2) — the post-"aha" "Add to Home Screen" banner.
 *
 * Captures the Chromium-only `beforeinstallprompt` event (preventDefault + stash
 * it), and — only on a dashboard screen, only when the event has fired and the
 * user has neither dismissed nor installed — renders a compact, dismissible,
 * bottom-anchored banner. Clicking Install replays the stashed native prompt;
 * Dismiss (or an `appinstalled` signal, or a native accept) hides it and records
 * the decision in `localStorage` so it never nags again.
 *
 * Deliberately Chromium-only: there is NO iOS in-app UI and NO UA sniffing. iOS
 * stays installable via the manifest + `apple-touch-icon`/`appleWebApp` meta
 * (manual Share -> "Add to Home Screen"). Absence of `beforeinstallprompt` is a
 * no-op (no banner), which is the expected behavior on iOS / already-installed /
 * unsupported browsers.
 *
 * Persistence + gating DECISIONS are extracted into the pure, exported helpers
 * below (`readInstallSuppressed`, `persistInstallDecision`) so the I/O matrix is
 * unit-testable without a DOM/effect runtime, mirroring the `LocaleProvider`
 * localStorage-helper convention. Reuses the shadcn `Button` + `cn` + zinc tokens
 * for WCAG AA contrast, visible focus rings, and full keyboard operability.
 */

/** `localStorage` key set once the user dismisses the banner. */
export const PWA_DISMISSED_KEY = "scheza.pwa.dismissed";
/** `localStorage` key set once the app is installed (accept / `appinstalled`). */
export const PWA_INSTALLED_KEY = "scheza.pwa.installed";

/**
 * The browser's `beforeinstallprompt` event. Not in the DOM lib typings (it is a
 * non-standard Chromium event), so it is declared narrowly here.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
};

/**
 * Has the user already dismissed or installed (either flag set)? When true the
 * banner must never show. SSR-safe (returns `true` off the browser so nothing
 * flashes during a non-interactive render). Pure + exported for unit coverage of
 * the "previously dismissed/installed -> no banner" matrix rows.
 */
export function readInstallSuppressed(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    return (
      window.localStorage.getItem(PWA_DISMISSED_KEY) !== null ||
      window.localStorage.getItem(PWA_INSTALLED_KEY) !== null
    );
  } catch {
    // localStorage can throw (privacy mode / disabled). Treat as suppressed so a
    // storage fault never turns the banner into an un-dismissable nag.
    return true;
  }
}

/**
 * Persist the user's decision so the banner never reappears: `"dismissed"` on an
 * explicit dismiss, `"installed"` on a native accept / `appinstalled`. Pure +
 * exported for unit coverage of the "dismiss / accept persists the right flag"
 * matrix rows. SSR-safe + never throws.
 */
export function persistInstallDecision(decision: "dismissed" | "installed"): void {
  if (typeof window === "undefined") {
    return;
  }
  const key = decision === "installed" ? PWA_INSTALLED_KEY : PWA_DISMISSED_KEY;
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // Non-fatal: if we cannot persist, the in-memory state still hides the banner
    // for the rest of this session.
  }
}

export function InstallPrompt() {
  const t = useTranslations("PwaInstall");

  // The stashed `beforeinstallprompt` event. A ref (not state) because replaying
  // it on click does not need to trigger a render; `visible` governs the UI.
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Previously dismissed/installed -> never wire listeners; stays a no-op.
    if (readInstallSuppressed()) {
      return;
    }

    function onBeforeInstallPrompt(event: Event) {
      // Suppress Chromium's default mini-infobar; we drive our own banner.
      event.preventDefault();
      deferredPrompt.current = event as BeforeInstallPromptEvent;
      setVisible(true);
    }

    function onAppInstalled() {
      // The app was installed (via our prompt or the browser's own UI). Record it
      // and hide — it must never show again.
      persistInstallDecision("installed");
      deferredPrompt.current = null;
      setVisible(false);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const onInstall = useCallback(async () => {
    const event = deferredPrompt.current;
    // Hide immediately; the native OS prompt now owns the interaction. If the
    // user accepts, `appinstalled` records the installed flag.
    setVisible(false);
    deferredPrompt.current = null;
    if (!event) {
      return;
    }
    try {
      await event.prompt();
    } catch {
      // `prompt()` rejected/threw (e.g. called too late) -> dismiss silently, no
      // error UI (frozen matrix). The banner is already hidden.
    }
  }, []);

  const onDismiss = useCallback(() => {
    persistInstallDecision("dismissed");
    deferredPrompt.current = null;
    setVisible(false);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label={t("label")}
      className={cn(
        "fixed inset-x-4 bottom-4 z-50 mx-auto max-w-sm rounded-xl border bg-background p-4 shadow-lg",
        "animate-in fade-in slide-in-from-bottom-4 duration-300 motion-reduce:animate-none sm:inset-x-auto sm:right-4",
      )}
    >
      <div className="flex items-start gap-3">
        <Download aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">{t("title")}</p>
          <p className="mt-0.5 text-sm text-muted-foreground text-pretty">
            {t("body")}
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={onInstall}>
              {t("install")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              {t("dismiss")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
