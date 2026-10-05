"use client";

import { useEffect, useRef } from "react";

/**
 * Service worker registrar (Story 8.2) — a render-null client component.
 *
 * Registers the minimal `/sw.js` (installability only, no caching) once on mount
 * when the browser supports service workers. Mounted in the root layout so the
 * SW is registered on every page, satisfying browser installability criteria
 * alongside the manifest.
 *
 * Follows the once-guarded mount-effect pattern from `LocaleProvider` (a `useRef`
 * latch so registration fires at most once and never re-runs on re-render).
 * Registration is best-effort: any failure (unsupported, blocked, insecure
 * context) is swallowed — a failed SW registration must never break the app.
 */
export function ServiceWorkerRegistrar(): null {
  const registered = useRef(false);

  useEffect(() => {
    if (registered.current) {
      return;
    }
    registered.current = true;

    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-fatal: the app and (on supporting browsers) the manifest-driven
      // install path still work without a registered SW. Never surface an error.
    });
  }, []);

  return null;
}
