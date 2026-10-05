---
title: 'Instant EN/FR UI Toggle (No Reload)'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'bb2704dd6df414729592efda884fe4f6bb2f710e'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app ships a complete EN/FR next-intl seam (parallel catalogs, cookie-based resolution) but no way for a user to switch language. Bilingual owners, their teams, and their clients are stuck in whatever locale the cookie defaults to.

**Approach:** Add a top-right EN/FR segmented toggle backed by a client-driven locale provider that holds both pre-loaded catalogs, so the client UI re-renders in place the instant the user switches. Persist the choice to `localStorage` (canonical) and mirror it to the `NEXT_LOCALE` cookie (SSR first-paint), then fire a soft RSC refresh so server-rendered chrome follows — all with no full page reload and no backend call.

## Boundaries & Constraints

**Always:**
- Switching must not trigger a full page reload; client UI re-renders in place and client state (open dialogs, form input, query cache) survives.
- Persist the chosen locale to `localStorage` and mirror it to the `NEXT_LOCALE` cookie so the next visit's SSR first paint matches — using only `document.cookie`/`localStorage`, never a backend API or DB write.
- Reuse the existing next-intl config (`locales`, `defaultLocale`, `LOCALE_COOKIE`, `isLocale`) and both catalogs — do not fork locale definitions.
- All toggle UI meets WCAG AA contrast (zinc theme tokens; no light-grey-on-white), with real accessible labels, full keyboard operability, and visible `focus-visible` rings.

**Never:**
- Never re-translate stored data values or user/AI-authored `org_schemas` field labels — the toggle switches i18n-catalog UI chrome only (nav, buttons, built-in/system labels); custom column labels render as-stored in either locale (decided: "chrome only"). Localizing custom field labels is a separate, larger story.
- Never add a URL locale prefix or locale-routing segments.
- Never convert `DashboardNav`'s server-only RBAC link-gating to client role logic (role must not reach the client; Story 2.4 frozen posture).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Switch to FR | Dashboard screen, EN active, user activates FR | Client UI re-renders to FR in place <300ms; `localStorage` + cookie set to `fr`; `document.documentElement.lang='fr'`; server chrome follows via background RSC refresh; no full reload | N/A |
| Return visit | `localStorage=fr`, fresh page load | SSR renders FR from the cookie mirror; toggle shows FR active | If cookie absent but `localStorage=fr`, client reconciles the cookie and refreshes once |
| No stored preference | No `localStorage`, no cookie | Renders `defaultLocale` (EN); toggle shows EN active | N/A |
| Generated-data screen | Tenant with AI-generated columns, toggle to FR | i18n UI chrome switches to FR; stored column/field labels and values render unchanged | N/A |

</frozen-after-approval>

## Code Map

- `src/lib/i18n/config.ts` -- `locales ['en','fr']`, `defaultLocale`, `LOCALE_COOKIE='NEXT_LOCALE'`, `isLocale()`. Reuse; do not change.
- `src/lib/i18n/request.ts` -- server `getRequestConfig` reads the cookie → catalog. Stays the SSR resolution path; no change.
- `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- complete parallel catalogs (35+ namespaces). ADD a `LocaleToggle` namespace to both.
- `src/app/layout.tsx` -- root server layout; currently wraps children directly in `NextIntlClientProvider` with server `locale`/`messages`. Replace that wrap with the new client `LocaleProvider` (pass `initialLocale={locale}`); keep `<html lang={locale}>` server-rendered.
- `src/app/providers.tsx` -- existing `'use client'` provider (TanStack Query); pattern reference for a client provider mounted under the intl provider.
- `src/components/layout/DashboardNav.tsx` -- server dashboard shell (all dashboard screens). Render `<LocaleToggle/>` pinned top-right (`ml-auto`); leave RBAC link-gating intact.
- `src/components/ui/button.tsx` (`buttonVariants`) + `src/lib/utils.ts` (`cn`) -- reuse for styling.
- `src/components/generation/PromptBuilder.tsx` -- existing `useLocale()` consumer; confirms next-intl's `useLocale()` reads the active locale from the provider (will reflect client state).

## Tasks & Acceptance

**Execution:**
- [x] `src/components/i18n/LocaleProvider.tsx` -- new `'use client'` provider: statically import both catalogs, hold `locale` in state (init from `initialLocale` prop), render `<NextIntlClientProvider locale={locale} messages={catalogs[locale]}>`, and expose `setLocale` via a context. `setLocale(next)` updates state (instant), writes `localStorage` + the `NEXT_LOCALE` cookie via `document.cookie`, sets `document.documentElement.lang`, then calls `router.refresh()`. On mount, reconcile from `localStorage` (apply once if it differs from the active locale) -- the no-reload instant-swap engine.
- [x] `src/components/i18n/LocaleToggle.tsx` -- new `'use client'` segmented EN/FR control: `role="group"` + `aria-label`, two `aria-pressed` buttons, a decorative `Languages` lucide icon (`aria-hidden`), `sr-only` "switch to" labels, `focus-visible` rings, CSS transition on the active state; reads the active locale (`useLocale`) and calls the context `setLocale` -- the user-facing control.
- [x] `src/app/layout.tsx` -- replace the direct `NextIntlClientProvider` wrap with `<LocaleProvider initialLocale={locale}>`; keep server-rendered `<html lang={locale}>` -- wire the provider.
- [x] `src/components/layout/DashboardNav.tsx` -- render `<LocaleToggle/>` top-right (`ml-auto`), unchanged RBAC gating -- expose the toggle on every dashboard screen.
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add the `LocaleToggle` namespace (`label`, `locale.en`, `locale.fr`, `switchTo.en`, `switchTo.fr`) in both; no hardcoded strings in the component.
- [x] `src/components/i18n/LocaleProvider.test.tsx` -- unit-test the I/O matrix: switch sets state + `localStorage` + cookie, mount reconciles from `localStorage`, no-preference falls back to EN. (Placed at `tests/unit/locale-provider.test.tsx` — the project's Vitest `include` only runs `tests/**`, so a test under `src/` would never execute.)

**Acceptance Criteria:**
- Given a dashboard screen, when the user activates the top-right toggle, then all client-rendered UI switches locale in place under 300ms with no full page reload and no backend call.
- Given a language selection, when the user returns later, then the app opens in that language (restored from `localStorage` via the cookie mirror) with the toggle reflecting it.
- Given either locale, when toggle and navigation UI render, then text meets WCAG AA contrast with real labels and visible keyboard focus.

## Implementation Notes

- Files: new `src/components/i18n/LocaleProvider.tsx` (+ exported pure helpers `readStoredLocale`/`persistLocale`/`resolveMountReconcile` and the `useLocaleSwitcher` context hook), new `src/components/i18n/LocaleToggle.tsx`; edits to `src/app/layout.tsx` (provider swap; drops `getMessages`, adds an `isLocale` guard on the server locale), `src/components/layout/DashboardNav.tsx` (renders `<LocaleToggle/>`), and the `LocaleToggle` namespace in `en.json`/`fr.json`.
- localStorage key reuses `LOCALE_COOKIE` (`NEXT_LOCALE`); cookie written `path=/; max-age=1yr; samesite=lax`. No backend call on switch (confirmed in diff).
- Deviation (low risk): test lives at `tests/unit/locale-provider.test.tsx`, not the spec's `src/...` path — the Vitest `include` only runs `tests/**`, so a `src/`-colocated test would silently never run. Matches the existing `dashboard-nav.test.tsx` convention.
- Deviation (low risk): one scoped `react-hooks/set-state-in-effect` disable on the mount reconciliation — `localStorage` is client-only so the one-time sync-from-external-store must run in an effect; guarded by a `useRef` so it fires at most once. Justified inline.
- Matrix-test audit: rows 1–3 (switch writes localStorage+cookie+`<html lang>`; return-visit reconciles once; no-preference → EN) are asserted by the 9 passing unit tests against the extracted pure helpers, plus a `renderToStaticMarkup` smoke test proving the provider drives next-intl `useLocale()` from `initialLocale`. Row 4 (generated-data chrome-only) is a negative-scope assertion — no code path translates `org_schemas` labels, so it holds by construction; the live no-reload swap, keyboard/contrast, and the stored-label-unchanged rich path are assigned to the Playwright manual review (test env is `node`, no jsdom to mount the records grid).
- Verified independently: `npm run type-check` clean, `npm run lint` clean, test suite 1619 pass (10 in the new file after the review patch); full `npm run build` run to confirm the RSC/client boundary.
- Playwright MCP manual review (localhost:3000, authed tenant `session-1f4fa453`, 114 records / custom columns) PASSED: clicking FR flipped the UI instantly with a `window` sentinel surviving (no full reload), `<html lang>` en→fr, nav switched (Tableau de bord/Importer/Factures/Formulaires/Paramètres), custom column headers (Customer Name, Phone Number, …) stayed as-stored (chrome-only), cookie + localStorage both `fr`; the active segment carries no "switch to" sr-only (review patch confirmed live); a full page reload stayed French from the cookie (SSR return-visit); zero console errors.

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **[patch] `LocaleToggle.tsx` — `sr-only` "switch to" label rendered on the active segment too (Blind Hunter).** `medium`. Verified: every segment renders `<span class="sr-only">{t('switchTo.'+loc)}</span>` unconditionally, so the active FR button's accessible name becomes "FR … Passer en français" — it invites switching to the current language and contradicts `aria-pressed="true"`. Real a11y defect on the very control this story adds; fix is a trivial conditional (render `switchTo` only when `loc !== active`).
- **[patch] `LocaleToggle` has no executing render test (Verification Gap).** `medium`. Verified: the only render test renders a bare `data-locale` probe, never `LocaleToggle`; `dashboard-nav.test.tsx`'s walker never executes it. The deterministic `aria-pressed={loc===active}` / label wiring has zero coverage — inverting the predicate ships green. Renderable in the repo's own `renderToStaticMarkup` convention, so patchable in-scope.
- **[defer] No language toggle on the public/anonymous landing page (Blind Hunter).** Out of this story's intent — the 8.1 AC scopes the toggle to "any dashboard screen"; anonymous/marketing surfaces are a separate concern (marketing-site epic). The orphaned `Home.localeLabel` string is pre-existing (not introduced by this diff). Real product gap, but not 8.1's problem → deferred.
- **[defer] No automated coverage of the live switch or the mount-reconcile effect (Blind Hunter + Verification Gap, shared root cause).** Verified real: `setLocale` (state-swap + `persistLocale` + `router.refresh`) and the `useEffect`/`useRef` reconcile are never executed by a test; pure helpers are tested in isolation and `router.refresh` is mocked to a no-op. Closing it needs a jsdom/interaction renderer or Playwright (the repo env is `node`; `tests/e2e/` holds only `.gitkeep`) — new infra, out of scope. Repo convention defers interaction paths to manual review → deferred.
- **[reject·false] `useLocale() as Locale` unchecked cast in `LocaleToggle` (Edge Case + Blind Hunter).** Refuted: the active locale is always valid — `layout.tsx` guards `initialLocale` with `isLocale(...)??defaultLocale`, the provider's `useState` initializer guards again, and `setLocale` rejects non-locales; `NextIntlClientProvider` is fed only that validated value, so `useLocale()` can never return outside `locales`. The "no segment pressed" outcome is unreachable.
- **[reject·false] Cookie write not wrapped in try/catch → claimed race/divergence (Blind Hunter).** Refuted: `document.cookie =` is synchronous and executes before `router.refresh()` on the next line (no ordering race), and assigning `document.cookie` does not throw (it silently no-ops when cookies are disabled). The cookies-disabled case self-heals via the localStorage mount-reconcile, which re-runs `persistLocale` (rewriting the cookie). The proposed try/catch would not change behavior.
- **[reject·false] Mount reconcile fires a soft refresh "per page load" (Verification Gap note).** Refuted: the reconcile's `setLocale(next)` calls `persistLocale`, which rewrites the `NEXT_LOCALE` cookie; subsequent loads then find cookie == localStorage and do not re-trigger. It is effectively once (until the cookie is cleared again) and matches matrix row 2.
- **[reject·low] Cookie missing `Secure` (Edge Case + Blind Hunter).** `low`, rejected. The cookie holds only a non-sensitive UI preference (`en`/`fr`); plaintext exposure is immaterial. An unconditional `Secure` would break the cookie on localhost `http`, so a correct fix needs a protocol-check branch — more than a direct correction — against negligible harm.
- **[reject·low] No cross-tab `storage` listener → other tabs stay stale (Edge Case).** `low`, rejected. Requires two open app tabs with a switch in one; the stale tab self-heals on any navigation/refresh. Not in the story intent; the fix adds a new effect + listener (added complexity) against minor, self-correcting harm.
- **[reject·low] localStorage key reuses the cookie name `NEXT_LOCALE` (Blind Hunter).** `low`, rejected. Functionally correct; a developer-clarity nit with no named breakage. Renaming is churn without harm.

## Design Notes

- **Mechanism (why not a literal `setLocale`):** next-intl v4 in cookie mode has no client `setLocale`. The AC's `setLocale()` / <300ms / "no API" is realized by a client-driven `NextIntlClientProvider` whose `locale`/`messages` come from React state holding BOTH pre-loaded catalogs — a switch is a local state update (instant, no network). `router.refresh()` fires afterward only to reconcile the ~18 server-rendered (`getTranslations`) surfaces (nav labels, server pages); it is a soft RSC refresh that preserves client state and is **not** a page reload. Visible client content flips instantly; server chrome follows on the refresh.
- **No FOUC:** `<html lang>` and first paint come from the server cookie read; the `localStorage` reconciliation on mount only acts when the two disagree (e.g. cookie cleared).
- **Toggle shape (per web-uiux-architect — compact segmented control, zinc tokens for AA):**
```tsx
<div role="group" aria-label={t('label')} className="ml-auto inline-flex items-center gap-0.5 rounded-full border bg-muted/50 p-0.5">
  <Languages aria-hidden className="ml-1.5 size-4 text-muted-foreground" />
  {locales.map((loc) => (
    <button key={loc} type="button" aria-pressed={loc === active} onClick={() => setLocale(loc)}
      className={cn("rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        loc === active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
      {t(`locale.${loc}`)}<span className="sr-only">{t(`switchTo.${loc}`)}</span>
    </button>
  ))}
</div>
```

## Verification

**Commands:**
- `npm run type-check` -- expected: no errors
- `npm run lint` -- expected: clean
- `npm test` -- expected: new `LocaleProvider` tests pass, suite green
- `npm run build` -- expected: compiles (both catalogs client-bundled)

**Manual checks (Playwright MCP, localhost:3000, authed `/session-…` fixture):**
- On a dashboard screen with generated columns, activate the toggle EN→FR: client content re-labels in place with no full reload (URL unchanged, no navigation spinner) and nav labels follow; reload the page → still FR; DevTools shows `localStorage` locale set, `NEXT_LOCALE` cookie mirrored, and `<html lang>='fr'`. Confirm UI chrome switches while stored column labels/values stay as-generated (the rich path).
