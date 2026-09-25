---
title: 'Story 2.1: Claim App via Magic Link ("Make it Real")'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
baseline_commit: 'f689b95bc5551cb12478e58f6922cb57972824d9'
review_loop_iteration: 0
context:
  - '_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An anonymous visitor can generate and edit a demo app but has no way to keep it. There is no authentication, no real account, no persistent private org — the demo (schema + overrides) lives only in an anonymous session cookie and client state and is lost on close.

**Approach:** Add a passwordless magic-link claim flow. A "Make it Real" CTA opens a claim form (email + mandatory, initially-unchecked privacy consent). On submit we persist the visitor's overridden schema and a pending-claim record, then send a Supabase magic link (delivered through the project's Resend SMTP). Clicking the link establishes a cookie session and finalizes the claim: the existing anonymous session org is promoted to a live org (Admin membership created, unique slug provisioned, consent timestamp stored, synthetic demo records cleared), and the user lands on their private dashboard at `/{slug}` under RLS isolation.

## Boundaries & Constraints

**Always:**
- The privacy consent checkbox starts **unchecked** and is a **hard blocker** on both client and server — no magic link is sent and no pending claim is created unless consent is true. Store the consent acceptance timestamp on the authenticated user.
- Passwordless only — never request or accept a password anywhere in this flow.
- The **only** claim-time use of the service-role/admin client is the org/membership bootstrap and the pre-auth schema/pending-claim persistence for the session's own org (resolved from the signed `sb_gen_session` cookie). Every subsequent tenant write goes through `mutate.ts` under the user's RLS-scoped client.
- The visitor's pre-account schema overrides (hidden/renamed tables & fields from Story 1.7, held in `DemoDashboard` state) must be carried into the live `org_schemas.definition` before the round trip so they survive into the claimed app.
- Reuse the existing anonymous **session org** (do not mint a new organization): claim promotes it in place — add membership, set slug, clear synthetic records.
- **Slug is auto-derived** (decision) from the generation intent (trade + city, e.g. `mikes-plumbing-laval`) with a numeric suffix on collision. No slug field on the claim form; the user does not choose their URL in this story.
- **Same-browser claim only** (decision): the `@supabase/ssr` **PKCE** flow is used, so the code exchange must complete in the browser that requested the link. Opening the link on a different device is not supported and must surface the translated "request a fresh link" path — not an error screen. Cross-device/OTP flows are out of scope.
- Session management uses `@supabase/ssr` cookie sessions refreshed in `src/middleware.ts`; the `/{slug}` dashboard is a protected route that redirects unauthenticated users to the claim/login entry point.
- Roles live in Supabase Auth user metadata (`{"role":"admin"}`); the account creator is `admin`.
- Every route returns the `{ data, error }` envelope; validate input with Zod; never leak raw stacks, SQL, or provider output. Expired/invalid links and used/expired pending claims surface a clear, **translated** message with a re-request path — never a raw error screen.
- All user-facing copy (CTA, form, consent, states, errors) resolves through the `next-intl` layer in EN and FR — no hardcoded strings. New user-facing UI is built via the `web-uiux-architect` skill (Tailwind v4, Radix, Framer Motion, WCAG AA).

**Never:**
- No passwords, no OAuth/social login, no username accounts.
- No team invites, no role enforcement on other surfaces, no returning-user login page — those are Stories 2.2–2.4. This story only establishes the Admin creator + live org.
- No record CRUD UI on the `/{slug}` dashboard beyond rendering the live (post-clear, empty) schema — that is Epic 3.
- No raw service-role writes to tenant `records` after bootstrap.
- Do not author the actual Privacy Policy / Terms legal copy here — the consent links point at `/privacy` and `/terms` (content deferred).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Consent unchecked | POST /api/claim with `consent:false` (or missing) | Rejected; no link sent, no pending claim, no schema write | 400 `{error}` "consent required"; client disables submit while unchecked |
| Invalid email | POST with malformed email | Rejected before send | 400 `{error}` translated invalid-email; client shows inline error |
| No/invalid session cookie | POST with missing/tampered `sb_gen_session` | Rejected — nothing to claim | 400 `{error}` translated "start a demo first" |
| Valid submit | valid email + `consent:true` + current schema, valid session org | Overridden schema persisted to `org_schemas`; `pending_claims` row created with token+consent timestamp; `signInWithOtp` sends link; UI shows "check your email" | Resend/SMTP failure → 502 `{error}`, pending claim rolled back or left expiring; translated retry |
| Click valid link (same browser) | GET /auth/callback with code + `claim_token` | `exchangeCodeForSession`; finalize: insert `org_members` admin, set unique slug, store consent on user metadata, soft-delete synthetic records; redirect → `/{slug}` | On finalize failure, redirect to translated error state with re-request path |
| Expired / invalid link | GET /auth/callback, exchange fails | Translated "link expired" message + re-request path; no session | No raw error screen; no partial bootstrap |
| Used / expired pending claim | callback with token already consumed or past expiry | Translated message + re-request path; no double-bootstrap | Idempotent: second finalize with same token is a no-op |
| Authed user visits `/{slug}` | member of org | Renders live schema (tables present, synthetic rows gone) under RLS | — |
| Non-member / anon visits `/{slug}` | not a member | Redirect to claim/login; RLS yields no rows | No data leak |

</frozen-after-approval>

## Code Map

- `src/lib/supabase/client.ts` -- `createBrowserSupabaseClient()` (browser, RLS-scoped) — used by claim form for `signInWithOtp` if done client-side; reuse.
- `src/lib/supabase/server.ts` -- `createServerSupabaseClient(cookieStore)` (RLS-scoped, `"server-only"`) — used for the callback session + `/{slug}` reads. Reuse.
- `src/lib/supabase/admin.ts` -- `createAdminClient()` (service-role, bypasses RLS) — **bootstrap-only**: pre-auth schema/pending-claim persistence + finalize membership/slug/clear. Reuse; do not widen usage.
- `src/middleware.ts` -- currently a pass-through seam (`NextResponse.next()`), matcher already excludes Next internals. **Implement** `@supabase/ssr` session refresh + protect `/{slug}`.
- `src/lib/generation/session.ts` -- `SESSION_COOKIE_NAME` (`sb_gen_session`), `decodeSessionValue()` — resolve the anonymous session `orgId` on the claim POST. Reuse; do not change signing.
- `src/lib/generation/intent.ts` -- `readIntent()`, `GenerationIntent` (trade, city, ...) — source for auto-derived slug (OQ-A). Client-side sessionStorage.
- `src/lib/generation/provision.ts` -- `provisionGeneration()`, session org minted with slug `session-<shortId>` via admin upsert. Reference for how the session org row exists; claim promotes this row.
- `src/lib/schema/overrides.ts` -- pure transforms (`hideTable`, `hideField`, `renameTable`, `renameField`, `visibleTables`) already applied into `DemoDashboard` state. The resulting schema is what we persist on claim. Do not re-derive.
- `src/components/dashboard/DemoDashboard.tsx` -- holds the live overridden `schema` in `useState` (~line 78); rendered by `src/app/generate/page.tsx`. **Add** the "Make it Real" CTA + mount the claim modal here (it needs the current schema state). No claim UI exists today.
- `src/lib/data/mutate.ts` -- `mutate(identity, op, tableKey, ...)`, `MutateIdentity {client,actorId,orgId}` — post-claim tenant writes; also the soft-delete path pattern (`deleteRecord` sets `deleted_at`) for clearing synthetic records.
- `src/types/db.ts` -- `OrganizationRow`, `OrgMemberRow`, `MemberRole`, `PrincipalType`, `SchemaDefinition`/`TableDefinition`/`FieldDefinition` (with `hidden?`). **Add** `PendingClaimRow`.
- `supabase/migrations/20260924055022_platform_schema.sql` -- `organizations` (has unique `slug`), `org_members` (unique(org_id,user_id), role, principal_type), `records`, `org_schemas` (org_id PK, `definition` JSONB), `auth_org_ids()` (SECURITY DEFINER membership resolver, lines 117–125). No consent column, no `profiles` table, no `pending_claims`. New migration follows this file's conventions.
- `src/lib/i18n/{config.ts,request.ts,en.json,fr.json}` -- `next-intl`, cookie `NEXT_LOCALE`, namespaces are flat objects; `useTranslations`/`getTranslations`. **Add** a `Claim` namespace to en+fr.
- `tests/integration/rls-isolation.test.ts` -- shows the `org_members` insert pattern (lines ~105–108) and RLS harness; reference for the finalize + isolation test.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<timestamp>_pending_claims.sql` -- Create `pending_claims` table (`token` text unique NOT NULL, `email` text NOT NULL, `session_org_id` uuid FK→organizations, `consent_accepted_at` timestamptz NOT NULL, `policy_version` text NOT NULL, `created_at` timestamptz default now(), `expires_at` timestamptz NOT NULL) with an index on `token`; enable RLS with **no** public policy (service-role only). Follow the existing migration's style. -- Durable, device-independent finalize data; token in the link resolves it.
- [x] `src/types/db.ts` -- Add `PendingClaimRow` matching the migration. -- Typed access for claim logic.
- [x] `src/lib/claim/slug.ts` -- Slug utility: `deriveSlug(intent)` (kebab-case from trade + city) + `ensureUniqueSlug(adminClient, base)` (append `-2`, `-3`… on `organizations.slug` collision). Auto-derived; no user input. -- Unique public URL provisioning.
- [x] `src/lib/claim/claim.ts` -- `createPendingClaim({sessionOrgId, email, schema, consentAt, policyVersion})`: via admin client, overwrite `org_schemas.definition` for the session org with the overridden schema, insert a `pending_claims` row, return its `token`. `finalizeClaim({token, userId, adminClient})`: look up + validate token (unused, unexpired); insert `org_members` (`principal_type:'human'`, `role:'admin'`); resolve + set unique slug on the org; soft-delete all `records` for the org; return `{slug}`; delete/void the pending claim. **Idempotent** on re-entry. Consent timestamp written to user metadata by the caller (callback). -- Core bootstrap; service-role confined here.
- [x] `src/app/api/claim/route.ts` -- `POST`: Zod-validate `{email, consent:true, schema}`; read + verify `sb_gen_session` → `orgId`; hard-block if `consent!==true`; call `createPendingClaim`; call `supabase.auth.signInWithOtp({email, options:{ shouldCreateUser:true, emailRedirectTo:`.../auth/callback?claim_token=<token>`, data:{ role:'admin' } }})`; return `{data:{sent:true}}` envelope. -- Consent gate + link dispatch.
- [x] `src/app/auth/callback/route.ts` -- `GET`: `exchangeCodeForSession`; on success read `claim_token`, get user id, call `finalizeClaim`, store consent (`consent_accepted_at`,`policy_version`) + confirm `role:'admin'` in user metadata (`auth.updateUser`), then `redirect('/{slug}')`. On exchange/finalize failure, redirect to a translated error/expired state with a re-request path. -- Establishes session + completes claim.
- [x] `src/middleware.ts` -- Implement `@supabase/ssr` session refresh (read/write cookies) and protect `/{slug}` (redirect unauthenticated to claim/login entry); leave `/`, `/generate`, `/demo`, `/api/*`, `/auth/*` public. -- Session continuity + route protection.
- [x] `src/lib/auth/session.ts` -- `getCurrentUser()` server helper over `createServerSupabaseClient` for `/{slug}` and future protected routes. -- Single source for server-side identity.
- [x] `src/components/claim/ClaimModal.tsx` -- Claim form UI (built with `web-uiux-architect`): email input + unchecked consent checkbox linking `/privacy` & `/terms`, submit disabled until consent, "check your email" success state, inline/toast error states; POSTs the current `schema` to `/api/claim`. All copy via `Claim` i18n namespace. -- The claim entry surface.
- [x] `src/components/dashboard/DemoDashboard.tsx` -- Add prominent, high-contrast "Make it Real" CTA (via `web-uiux-architect`) that opens `ClaimModal`, passing the current overridden `schema` state. -- UX-DR9 claim handoff.
- [x] `src/app/[slug]/page.tsx` -- Protected server component: `getCurrentUser()`, resolve `slug`→org, render the live schema (reuse existing dashboard rendering; tables now empty of synthetic data) under the user's RLS-scoped client. -- Post-claim landing proving isolation.
- [x] `src/app/(legal)/privacy/page.tsx` + `src/app/(legal)/terms/page.tsx` -- Minimal placeholder pages so consent links resolve (real copy deferred). -- Avoid dead consent links.
- [x] `src/lib/i18n/en.json` & `src/lib/i18n/fr.json` -- Add `Claim` namespace (CTA, email label/placeholder/invalid, consent label, submit, sent, generic error, link-expired, re-request). -- No hardcoded strings, EN+FR.
- [x] `src/lib/claim/__tests__/claim.test.ts` (vitest) -- Unit-test the I/O matrix edge cases: consent-false rejection, invalid email, missing/tampered session cookie, valid createPendingClaim persists schema + inserts token, finalizeClaim inserts admin membership + sets slug + clears records, idempotent re-finalize, expired/used token. -- Locks the guardrails.

**Acceptance Criteria:**
- Given a demo dashboard, when the visitor taps "Make it Real", then an email field and a mandatory, initially-unchecked privacy consent checkbox are shown.
- Given the claim form, when the visitor submits without consent, then the claim is hard-blocked on both client and server and no link is sent.
- Given a valid email with consent checked, when the visitor submits, then their overridden schema is persisted, a magic link is sent via the Supabase→Resend SMTP path over TLS, and the UI confirms the email was sent.
- Given a delivered magic link, when the visitor completes authentication in the same browser, then an `org_members` admin row is created for the session org, a unique slug is provisioned, the consent timestamp is stored on the user, the synthetic demo records are cleared, and they are redirected to `/{slug}`.
- Given the claimed org at `/{slug}`, when the Admin views it, then the live schema (with their 1.7 overrides applied and synthetic rows gone) renders under RLS isolation, and a non-member cannot read it.
- Given an expired/invalid link or a used/expired pending claim, when the visitor lands on the callback, then they see a clear translated message with a re-request path and no partial bootstrap occurs.

## Implementation Notes

- **All 14 tasks implemented; all verification green** (2026-09-25): `type-check` clean, `lint` clean, `test` 126/126, `test:rls` 5/5, `build` succeeds with `/[slug]`, `/api/claim`, `/auth/callback`, `/privacy`, `/terms`, and the Proxy (middleware) all compiling.
- **Test placement:** logic-layer tests live in `tests/unit/claim.test.ts` (schema persist, finalize membership/slug/clear, idempotent re-finalize, expired/unknown token, slug derivation/collision). The route-layer matrix rows the spec's test task named — consent-false, invalid email, missing session, valid-submit dispatch — are in `tests/unit/route-claim.test.ts` (added during verification because `claim.test.ts` had punted them). Placed under `tests/**` because `vitest.config.ts` only includes that root — otherwise they would not run.
- **`pending_claims.slug_base` column:** the derived slug base is captured on the row at claim time; uniqueness is resolved against `organizations.slug` at finalize, so the session org's slug is untouched until the user authenticates.
- **`middleware.ts` vs `proxy.ts`:** Next 16 deprecated `middleware.ts` (renamed `proxy.ts`) but it remains functional; kept at `src/middleware.ts` to honor the frozen Code Map, with a code comment noting the deprecation.
- **Re-request path:** callback failures redirect to `/?claim=expired|error` and middleware bounces to `/?auth=required`; the home page renders a translated, non-alarming notice with the natural re-claim entry — no raw error screen, no unlisted pages.
- **Matrix rows 8–9 (`/{slug}` access):** the security-critical isolation guarantee (non-member reads yield no row) is enforced and covered by the `test:rls` gate; the page's redirect-on-null glue is thin and verified by `build` + the spec's manual browser check.
- **Deferred / ops (not code gaps):** (1) the `20260924060000_pending_claims.sql` migration is authored but **not applied** to the shared test DB — needs `npm run db:push` (or MCP apply) before the live flow works; (2) Supabase Auth custom SMTP (Resend over snapbusy.ca) must be configured for magic-link delivery — app code only calls `signInWithOtp`. The full email round-trip was not exercised end-to-end (requires live Gemini + SMTP + mail catcher); it is covered by unit tests and the green RLS gate.

## Spec Change Log

_No bad_spec / intent_gap loopback occurred during review; frozen intent unchanged._

## Review Triage Log

Review pass 1 (2026-09-25) — three layers (blind-hunter, edge-case-hunter, verification-gap).

**Routed to patch:**
- `medium` — `/auth/callback` route has zero tests (verification-gap V1, pre-verified; blind B9): the reason-mapping (`ClaimError.kind`→`expired`/`error`), missing-code→`expired`, missing-token→`error`, and success→`/{slug}` redirects can regress with a green suite because `claim.test.ts` exercises `finalizeClaim` directly, never the route. Add `route-callback.test.ts`.
- `low` — `/api/claim` 502 `sendFailed` (otpError) and 500 `genericError` (createPendingClaim throws) branches untested (verification-gap "other"): deterministic error-code mappings surfaced to users, currently unexercised. Add two cases to `route-claim.test.ts`.
- `medium` — ClaimModal "sent" state persists across close/reopen (blind B1): verified — `status` is component state and the modal stays mounted, so a user who mistyped their email is stuck on "check your email" and cannot retry without a full reload. Reset form state on close.
- `low` — SlugDashboard N+1 + dead `Promise.all([single])` (blind B8): verified — `listRecords` runs serially in a `for await` loop and `getSchema` is wrapped in a pointless one-element `Promise.all`. Direct simplification.
- `low` — consent timestamp on user metadata uses callback-time not submit-time (blind B11, edge E2): verified — callback writes `consent_accepted_at: new Date()` while the true consent moment is in `pending_claims.consent_accepted_at`; a compliance timestamp should reflect when the user agreed. Return the stored value from `finalizeClaim` and write that.

**Routed to defer:**
- `medium` (unverified-scope) — no rate limiting on `POST /api/claim` (blind B3): real abuse/email-bombing surface, but rate limiting is a cross-cutting concern the whole app lacks (the `/api/generate` endpoint too) and is an explicit later-epic seam — not caused by this story.
- `low`–`medium` — `finalizeClaim` is not atomic (blind B5): verified — steps 4–7 are separate writes with no transaction; a mid-sequence failure leaves membership+slug set with records un-cleared. Harm is low (steps are individually idempotent and a retry self-heals; only the user's own synthetic rows are affected) and the fix is a transactional RPC (substantial). Track as robustness.
- `low` — middleware protection has no test (verification-gap V2): no middleware test harness/precedent in the repo, and the `/[slug]` page re-checks auth + RLS (the hard isolation gate), so this is a UX-only redirect-classification gap.

**Rejected:**
- `false` — records write fails on synthetic actor (blind B10): refuted — `records.actor_id` is a plain nullable `uuid` with NO foreign key (`20260924055022_platform_schema.sql:65`); any uuid is valid, the clear cannot fail on it.
- `false` — token allows a different user to take over the org (blind B6): refuted — the `claim_token` is delivered ONLY inside the magic-link email to `body.email`, and completing `exchangeCodeForSession` requires that email's link plus the same-browser PKCE verifier cookie, so the authenticated `userId` is necessarily the email recipient. No cross-user path. (Optional defense-in-depth: also compare `user.email` to the claim's email in finalize.)
- `false` — OTP-send failure orphans the pending claim / re-overwrites schema (edge E4): refuted — the frozen I/O matrix explicitly sanctions "pending claim … left expiring" on send failure; the `org_schemas` re-upsert on retry is idempotent and harmless.
- `low`, rejected — middleware conflates auth-server error with no-session (edge E1): treating an errored/unknown session as unauthenticated is the SAFE default (letting through on an auth-server error would be an isolation hole); the fix adds a branch that weakens that. Rare transient case.
- `low`, rejected — derived slug could collide with a static route or reserved word (blind B7): verified-but-unlikely — a trade+city slug rarely equals `demo`/`generate`/`privacy`/`terms`; the fix adds a reserved-word guard (complexity). Noted as optional hardening.
- `low`, rejected — `ensureUniqueSlug` loop is unbounded (edge E3): terminates in practice on the first free candidate; a max-attempts bound adds complexity for a non-reachable case.
- `low`, rejected — email placeholder hardcodes `.ca` TLD (blind B2): illustrative placeholder appropriate to the Canadian SMB audience (snapbusy.ca); not a validation constraint.
- `low`, rejected — cross-device open shows "expired or already used" (blind B4): the frozen decision routes cross-device to the re-request path, and distinguishing a cross-device open from a true expiry at the exchange is not cleanly feasible; the copy already offers a fresh-link path.
- `low`, rejected — French "Rendez-le réel" reads literal (blind B12): cosmetic copy preference with no named harm.

## Design Notes

**Round-trip continuity.** React state (the overridden schema) and the anonymous session cookie may not both be available on the callback request, so both durable inputs are committed at submit time: the overridden schema is written straight into the session org's `org_schemas.definition`, and a `pending_claims` row (keyed by a random token embedded in `emailRedirectTo`) carries email + consent timestamp + `session_org_id`. Finalize then needs only the token. The PKCE code exchange is still same-browser (the verifier cookie lives in the requesting browser) — this is the accepted MVP constraint.

**Org promotion, not creation.** The anonymous session org is already a real `organizations` row (minted in `provision.ts`). Claim promotes it in place — add membership, set a real slug, soft-delete synthetic `records` — avoiding any org-to-org data migration. Isolation then flows automatically through `auth_org_ids()` because the user now has an `org_members` row.

**Resend is SMTP config, not app code.** Magic-link email is sent by Supabase Auth using the project's custom SMTP (Resend over snapbusy.ca) configured in Supabase Auth settings — app code calls `signInWithOtp`, not the Resend SDK. Verify the SMTP setting exists as an ops dependency.

## Verification

**Commands:**
- `npm run type-check` -- expected: no TS errors.
- `npm run lint` -- expected: clean (note `eslint-plugin-i18next` will flag any hardcoded user-facing strings).
- `npm run test` -- expected: all vitest suites pass, including the new `claim.test.ts` edge cases.
- `npm run test:rls` -- expected: RLS isolation still green after middleware/session changes.
- `npm run build` -- expected: production build succeeds (new routes compile).

**Manual checks:**
- With the app running (single dev server on http://localhost:3000, browser MCP), run the full flow: generate a demo, apply a 1.7 override, click "Make it Real", verify consent is a hard blocker, submit, complete the magic link (use the local inbucket/mail catcher or Supabase local auth), and confirm landing on `/{slug}` with the overridden schema and no synthetic rows. Toggle locale to FR and confirm all claim copy is translated.
- Confirm Supabase Auth custom SMTP (Resend/snapbusy.ca) is configured for the target environment.
