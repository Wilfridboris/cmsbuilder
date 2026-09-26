---
title: 'Story 2.4: Role-Based Access Enforcement'
type: 'feature'
created: '2026-09-25'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '39d0bb9b8b8303425c8cd7f0a574621b56f0e5cc'
context:
  - '_bmad-output/implementation-artifacts/epic-2-context.md'
  - '_bmad-output/implementation-artifacts/spec-2-3-invite-team-members-with-roles.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 2.3 introduced two roles (`admin`/`member`) and gated the single admin action that exists today (`POST /api/invite`), but the admin check is inlined and duplicated, there is no dashboard navigation at all, and no place systematically prevents a Member from reaching Admin-only surfaces. As later epics add Admin-only surfaces (Conversational Editor, Billing, schema mutation, settings), each would re-invent the check — the exact drift RBAC must prevent.

**Approach:** Establish the epic's RBAC spine: one reusable server-side enforcement primitive that resolves the caller's org membership and rejects a non-Admin with `403`, and refactor the two existing inlined admin checks (invite bootstrap + Settings page) onto it. Add a role-aware dashboard navigation (a new `[slug]` layout + server-rendered nav) that shows Admin-only links to Members-hidden surfaces only when the caller is an Admin. Members retain full record view/add/edit; the guard becomes the single seam every future Admin-only route and nav entry reuses.

## Boundaries & Constraints

**Always:**
- **Server-enforced, never UI-only.** Every current and future schema-mutation, invite, billing, or settings API route rejects a non-Admin with `403 forbidden` and an unauthenticated caller with `401 unauthorized`, independent of any UI hiding. Frontend hiding is a UX affordance, never the sole gate.
- **One enforcement primitive.** A single reusable guard is the authority for "caller must be Admin of their org." The existing inlined checks in `inviteMember` and the Settings page are refactored to call it; no new divergent check is introduced.
- **Role is resolved authoritatively from `org_members`** via `resolveUserOrgMembership` (not the JWT `user_metadata` convenience copy), so the guard has one source of truth consistent with 2.3 and immune to a stale JWT after any future role change. (Decision: role-source = DB read.)
- **Roles remain exactly `admin | member`.** The account creator stays Admin (Story 2.1); this story adds no role-change, member-list, or revoke capability.
- **Members keep record access.** A Member can still view, add, and edit records; nothing here restricts the data surfaces. Only Admin-only surfaces are gated/hidden.
- **UI copy via next-intl (EN+FR)**, accessible (WCAG AA), built with the `web-uiux-architect` skill reusing `src/components/ui/` primitives. Every route keeps the `{ data, error }` envelope; never leak provider output, stacks, or SQL.

**Never:**
- **No new database tables or migrations.** `org_members.role` already carries the authority and RLS resolves via `auth_org_ids()`.
- **No changes to `mutate.ts`.** It stays identity-agnostic; org scoping remains RLS's job and Members legitimately write records.
- **No gating of surfaces that do not exist yet.** The nav links only Admin surfaces that exist today (Settings/Invite). Conversational Editor (Epic 5) and Billing (Epic 7) have no pages; do not create placeholder pages, disabled placeholders, or dead/404 nav links for them — those epics add their own nav entries behind this same guard. (Decision: nav scope = existing surfaces only.)
- **No changes to claim, login, `/auth/callback`, or `/auth/confirm`.** No middleware role enforcement (middleware stays session-refresh + slug protection only).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin calls a guarded route | Admin session, `POST /api/invite` | guard resolves membership, proceeds | — |
| Member calls a guarded API route | Member session, `POST /api/invite` | rejected before any side effect; no row, no email | `403 forbidden` (translated) |
| Unauthenticated calls a guarded route | no session | rejected | `401 unauthorized` |
| Session user with no membership | valid session, no `org_members` row | treated as non-Admin, rejected | `403 forbidden` |
| Member views dashboard | Member role | records visible/editable; Admin-only nav links (Settings) absent | — |
| Admin views dashboard | Admin role | all Admin-only nav links visible and functional | — |
| Locale toggled to FR | any role | every nav/gate string renders translated | — |

</frozen-after-approval>

## Code Map

- `src/lib/auth/org.ts` -- `resolveUserOrgMembership(userId, adminClient)` (89-129) returns `ResolvedMembership = { orgId, slug, role }` (type at :76). The building block the guard wraps; two-read pattern (`org_members` → `organizations`).
- `src/lib/auth/session.ts` -- `getCurrentUser()` (19-28), JWT-validated `User | null`; identifies the caller.
- `src/types/api.ts` -- `ApiResponse<T>` (9-12) and `AppError(statusCode, userMessage, message?)` (15-25); the guard throws `AppError(403,'forbidden')` / `AppError(401,'unauthorized')`.
- `src/types/db.ts` -- `MemberRole = "admin" | "member"` (:81).
- `src/lib/invite/invite.ts` -- **refactor.** Inlined admin check at 106-109 (`if (!membership || membership.role !== 'admin') throw new AppError(403,'forbidden')`) becomes a call to the new guard; behavior identical.
- `src/app/api/invite/route.ts` -- **verify only.** Route contract (48-96): `getCurrentUser` → Zod → `inviteMember` → `{data,error}`; still 403s a Member through the refactored guard.
- `src/app/[slug]/settings/page.tsx` -- **refactor.** Inlined admin gate at 43-45 (redirect on non-admin) reuses the guard's resolution; keeps the redirect UX (page gate, not a thrown 403).
- `src/app/[slug]/page.tsx` -- **verify.** Read-only dashboard (27-144); does not resolve role today; will render inside the new layout.
- `src/app/[slug]/layout.tsx` -- **new.** Server layout wrapping `/{slug}` + children; resolves membership once and renders `DashboardNav` above the page.
- `src/components/layout/DashboardNav.tsx` -- **new** (dir currently `.gitkeep` only). Server component; dashboard link for all, Admin-only links gated on `role === 'admin'`.
- `src/components/ui/{button,card}.tsx` -- primitives for nav styling.
- `src/lib/i18n/{en.json,fr.json}` -- add a `DashboardNav` namespace (EN+FR); mirror the `Settings`/`SlugDashboard` namespace shape.
- `src/lib/supabase/admin.ts` -- `createAdminClient()` (16-32) for the guard's membership read; `server.ts` `createServerSupabaseClient` (22-51) for page/layout reads.
- `src/middleware.ts` -- **no change** (37-96); session refresh + slug protection only, no role enforcement.
- `tests/unit/{route-invite,auth-org}.test.ts` -- harness precedent (mock supabase + `next/headers`, keep session logic real); `vitest.config.ts` includes `tests/**`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/auth/rbac.ts` -- New `requireAdmin(user, adminClient)` (or equivalent): resolves the caller's membership authoritatively via `resolveUserOrgMembership` and returns `ResolvedMembership` when the caller is an Admin of their org; throws `AppError(401,'unauthorized')` when `user` is null and `AppError(403,'forbidden')` when there is no membership or `role !== 'admin'`. -- The single reusable server-side enforcement primitive (DB-backed role).
- [x] `src/lib/invite/invite.ts` -- Replace the inlined admin check (106-109) with a call to `requireAdmin`; keep the same 403/`forbidden` outcome and the rest of `inviteMember` unchanged. -- Refactor onto the shared guard.
- [x] `src/app/[slug]/settings/page.tsx` -- Reuse the guard's resolution for the admin gate (43-45), preserving the redirect-to-`/{slug}` UX on non-admin / slug mismatch (no thrown 403 on the page). -- Second call site onto the shared guard.
- [x] `src/components/layout/DashboardNav.tsx` -- New server component via `web-uiux-architect` (Tailwind v4, WCAG AA): dashboard link for everyone; Admin-only link(s) to existing Admin surfaces (Settings) rendered only when `role === 'admin'`; all copy via the `DashboardNav` namespace. -- Role-aware navigation (UI hiding).
- [x] `src/app/[slug]/layout.tsx` -- New server layout: `getCurrentUser` → resolve membership once → render `DashboardNav` (passing role) above `{children}`; unauthenticated handling continues to defer to middleware. -- Hosts the nav for `/{slug}` and its subpages.
- [x] `src/lib/i18n/en.json` & `src/lib/i18n/fr.json` -- Add a `DashboardNav` namespace (dashboard + Admin-only labels) in EN+FR. -- No hardcoded strings.
- [x] `tests/unit/rbac.test.ts` -- Vitest for `requireAdmin`: Admin → returns membership; Member → 403 `forbidden`; null user → 401 `unauthorized`; no membership → 403; and assert `POST /api/invite` still rejects a Member with 403 through the refactored path. -- Locks the enforcement primitive + the invite regression.
- [x] `tests/unit/dashboard-nav.test.tsx` -- Vitest for `DashboardNav` (added during the Matrix Test Audit to cover the three UI matrix rows): Member → Settings link absent (dashboard present); Admin → Settings link present; FR locale → nav copy renders translated. -- Locks the UI-hiding + i18n rows.

**Acceptance Criteria:**
- Given a Member, when a request hits any guarded API route (invite today, plus any future schema-mutation/billing/settings route that calls the guard), then the caller's role is verified server-side and the request is rejected with `403` and no side effect — frontend hiding is never the sole enforcement (FR24).
- Given an Admin, when they use the dashboard, then all Admin-only surfaces that exist are available and the account creator retains Admin (Story 2.1).
- Given a Member, when they use the dashboard, then Admin-only navigation (Settings/Invite) is hidden while records remain viewable, addable, and editable (FR23).
- Given the two pre-existing inlined admin checks, when this story lands, then both invoke the single reusable guard and behave identically to before (no regression in the invite 403 path).
- Given all new navigation copy, when the locale is toggled to FR, then every string renders translated with no hardcoded text.

## Implementation Notes

- **All 8 tasks implemented; all five gates green** (2026-09-25, verified against the staged diff, re-run after the review-pass-1 patch): `type-check` clean, `lint` clean (no hardcoded-string flags; only the pre-existing eslintrc deprecation warning), `test` 187/187 across 24 files, `test:rls` 5/5 (Member record access not regressed), `build` succeeds with `/[slug]/layout`, the nav, and `/api/invite` compiling. `npx next typegen` was run once to refresh Next's generated route-type validator after adding the new layout (generated output, not a source edit).
- **Review pass 1 patch applied:** added `tests/unit/settings-page.test.tsx` to lock the Settings-page redirect gate (unauthenticated→`/login`, Member/non-member 403→`/{slug}`, cross-org Admin slug-mismatch→`/{slug}`, same-org Admin→renders `InviteForm`, non-AppError→re-throw). See the Review Triage Log for the full disposition of all 14 findings (1 patch, 13 rejected; no loopback).
- **Matrix Test Audit added `tests/unit/dashboard-nav.test.tsx`.** The implementation subagent covered the four guard/API matrix rows in `rbac.test.ts` but not the three UI rows (Member/Admin nav visibility, FR translation). The audit added a component test that invokes the async server component and walks its element tree (node env, no DOM), mocking `next-intl/server` with a swappable dictionary. All three UI rows now have a covering test that ran and passed.
- **`requireAdmin` takes a `User`; `inviteMember` only holds `inviterUserId`**, so it passes `{ id: inviterUserId } as User`. Safe because the guard reads only `user.id` (and the null check, which the route's 401 already precludes), but a minor cast worth noting for anyone widening the guard's `User` usage later.
- **Settings page keeps its redirect UX** by catching only `AppError` from `requireAdmin` → `redirect('/{slug}')` and re-throwing anything else; the slug-mismatch bounce is preserved. The invite ACTION remains independently re-enforced by the same guard in `POST /api/invite`.
- **Manual browser-MCP walkthrough not run this session** (no dev server started): the live Admin/Member dashboard pass, the FR toggle, and a direct `/api/invite` 403 as a Member are covered by unit tests + build but the live UX pass in the acceptance criteria remains unexercised.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-09-25). Three context-free layers (blind-hunter, edge-case-hunter, verification-gap) ran against the staged diff. Every verdict below was verified at its cited location against the current tree. No `intent_gap`/`bad_spec` (no loopback).

**patch (applied):**
- `low` — the Settings-page admin-gate refactor (`settings/page.tsx`: `try requireAdmin → catch AppError → redirect`, re-throw non-AppError, separate `slug !== slug` bounce) is exercised by no test — `rbac.test.ts` tests the guard in isolation, `route-invite.test.ts` tests the invite site, but the page's own redirect wiring runs in no test, so a future edit could expose Settings to a non-admin/cross-org caller without failing the suite. Verified: no `tests/**` file imports the settings page. (blind B5 + verification-gap V1, pre-verified → patch.) Fix: add a settings-page test asserting redirect for Member/non-member/cross-org Admin and render for a same-org Admin.

**Rejected:**
- `false` — "guard's `SupabaseClient` param loses `<Database>` type safety" (blind B3): verified the whole codebase types the admin client as bare `SupabaseClient` (claim.ts, invite.ts, org.ts, mutate.ts, seed.ts, provision.ts) — there is no typed-client convention to mirror; `requireAdmin` is consistent.
- `false` — "Settings catch redirects a 401 to the protected `/{slug}` instead of `/login`" (blind B4): the page's own `getCurrentUser()` null-check redirects to `/login?auth=required` before `requireAdmin` is called, so `requireAdmin` receives a non-null user and can only ever throw 403 into the catch — the 401 path is unreachable there.
- `false`/not-a-regression — "Settings re-throws a non-AppError (DB fault) as a raw error" (edge E3): `resolveUserOrgMembership` already throws a plain `Error` on DB failure (org.ts:101-103,119-121), and the pre-refactor page called it directly with no catch — behavior is identical; re-throwing to Next's error boundary is intentional.
- `low` — invite passes `{ id: inviterUserId } as User`, so the guard's `!user` 401 can't fire at that site and an empty id would run an empty-id read instead of 401 (blind B2 / edge E4): unreachable — `/api/invite/route.ts` 401s a null caller and passes a real `user.id`; the smallest fix threads the real `User` through `inviteMember` (public-signature change), so rejected per the low rule.
- `low` — layout omits the nav for a legitimate member of `{slug}` whose most-recent membership is a different org (blind B1 / edge E1 / verification-gap V2): multi-org membership is out of scope today (Story 2.3: single inviting org, no multi-org chooser), so unreachable; the nav is a soft UX gate and `[slug]/page.tsx` independently bounces a cross-org/non-member viewer under RLS; fix (a slug-scoped resolver) adds surface. Worth revisiting when multi-org lands.
- `low` — layout throws (crashes the `/{slug}` subtree) if `resolveUserOrgMembership` errors rather than returns null (edge E2): a DB-outage failure class already present at the page's own reads; swallowing it would hide real errors. Not everyday.
- `low` — the FR test mocks `getTranslations` so it doesn't prove the real `en.json`/`fr.json` keys resolve, and `not.toContain("Dashboard")` is brittle (blind B6): the diff shows both files gained matching `DashboardNav` namespaces (`label`/`dashboard`/`settings`), and next-intl throws on a missing key at runtime; adding an i18n-parity test is complexity for a negligible gap.
- `low` — nav lacks `aria-current` active-link indication (blind B7): not a WCAG AA failure (the nav has a labelled landmark, focus rings, `aria-hidden` icons); adding it needs the current pathname (client component / prop), i.e. complexity for an enhancement.
- rejected (edits this build's spec) — "Spec Change Log / Review Triage Log left empty" (blind B8): expected state on a first review pass with no bad_spec loopback (this log is being written now); the fix would edit this spec.

## Design Notes

- **Guard, not middleware.** Enforcement stays at the route/business-logic layer where `org_members` is resolvable; `middleware.ts` stays session-refresh + slug protection only (it excludes `/api/*`), matching 2.3's enforcement location.
- **Server-rendered nav.** Role never reaches the client today (no provider). Resolving membership in the server layout keeps role off the client and avoids a new `GET /api/membership` round-trip — Members simply never receive the Admin links in their HTML.

## Verification

**Commands:**
- `npm run type-check` -- expected: no TS errors.
- `npm run lint` -- expected: clean (`eslint-plugin-i18next` flags any hardcoded user-facing strings in the new nav).
- `npm run test` -- expected: all vitest suites pass, including the new `rbac` tests and the unchanged invite suite.
- `npm run test:rls` -- expected: RLS isolation still green (Member record access must not regress).
- `npm run build` -- expected: production build succeeds (`/[slug]/layout` and the nav compile).

**Manual checks:**
- With the app running (single dev server on http://localhost:3000, browser MCP): as an Admin, confirm the Settings link is visible and reachable; as a Member (invited teammate), confirm the Settings/Invite link is absent and that hitting `/api/invite` directly returns 403; confirm a Member can still view/add/edit records. Toggle locale to FR and confirm all nav copy is translated.
