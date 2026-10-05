---
title: 'PWA Install ("Add to Home Screen")'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'bc90b928768bf01d7de3a144f14a3e85b9099a1b'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Scheza has no web app manifest, no service worker, and no install affordance, so mobile users cannot add it to their home screen. Tim's "day-1 habit" home-screen icon (FR41, UX-DR10) is impossible, and the installed-app launch (standalone, opens to the user's dashboard) does not exist.

**Approach:** Ship a Next 16 native `app/manifest.ts` + brand PWA icons + a minimal registered service worker so the app meets installability criteria. On dashboard screens, capture the browser `beforeinstallprompt` event and surface a compact, dismissible, bottom-anchored install banner that triggers the native prompt; persist dismissal so we never nag. Give the installed app a dedicated `start_url` resolver route that lands a logged-in user directly on their `/{slug}` dashboard (reusing existing session + org resolution), leaving the public `/` landing untouched.

## Boundaries & Constraints

**Always:**
- Ship the manifest via Next's native `app/manifest.ts` (`MetadataRoute.Manifest`, auto-linked): `display: standalone`, `name`/`short_name` "Scheza", `theme_color` `#342350`, `background_color` `#FFC69A`, 192/512 + maskable-512 icons from `public/`.
- Register a minimal service worker (install/activate + pass-through `fetch`) from a `'use client'` registrant gated on `'serviceWorker' in navigator`.
- Surface the prompt only on dashboard screens, only when `beforeinstallprompt` has fired and the user hasn't dismissed/installed; `preventDefault()` + stash the event, call `prompt()` on the user's click.
- Persist dismissal and the `appinstalled` signal to `localStorage` so the banner never reappears once dismissed or installed.
- The installed `start_url` opens a logged-in user directly on their `/{slug}` dashboard (existing Supabase session respected); session-less open routes to `/login`.
- Prompt UI uses a next-intl `PwaInstall` namespace (no hardcoded strings), reuses shadcn `Button` + `cn` + zinc tokens, meets WCAG AA contrast, with real labels, `focus-visible` rings, and full keyboard operability.

**Never:**
- Never change the public `/` landing (keeps rendering PromptBuilder for everyone) — route the PWA via a dedicated resolver route, not by redirecting `/`.
- Never add offline caching, background sync, push, or precaching — the SW exists only to satisfy installability.
- Never grant the SW or resolver route privileges beyond existing patterns; the resolver reuses `resolveUserPrimaryOrgSlug` under the already-allowlisted admin client as `auth/confirm` does.
- Never show the prompt on load or on non-dashboard/anonymous surfaces, and never re-prompt after dismissal/installation.
- Never add an iOS-specific in-app prompt or UA sniffing (decided): the custom banner is Chromium/`beforeinstallprompt`-only. iOS stays installable via the manifest + `apple-touch-icon`/`appleWebApp` meta (manual Share → "Add to Home Screen"), with no in-app iOS UI in this story.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Installable dashboard | Chromium mobile, `beforeinstallprompt` fires on a `/{slug}` screen, never dismissed | Event is `preventDefault()`'d + stashed; dismissible banner slides up; clicking Install calls the stashed `prompt()` | If `prompt()` rejects/throws, dismiss the banner silently (no error UI) |
| Install accepted | User accepts the native prompt / `appinstalled` fires | Banner removed; `localStorage` records installed so it never shows again | N/A |
| Dismissed | User clicks Dismiss | Banner removed immediately; `localStorage` records dismissal; no reappear on later dashboard visits | N/A |
| No prompt available | Browser never fires `beforeinstallprompt` (e.g. iOS Safari, already installed, unsupported) | No banner renders; app is still installable via the manifest + apple-touch-icon (manual OS install) | N/A — absence of event is the expected no-op |
| Installed launch | App opened from home-screen icon at `start_url`, valid session | Resolver route resolves the user's primary org and redirects to `/{slug}` in a standalone window | No session → redirect `/login`; session but no org → `/login?login=no-org` (mirror `auth/confirm`) |

</frozen-after-approval>

## Code Map

- `src/app/manifest.ts` -- NEW. Next 16 `MetadataRoute.Manifest` default export; values mirror `scheza-brand-kit/web/site.webmanifest` (`start_url` = the resolver route, `display: standalone`, theme/bg, three icons). Auto-linked — no manual `<link rel=manifest>`.
- `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`, `public/apple-touch-icon.png` -- NEW, copied verbatim from `scheza-brand-kit/web/`. Referenced by the manifest + apple meta.
- `public/sw.js` -- NEW. Minimal SW: `install` (`skipWaiting`), `activate` (`clients.claim`), pass-through `fetch` (no caching). Root-served → scope `/`.
- `src/components/pwa/ServiceWorkerRegistrar.tsx` -- NEW `'use client'`, render-null. useRef-guarded once-on-mount `navigator.serviceWorker.register('/sw.js')` when supported. Pattern: the once-guarded mount effect in `src/components/i18n/LocaleProvider.tsx`.
- `src/components/pwa/InstallPrompt.tsx` -- NEW `'use client'`. Captures `beforeinstallprompt` (preventDefault + stash) + `appinstalled`; dismissal/installed flags in `localStorage` (own keys); renders the banner (shape in Design Notes) via shadcn `Button`; `useTranslations('PwaInstall')`.
- `src/app/layout.tsx:20-24` -- root `metadata`. ADD `metadata.icons.apple` (brand apple-touch-icon) + `appleWebApp: { capable, statusBarStyle, title }`; ADD a `viewport` export with `themeColor` `#342350`; mount `<ServiceWorkerRegistrar/>`. Keep existing title/description + the LocaleProvider→Providers chain.
- `src/components/layout/DashboardNav.tsx` -- dashboard shell on every `/{slug}` screen (LocaleToggle sits `ml-auto`). Mount `<InstallPrompt/>` here → banner is dashboard-scoped, not on anonymous/landing routes.
- `src/app/home/route.ts` -- NEW `start_url` resolver. Server session read → on a valid user `resolveUserPrimaryOrgSlug(user.id, adminClient)` → `redirect('/{slug}')`; no session → `/login`; session but no org → `/login?login=no-org`.
- `src/lib/auth/org.ts` -- `resolveUserPrimaryOrgSlug(userId, adminClient)` (REUSE, don't change). Authority for the dashboard slug.
- `src/app/auth/confirm/route.ts:138-210` -- REFERENCE: the canonical session→slug redirect + admin-client usage the resolver mirrors.
- `src/lib/supabase/server.ts` + `src/lib/supabase/admin.ts` (`createAdminClient`) -- REUSE in the resolver route.
- `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- ADD a `PwaInstall` namespace (`label`, `title`, `body`, `install`, `dismiss`) to both (mirror the `LocaleToggle` block).
- `src/components/ui/button.tsx` (`buttonVariants`) + `src/lib/utils.ts` (`cn`) -- REUSE for the banner.

## Tasks & Acceptance

**Execution:**
- [x] `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`, `public/apple-touch-icon.png` -- copy verbatim from `scheza-brand-kit/web/` -- supply the install icons the manifest + apple meta require.
- [x] `src/app/manifest.ts` -- add the `MetadataRoute.Manifest` default export (brand values, `start_url` = resolver route, standalone, three icons) -- auto-served installable manifest (AC: ships a manifest).
- [x] `public/sw.js` + `src/components/pwa/ServiceWorkerRegistrar.tsx` -- minimal pass-through SW + once-guarded client registrar; mount the registrar in `src/app/layout.tsx` -- ships + registers a service worker (AC: SW enabling installability).
- [x] `src/app/layout.tsx` -- add `appleWebApp` + apple-touch-icon to `metadata.icons`, add `viewport` export with `themeColor`, mount `<ServiceWorkerRegistrar/>` -- iOS manual install looks native; themed standalone chrome.
- [x] `src/components/pwa/InstallPrompt.tsx` -- capture `beforeinstallprompt`/`appinstalled`, localStorage dismissal+installed gating, render the dismissible banner, call `prompt()` on click; mount in `src/components/layout/DashboardNav.tsx` -- the post-"aha" dashboard prompt (AC: prompted to Add to Home Screen).
- [x] `src/app/home/route.ts` -- `start_url` resolver: session → `resolveUserPrimaryOrgSlug` → `/{slug}`; else `/login` / `/login?login=no-org` -- installed app opens on the user's dashboard respecting the session (AC: loads the dashboard directly).
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add the `PwaInstall` namespace in both -- no hardcoded strings in the prompt.
- [x] `tests/unit/pwa-install-prompt.test.tsx` -- unit-test the I/O matrix via extracted pure helpers: `beforeinstallprompt` sets prompt-available state; accept/`appinstalled` and dismiss each persist the right `localStorage` flag and suppress re-show; previously-dismissed/installed → no banner. Follow the `tests/unit/locale-provider.test.tsx` convention (Vitest `include` is `tests/**`).
- [x] `tests/unit/home-start-url-route.test.ts` -- unit-test the matrix "Installed launch" row (added during the matrix audit): session+org → `/{slug}`; no session / getUser error → `/login`; session but no org → `/login?login=no-org`; thrown fault → `/login`. Follows the `auth-confirm.test.ts` route-mock convention.

**Acceptance Criteria:**
- Given the built app, when it is served, then a web app manifest and a registered service worker are present and the app meets browser installability criteria.
- Given a Chromium mobile user on a dashboard screen who has not dismissed or installed, when `beforeinstallprompt` fires, then a dismissible "Add to Home Screen" banner appears and clicking Install triggers the native install prompt; once dismissed or installed it does not reappear.
- Given an installed PWA, when it is opened from the home-screen icon, then it launches standalone and lands the logged-in user directly on their `/{slug}` dashboard (existing session respected).
- Given either locale, when the prompt renders, then its text comes from the `PwaInstall` catalog, meets WCAG AA contrast, and is fully keyboard-operable with visible focus.

## Implementation Notes

- Built exactly to the Code Map. New: `src/app/manifest.ts`, `public/sw.js`, `public/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png` (copied verbatim from `scheza-brand-kit/web/`), `src/components/pwa/ServiceWorkerRegistrar.tsx`, `src/components/pwa/InstallPrompt.tsx`, `src/app/home/route.ts`. Edited: `src/app/layout.tsx` (apple meta + `viewport.themeColor` + mounts the registrar), `src/components/layout/DashboardNav.tsx` (mounts `<InstallPrompt/>`), `src/lib/i18n/en.json`+`fr.json` (`PwaInstall` namespace).
- `InstallPrompt` extracts its persistence/gating decisions into pure exported helpers (`readInstallSuppressed`, `persistInstallDecision`) over `localStorage` keys `scheza.pwa.dismissed` / `scheza.pwa.installed` — both SSR-safe and throw-safe (a storage fault returns "suppressed" so a disabled-storage browser never gets an un-dismissable nag). Mirrors the `LocaleProvider` helper/once-guarded-effect convention.
- `/sw.js` is intentionally no-op pass-through (empty `fetch` listener, `skipWaiting`+`clients.claim`); no caching/offline by design.
- Manifest `start_url` is `/home` (not `/`), per the dedicated-resolver decision; the public `/` landing is untouched.
- **Matrix-test audit:** decision rows (dismiss/install persistence + suppression, SSR/throw safety) are covered by the 8 `pwa-install-prompt` unit tests; the "Installed launch" resolver row is covered by the 5 new `home-start-url-route` tests added during the audit (node-testable via the `server-only` stub + route mocks, per `auth-confirm.test.ts`). The live `beforeinstallprompt` capture / `prompt()` replay / banner render + keyboard/AA/focus + FR copy switch are assigned to the Playwright manual review — the repo test env is `node` (no jsdom to mount/fire DOM events), the same limitation and split accepted for Story 8.1.
- Verified: `npm run type-check` clean, `npm run lint` clean (only the pre-existing eslintrc-deprecation notice), `npm test` 1632 pass (141 files, incl. 13 new across the two PWA test files), `npm run build` compiled (static `/manifest.webmanifest` + dynamic `/home` emitted, `/sw.js` served from `public/`; one pre-existing middleware→proxy deprecation warning, unrelated).
- Copy carries no em-dashes (user-facing-copy rule).
- **Playwright MCP manual review (localhost:3000, authed tenant `session-1f4fa453`) — PASSED after one fix.** Verified live: `/home` redirected an authed user straight to `/session-1f4fa453` (AC3, session respected); `/manifest.webmanifest` served `application/manifest+json` with valid brand JSON (name/short_name Scheza, `start_url:/home`, standalone, theme `#342350`, bg `#FFC69A`, 192/512/maskable-512 icons); `/sw.js` served 200 and registered (`navigator.serviceWorker` scope `/`); `theme-color` + apple-touch-icon + apple-web-app-title meta present; the banner surfaced on a (synthetic) `beforeinstallprompt` with FR copy from the `PwaInstall` catalog (`role="region"`/`aria-label`, keyboard-focusable buttons, AA contrast); Install called the native `prompt()` and closed the banner; Dismiss persisted `scheza.pwa.dismissed` and the banner stayed suppressed across a reload; the public `/` landing was untouched (no banner). Two console errors are non-issues: the dev-only `Manifest: Line 1 Syntax error` (the manifest is valid JSON + correct content-type, static in the prod build) and a `React state update before mount` warning that appears only on the pre-existing dashboard (absent on `/`, and `InstallPrompt` renders `null` until an event fires) — not introduced by this story.
- **Manual-review fix (banner positioning):** `InstallPrompt` is mounted inside `DashboardNav`'s `<nav>`, which carries `backdrop-blur` (`backdrop-filter`). A backdrop-filter establishes a containing block for `position: fixed` descendants, so the banner's `bottom-4` pinned to the nav bar and rendered at the top of the screen (clipped). Fixed by rendering the banner through `createPortal(..., document.body)` so it escapes the nav's containing block and pins to the viewport (verified bottom-right after the fix). SSR-guarded (`typeof document`); the banner still only mounts where `DashboardNav` renders, so it stays dashboard-scoped.

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **[patch] Banner entrance animation has no `prefers-reduced-motion` guard (Blind Hunter).** `low`. Verified: `InstallPrompt.tsx` applies `animate-in fade-in slide-in-from-bottom-4 duration-300` unconditionally; vestibular-sensitive users get the slide/fade. Fix is a direct one-token correction (`motion-reduce:animate-none`), so it survives the low-reject rule → patch.
- **[patch] Manifest `start_url` deviation (`/home`) and icons have no regression test (Verification Gap · also Blind Hunter "no mirror test").** `medium` (filed by the pre-verified gap layer). Verified: the only manifest-adjacent test is `home-start-url-route.test.ts` (tests the route, not the manifest); nothing imports `src/app/manifest.ts`. The one load-bearing non-default value (`start_url: "/home"`, the spec's explicit deviation) could regress to `/` with a fully green suite, silently stranding installed users on the public landing. Cheap to pin → patch (new `tests/unit/manifest.test.ts`). The heavier brand-kit auto-drift check is not taken (more than trivial; the value-pin closes the real hazard).
- **[patch] `/home` redirect responses set no `Cache-Control` (Blind Hunter).** `medium`. Verified: `route.ts` returns bare `NextResponse.redirect(...)` 307s. `start_url` is the installed app's per-session entry point resolving to `/{slug}` vs `/login`; a 307 cached by any intermediary could land a user on the wrong org or a stale login. `dynamic = "force-dynamic"` governs Next's render cache, not downstream caching of the redirect. Fix is one line per response (`no-store`), guards no undemonstrated state → patch.
- **[defer] Static `/home` route shadows an org whose slug is literally `home`; slug generator has no reserved-word list (Edge Case Hunter).** `low`, deferred as pre-existing. Verified: `src/app` already exposes `login`, `auth`, `forms`, `generate`, `demo`, `i`, `api`, `(legal)` as top-level routes that shadow a same-named slug, and `src/lib/claim/slug.ts` reserves none — the namespace gap predates this story; `/home` adds one more word. Bare single-word slugs like `home` are effectively unreachable from the composite trade+city generator, so the practical risk is negligible. The real fix (a reserved-word list in slug generation) is pre-existing code guarding an undemonstrated state → defer, not patch.
- **[reject·low] `onInstall` never reads `event.userChoice`; relies on `appinstalled` → banner could reappear after accept (Blind Hunter).** `low`, rejected. Once the app is installed the browser does not re-fire `beforeinstallprompt`, so the banner's trigger is gone regardless of the `localStorage` flag — the claimed reappearance does not occur in practice. Recording `installed` via the `appinstalled` listener matches the frozen matrix row exactly; awaiting `userChoice` adds a branch for negligible gain.
- **[reject·low] `BeforeInstallPromptEvent` type omits `userChoice`/`platforms` (Blind Hunter).** `low`, rejected. Same root cause as above; the narrow type covers exactly what the code uses (`prompt()`). No runtime harm; widening the type is only needed if we adopt `userChoice`, which we rejected.
- **[reject·false] Service worker registered app-wide so Chromium's mini-infobar surfaces on anonymous routes (Blind Hunter).** Rejected. Current Chromium deprecated the automatic mini-infobar — an un-prevented `beforeinstallprompt` surfaces no unsolicited UI; install requires an explicit `prompt()` or the browser menu. App-wide SW registration is the intended way to satisfy installability criteria across the origin. The claimed unsolicited UI does not occur.
- **[reject·low] Manifest omits `id`, `lang`, `dir` (Blind Hunter).** `low`, rejected. The app is installable without them; `id` defaults to `start_url` (`/home`), which is stable, so the deviation needs no explicit `id`. No named harm; adding optional metadata guards nothing demonstrated.
- **[reject·low] `/home` discards the incoming query string (no `next`/deep-link forwarding) (Blind Hunter).** `low`, rejected. The manifest `start_url` is a bare `/home` with no params and no feature forwards any; the concern is speculative future use. Forwarding would add parsing/branching for no current consumer.
- **[reject·low] Dismissal flags are not cleared on sign-out, suppressing the banner across accounts on one browser (Blind Hunter).** `low`, rejected. PWA install and the "add to home screen" dismissal are device-level concepts, not account-level — suppressing re-nag on the same device after any user dismisses (and especially once installed) is the correct behavior, not a defect.

## Design Notes

- **Manifest mechanism (deviation from the epic-context planning note):** the epic context sketched `public/manifest.json`; Next 16.3.6 provides a native `app/manifest.ts` (`MetadataRoute.Manifest`) convention that is typed and auto-linked (per `node_modules/next/dist/docs/.../metadata/manifest.md`). Per AGENTS.md ("read the docs, heed the conventions") we use the native convention. Equivalent outcome, cleaner than a hand-rolled public file + manual `<link>`.
- **Service worker is deliberately minimal.** Next 16 ships no SW framework (`.../guides/progressive-web-apps.md`); recent Chromium no longer strictly requires a fetch handler for installability, but we ship a trivial pass-through one to maximize cross-browser installability while explicitly avoiding any caching/offline behavior (out of scope, and a stale cache would be a real hazard).
- **Why a dedicated `start_url` resolver, not redirecting `/`:** the public `/` landing intentionally serves the PromptBuilder to everyone; redirecting authenticated users away would be a product change beyond this story. A dedicated route (`/home`) resolves session→slug server-side (reusing `resolveUserPrimaryOrgSlug`, exactly as `auth/confirm` does) and is used only as the manifest `start_url`, so normal browsing is untouched.
- **Banner shape (per web-uiux-architect — compact dismissible bottom sheet, shadcn zinc tokens for AA):**
```tsx
<div role="region" aria-label={t("label")}
  className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-sm rounded-xl border bg-background p-4 shadow-lg
             animate-in fade-in slide-in-from-bottom-4 duration-300 sm:inset-x-auto sm:right-4">
  <div className="flex items-start gap-3">
    <Download aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
    <div className="flex-1">
      <p className="text-sm font-medium text-foreground">{t("title")}</p>
      <p className="mt-0.5 text-sm text-muted-foreground text-pretty">{t("body")}</p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={onInstall}>{t("install")}</Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>{t("dismiss")}</Button>
      </div>
    </div>
  </div>
</div>
```
Motion is CSS-only (`animate-in` from tailwindcss-animate, already a shadcn dependency); no Framer Motion. Reuses the `LocaleToggle` once-guarded-effect + localStorage-helper patterns for dismissal persistence.

## Verification

**Commands:**
- `npm run type-check` -- expected: no errors
- `npm run lint` -- expected: clean
- `npm test` -- expected: new `pwa-install-prompt` tests pass, suite green
- `npm run build` -- expected: compiles; manifest route and `/sw.js` emitted

**Manual checks (Playwright MCP, localhost:3000, authed `/session-…` fixture):**
- Load a dashboard screen: DevTools → Application shows the manifest (name Scheza, standalone, icons) parsed with no errors and the service worker registered/activated.
- Simulate/observe `beforeinstallprompt` on the dashboard: the banner appears, is keyboard-focusable with visible focus, meets AA contrast; Dismiss removes it and it stays gone on reload (localStorage flag set).
- Toggle FR: the banner copy switches to the `PwaInstall` FR catalog (chrome-only, no hardcoded text).
- Visit `/home` while authed → redirected to `/{slug}` dashboard; visit `/home` logged-out → redirected to `/login`.
</content>
