---
title: 'Story 2.2: Passwordless Login for Returning Users'
type: 'feature'
created: '2026-09-25'
status: 'done'
route: 'dispatch'
baseline_commit: '659245ac0acf8dfcf255a4275af099e8ffce8714'
review_loop_iteration: 0
context:
  - '_bmad-output/implementation-artifacts/epic-2-context.md'
  - '_bmad-output/implementation-artifacts/spec-2-1-claim-app-via-magic-link.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 2.1 gave a first-time visitor a way to *claim* an app, but a user who already has an account and closes the tab has no way back in. There is no login entry point: the magic-link callback (`callback/route.ts:71-73`) rejects any link that lacks a `claim_token` with `?claim=error`, and middleware bounces unauthenticated tenant-route visits to the home page with no way to re-authenticate.

**Approach:** Add a passwordless returning-user login. A dedicated login entry point takes an email only (no password, no consent, no schema), dispatches a Supabase→Resend magic link via a new `POST /api/login`, and lands on a "check your email" state. The existing `/auth/callback` is extended so that a link with no `claim_token` is treated as a login: the authenticated user's primary org slug is resolved and they are redirected to their `/{slug}` dashboard. Middleware's unauthenticated redirect now points at the login entry point.

## Boundaries & Constraints

**Always:**
- Passwordless only — never request or accept a password. The login endpoint calls `signInWithOtp` and nothing else.
- The login `signInWithOtp` call MUST NOT pass `data: { role }` — a returning user (including an invited Member from Story 2.3) already carries their role in user metadata, and login must never clobber it. It also MUST NOT embed a `claim_token` in `emailRedirectTo` (that path is claim-only).
- **Anti-enumeration (decision):** the login call passes `shouldCreateUser: false`, and the endpoint ALWAYS returns the same "check your email" success response regardless of whether the email has an account — a login request must never reveal which emails are registered. A provider "signups not allowed"/no-user outcome is swallowed into the same success envelope (still logged via `reportError`), not surfaced as a distinct state.
- **Login entry point (decision):** a dedicated `/login` route hosts the form. Middleware's unauthenticated redirect points at `/login?auth=required`, `"login"` is added to `PUBLIC_TOP_LEVEL` so it is not treated as a tenant slug, and the home page carries an "Already have an account? Log in" link to it.
- The claim path in `/auth/callback` (the `claim_token` branch and `finalizeClaim`) is unchanged. Only the *no-token* branch (`callback/route.ts:71-73`) changes: resolve the authenticated user's org and redirect to `/{slug}`.
- Session continuity and route protection remain the Story 2.1 mechanism: `@supabase/ssr` cookie refresh in `src/middleware.ts`; `getCurrentUser()` validates the JWT (never trusts the cookie). No change to how sessions are refreshed.
- Every route returns the `{ data, error }` envelope; validate input with Zod; never leak raw stacks, SQL, or provider output. Expired/invalid links surface a clear, **translated** message with a re-request (fresh-link) path — never a raw error screen, reusing the existing `?claim=expired|error` status surface.
- All user-facing copy resolves through the `next-intl` layer in EN and FR — no hardcoded strings (a new `Login` namespace). New user-facing UI is built via the `web-uiux-architect` skill (Tailwind v4, Radix, Framer Motion, WCAG AA), reusing the existing `ui/` primitives and the `ClaimModal` error/"check your email" patterns.
- Same-browser PKCE constraint carries over from 2.1: the code exchange must complete in the browser that requested the link; a cross-device open lands on the existing "request a fresh link" path, not an error screen.

**Never:**
- No passwords, no OAuth/social login, no username accounts.
- No new database tables or migrations — membership already lives in `org_members` (created by `finalizeClaim`), resolved via `auth_org_ids()`.
- No team invites or role enforcement on other surfaces — those are Stories 2.3–2.4. This story only lets an existing user get back to their dashboard.
- No change to the claim flow, the consent gate, or `finalizeClaim`.
- No multi-org chooser UI: a returning user is routed to a single org (see Design Notes) — a picker is out of scope until multiple memberships are reachable (post-2.3).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid login request | POST /api/login `{email}` for an existing account | `signInWithOtp` sends a magic link (no claim_token, no role data); UI shows "check your email" | Resend/provider failure → 502 `{error:"sendFailed"}`, translated retry |
| Invalid email | POST with malformed email | Rejected before send | 400 `{error:"invalidEmail"}`; client shows inline `role="alert"` |
| Unknown email | POST for an email with no account | Same "check your email" success response as a valid request — no account created (`shouldCreateUser:false`), no existence disclosed | No-user/provider outcome logged, swallowed into success envelope |
| Click valid link (same browser) | GET /auth/callback with `code`, NO `claim_token` | `exchangeCodeForSession`; resolve user's primary org slug; redirect → `/{slug}` | Exchange fail → `?claim=expired` re-request path |
| Authenticated user, no membership | callback exchange succeeds but user is in no org | Redirect to a translated "no organization" status (re-request/claim path); no crash | No raw error screen |
| Expired / invalid login link | GET /auth/callback, exchange fails or no `code` | Translated "link expired" + re-request path; no session | Reuses existing `statusRedirect` |
| Unauthenticated hits `/{slug}` | protected route, no session | Redirect to `/login?auth=required` with a translated notice | No data leak (RLS still the hard gate) |

</frozen-after-approval>

## Code Map

- `src/app/auth/callback/route.ts` -- **modify** lines 71-73: the `if (!claimToken)` branch currently returns `statusRedirect(req, "error")`. Convert to the returning-user landing (resolve org slug → redirect `/{slug}`; no-membership → translated status). Leave the exchange, `finalizeClaim`, and metadata-write paths untouched. `statusRedirect(req, reason)` (lines 33-38) is reusable.
- `src/app/api/claim/route.ts` -- **template only** (do not change): the `signInWithOtp` call (lines 170-177), Zod pattern, `AppError`/`{data,error}` envelope, and `json()` helper are the shape the login route mirrors. Note it passes `shouldCreateUser:true` + `data:{role:'admin'}` + a `claim_token` redirect — the login route must NOT.
- `src/middleware.ts` -- **modify** the unauthenticated redirect (lines 71-75): repoint from `/?auth=required` to `/login?auth=required`. Add `"login"` to `PUBLIC_TOP_LEVEL` (line 26) so `/login` is not treated as a tenant slug.
- `src/lib/auth/session.ts` -- `getCurrentUser()` — reuse as-is; no change.
- `src/lib/claim/claim.ts` -- `readOrgSlug(adminClient, orgId)` (lines 134-148) is the pattern for the org→slug read; the new user→org resolver reuses it. `org_members` insert shape at lines 213-219 shows the membership row structure.
- `src/types/db.ts` -- `OrgMemberRow`, `OrganizationRow`, `MemberRole`, `PrincipalType`. No new type needed.
- `src/components/claim/ClaimModal.tsx` -- **reuse as the UI template** (lines 1-225): email input + `useId()` ARIA wiring, `ERROR_KEYS`/`resolveError` translation mapping (lines 43-68), inline `<p role="alert">` errors (lines 202-206), "check your email" success state (lines 125-137), form-reset-on-close (lines 74-82). Strip consent, schema, and intent.
- `src/components/ui/{input,label,button,dialog,form}.tsx` -- reusable shadcn/Radix primitives for the login form.
- `src/app/page.tsx` -- **modify**: add the "Already have an account? Log in" affordance linking to `/login`. `ClaimNotice` (lines 41-63) reads `?claim`/`?auth` and renders a translated `role="status"` notice; the `?auth=required` case now lives on `/login`, but keep the home handling intact (deep links may still carry it).
- `src/lib/i18n/{config.ts,request.ts,en.json,fr.json}` -- `next-intl`, cookie `NEXT_LOCALE`, flat namespaces. **Add** a `Login` namespace to en+fr; namespaces consumed via `useTranslations`/`getTranslations`.
- `src/lib/observability/report.ts` -- `reportError(err, ctx)` for provider/exchange failures, matching 2.1 usage.
- `tests/unit/route-claim.test.ts`, `tests/unit/route-callback.test.ts` -- existing route-test harness/precedent; new login/callback tests follow their style. (`vitest.config.ts` only includes `tests/**`.)

## Tasks & Acceptance

**Execution:**

- [x] `src/lib/auth/org.ts` -- New `resolveUserPrimaryOrgSlug(userId, adminClient)`: query `org_members` for the user's memberships, select the most-recent (`created_at DESC`), resolve `organizations.slug`, return `{ slug } | null`. Reuse the `readOrgSlug` read pattern. -- User→org resolution for post-login landing.
- [x] `src/app/api/login/route.ts` -- New `POST`: Zod-validate `{ email }`; call `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback` } })` via the RLS-scoped server client (same-browser PKCE); NO `claim_token`, NO `data.role`; ALWAYS return `{data:{sent:true},error:null}` on a well-formed request (anti-enumeration — a no-user/provider outcome is logged via `reportError` and swallowed into success); map bad email → 400 `invalidEmail`. Never leak provider output. -- Passwordless login dispatch.
- [x] `src/app/auth/callback/route.ts` -- Replace the no-`claim_token` branch (lines 71-73): call `resolveUserPrimaryOrgSlug(user.id, ...)`; on a slug redirect → `/{slug}`; on null (no membership) redirect to a translated status (`/login?login=no-org`). Claim-token path unchanged. -- Land returning users on their dashboard.
- [x] `src/middleware.ts` -- Repoint the unauthenticated protected-route redirect from `/?auth=required` to `/login?auth=required`; add `"login"` to `PUBLIC_TOP_LEVEL`. -- Send bounced users to the login entry point.
- [x] `src/components/auth/LoginForm.tsx` -- New email-only form built via `web-uiux-architect` (Tailwind v4, Radix, Framer Motion, WCAG AA): reuse `ui/` primitives + ClaimModal's error (`role="alert"`) and "check your email" patterns; NO consent, NO schema; POSTs to `/api/login`; success + error + reset states; all copy via `Login` namespace. -- The returning-user login UI.
- [x] `src/app/login/page.tsx` -- New route hosting `LoginForm`, wrapped by the root layout, rendering the translated `?auth=required` / `?login=no-org` status notice. -- The login entry point.
- [x] `src/app/page.tsx` -- Add a discoverable "Already have an account? Log in" affordance linking to `/login`. -- Discoverable login path.
- [x] `src/lib/i18n/en.json` & `src/lib/i18n/fr.json` -- Add a `Login` namespace (title, subtitle, email label/placeholder/invalid, submit, sent title/body, generic error, no-org message, `authRequired` notice, "log in" link/CTA). -- No hardcoded strings, EN+FR.
- [x] `tests/unit/route-login.test.ts` -- Vitest: valid-email dispatch calls `signInWithOtp` with `shouldCreateUser:false`, no `claim_token`, no role data; invalid email → 400 `invalidEmail`; unknown-email/no-user provider outcome still returns the `{data:{sent:true}}` success envelope (anti-enumeration); `{data,error}` envelope shape. -- Locks the login endpoint contract.
- [x] `tests/unit/route-callback-login.test.ts` (or extend `route-callback.test.ts`) -- Vitest: no-`claim_token` success resolves the org slug and redirects to `/{slug}`; no-membership redirects to the translated no-org status; missing `code`/failed exchange still hits the expired path; also unit-test `resolveUserPrimaryOrgSlug` (most-recent membership, null when none). -- Locks the callback login branch.

**Acceptance Criteria:**
- Given an existing account, when the user requests access with only their email at the login entry point, then a magic link is sent via the Supabase→Resend SMTP path over TLS and the UI confirms the email was sent — no password is ever requested (FR19).
- Given a delivered login link, when the user completes authentication in the same browser, then a cookie session is established and they are redirected to their `/{slug}` dashboard, resolved from their `org_members` membership — with no new org, no role change, and no claim finalized.
- Given an authenticated session, when the user navigates the app, then the session is maintained via `@supabase/ssr` refresh in `src/middleware.ts` and protected routes redirect unauthenticated users to the login entry point.
- Given an expired or invalid login link, when the user clicks it, then they see a clear translated message and can request a fresh link without an error screen.
- Given all login copy, when the locale is toggled to FR, then every string (form, states, errors, notices) renders translated with no hardcoded text.

## Implementation Notes

- **All 10 tasks implemented; all verification green** (2026-09-25): `type-check` clean, `lint` clean (no hardcoded-string flags), `test` 149/149 across 19 files, `test:rls` 5/5, `build` succeeds with `/api/login` and `/login` compiling as dynamic routes.
- **Callback login branch:** the no-`claim_token` branch (was `statusRedirect(req,"error")`) now resolves the user's org via `resolveUserPrimaryOrgSlug(user.id, createAdminClient())` and redirects to `/{slug}`; null membership → `/login?login=no-org`; a resolver throw → `?claim=error` (logged via `reportError`). The claim-token path, `finalizeClaim`, and the metadata write are untouched — the login-branch tests assert `finalizeClaim`/`updateUser` are never called.
- **Anti-enumeration:** `/api/login` surfaces only a malformed-email 400; every other outcome (including a provider "signups not allowed"/no-user error) is logged and swallowed into the identical `{data:{sent:true}}` envelope. `LoginForm` therefore lands unknown and registered emails on the same "check your email" state.
- **Matrix Test Audit — added `tests/unit/middleware.test.ts`:** the implementation subagent covered matrix rows 1–6 but left row 7 (unauthenticated `/{slug}` → `/login?auth=required`) uncovered — 2.1 had no middleware test harness. Since repointing that redirect is a core 2.2 deliverable, I added a middleware unit test (mocking `@supabase/ssr` `getUser`) covering: unauth protected slug → `/login?auth=required`; authenticated slug → pass-through; `/login` treated as public (not bounced to itself). +3 tests (146 → 149).
- **Test placement:** `resolveUserPrimaryOrgSlug` unit tests live in `tests/unit/auth-org.test.ts` (not inside `route-callback-login.test.ts`) because the callback test must `vi.mock("@/lib/auth/org")`, which would shadow the real resolver. The spec's task allowed "or extend"; this satisfies both required coverages. The obsolete "no claim_token → ?claim=error" assertion was removed from `route-callback.test.ts` (that behavior moved to the login branch).
- **Minor:** `LoginForm.ERROR_KEYS` and the `Login.error.sendFailed` i18n key are retained for completeness though the anti-enumeration endpoint never returns `sendFailed` — harmless dead branches kept parallel to `ClaimModal` for future non-swallowed error paths.
- **Deferred / ops (not code gaps, carried from 2.1):** the live magic-link round trip was not exercised end-to-end — it requires Supabase custom SMTP (Resend/scheza.com) configured and the `20260924060000_pending_claims.sql` migration applied to the shared DB. Login adds NO new migration (per the "Never" constraint). The manual browser walkthrough on localhost:3000 was not performed in this session.

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-09-25). Three independent context-free layers (blind-hunter, edge-case-hunter, verification-gap) were dispatched against the staged diff; per the human's explicit instruction to continue, triage proceeded on the candidate findings already in hand — the implementation subagent's own three-angle self-review plus a direct diff verification against on-disk code — rather than blocking on the async layers. Every verdict below was verified at its cited location against the current tree. All five Verification gates are green (type-check, lint, test 151/151, test:rls 5/5, build).

**Resolved in-tree (patch, already applied):**
- `medium` — `POST /api/login` swallowed EVERY `signInWithOtp` error into the 200 `{sent:true}` envelope, so a genuine Resend/SMTP outage told the user "check your email" for a mail that would never arrive — a direct deviation from frozen I/O matrix row 1 (`provider failure → 502 sendFailed`). The frozen anti-enumeration bullet mandates swallowing only the *no-user / "signups not allowed"* outcome. Fixed by `isNoUserOutcome()` in `src/app/api/login/route.ts`: enumeration-revealing markers are logged + swallowed (anti-enumeration preserved); any other `otpError` surfaces `502 sendFailed`. Covered by new tests (transport-failure → 502; throw → 500 no leak; unknown-email → 200 swallow still passes). Spec was correct, so no Spec Change Log entry; no loopback.

**Rejected:**
- `low` — `LoginForm` "sent" state offers no in-page way to correct a mistyped email (must reload `/login`): verified — but for a full-page form (unlike the 2.1 modal) reloading/navigating to `/login` is the natural retry; adding a "use a different email" affordance is new surface for a rarely-hit case.
- `low`/`maybe-false` — `isNoUserOutcome` couples to Supabase's specific unknown-user markers; a future provider code change could 502 an unknown email (a partial enumeration signal): the markers match Supabase's real `shouldCreateUser:false` messages today, and a genuine send failure also 502s for a KNOWN email, blunting any signal. Broadening the match adds coupling for an unlikely case.
- `low`/`false` — `resolveUserPrimaryOrgSlug` returns null when the resolved org has no slug, routing a real member to the no-org status: refuted as reachable — `finalizeClaim` always provisions a slug before a membership is usable, so a slug-less claimed org is not reachable; the resolver already `reportError`s on genuine read errors.

**Deferred:** none new. (Pre-existing from 2.1 and out of scope here: no rate limiting on the auth endpoints; middleware treats an auth-server error as unauthenticated — the safe default.)

## Design Notes

**One org, no picker (MVP).** A returning user who claimed in 2.1 has exactly one `org_members` row (admin). Invited members (2.3) also join a single org. Genuine multi-org membership is not reachable until later, so login resolves to the most-recent membership and redirects there; a chooser is deferred (see Never). `resolveUserPrimaryOrgSlug` centralizes this so a future picker has one call site to change.

**Login is claim's mirror, minus the bootstrap.** The login endpoint is deliberately a thin `signInWithOtp` — no `pending_claims` row, no schema write, no service-role bootstrap. The only shared machinery is the callback's `exchangeCodeForSession` and the same-browser PKCE constraint. Keeping the claim-token branch untouched preserves the 2.1 guardrails verbatim.

**Resend is SMTP config, not app code.** As in 2.1, the magic-link email is sent by Supabase Auth over the project's custom SMTP (Resend/scheza.com); app code only calls `signInWithOtp`. The SMTP setting is a pre-existing ops dependency, not a task here.

## Verification

**Commands:**
- `npm run type-check` -- expected: no TS errors.
- `npm run lint` -- expected: clean (`eslint-plugin-i18next` flags any hardcoded user-facing strings).
- `npm run test` -- expected: all vitest suites pass, including the new login + callback tests.
- `npm run test:rls` -- expected: RLS isolation still green (middleware/session changes must not regress isolation).
- `npm run build` -- expected: production build succeeds (new `/api/login` and login entry point compile).

**Manual checks:**
- With the app running (single dev server on http://localhost:3000, browser MCP): claim an app (2.1 flow), open a fresh browser context, visit `/{slug}` → confirm redirect to the login entry point; request a login link, complete it in the same browser, confirm landing back on `/{slug}` with the live schema. Toggle locale to FR and confirm all login copy is translated. Confirm an expired/invalid link shows the translated re-request path.
- Confirm Supabase Auth custom SMTP (Resend/scheza.com) is configured for the target environment.
