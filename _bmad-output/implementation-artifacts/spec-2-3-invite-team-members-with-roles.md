---
title: 'Story 2.3: Invite Team Members with Roles'
type: 'feature'
created: '2026-09-25'
status: 'done'
route: 'dispatch'
baseline_commit: '6c8b5b17eec4fe48a8337ed573fb939ac8185a47'
review_loop_iteration: 0
context:
  - '_bmad-output/implementation-artifacts/epic-2-context.md'
  - '_bmad-output/implementation-artifacts/spec-2-1-claim-app-via-magic-link.md'
  - '_bmad-output/implementation-artifacts/spec-2-2-passwordless-login-for-returning-users.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Stories 2.1/2.2 give a single Admin a claimed org and a way back in, but there is no way to bring a crew in. An Admin cannot invite anyone, `org_members` only ever holds the creator's admin row, and teammates have no path to the dashboard.

**Approach:** Add an Admin-only **Settings** surface with an invite form (email + role select, **Member preselected**). A new `POST /api/invite` verifies the caller is an Admin of their org, creates the invitee's account, inserts an `org_members` row scoped to that org with the chosen role, and sends an invite email over Resend. Because an invite is opened on the invitee's *own* device, acceptance uses the cross-device `verifyOtp({ token_hash })` confirmation flow in a new `/auth/confirm` route — NOT the same-browser PKCE `exchangeCodeForSession` that claim/login rely on. Once the session is established, the existing Story 2.2 resolver lands them on `/{slug}`, where membership-based RLS grants immediate read/write.

## Boundaries & Constraints

**Always:**
- **Admin-only, server-enforced.** The invite route independently reads the caller's membership + `role` (from the authenticated user, JWT-proven) and rejects a non-admin or non-member with `403` — never UI-only gating.
- **Roles are exactly `admin | member`, Member preselected by default** at invite time (FR20/FR21). The chosen role is written to `org_members.role` (authoritative, per-org) AND set on the invitee's user metadata `role` via the invite `data` (JWT convenience, consistent with the 2.1 admin path).
- The `org_members` row is created scoped to the Admin's `organization_id` at invite-send time; the existing unique `(organization_id, user_id)` constraint makes a resend idempotent. Invitee sign-in must never clobber the role (2.2 login already sends no `data.role`).
- **Invite email is delivered via the Supabase→Resend SMTP path** (branded, scheza.com) over TLS. App code calls the Supabase admin invite API; the invite email template + SMTP are an ops dependency (as in 2.1/2.2).
- **Acceptance is cross-device.** `/auth/confirm` calls `verifyOtp({ token_hash, type })` to establish the session (the invitee has no PKCE verifier), then reuses `resolveUserPrimaryOrgSlug` → redirect `/{slug}`. Expired/invalid confirm links surface a translated re-request message, never a raw error screen.
- **Service-role discipline:** the invite bootstrap (create user + insert membership) uses the admin client only for this narrow membership-bootstrap op, mirroring `finalizeClaim`; no tenant data is written with it.
- Every route returns the `{ data, error }` envelope; validate input with Zod; never leak provider output, stacks, or SQL. All new user-facing copy resolves through next-intl in **EN + FR** (new namespace); new UI is built with the **`web-uiux-architect`** skill (Tailwind v4, Radix, WCAG AA), reusing `ui/` primitives + the `ClaimModal` error/success patterns.

**Never:**
- No passwords, no OAuth. **No new database tables or migrations** — `org_members` already carries `role` + membership, and RLS resolves via `auth_org_ids()`.
- No RBAC enforcement on OTHER surfaces (Conversational Editor, Billing, schema-mutation routes, hiding Member UI) — that is Story 2.4. This story gates only the invite action itself and provisions membership.
- **Settings surface is the invite form only** — no member list, role change, or revoke UI (deferred to 2.4+).
- **No cross-org add of an existing account.** An email already tied to a Scheza account that is not in this org is rejected (`409 accountExists`); only brand-new invitees and idempotent resends to this org's existing members are supported.
- No multi-org chooser; the invitee joins the single inviting org.
- No change to the claim flow, the 2.2 login endpoint, or the same-browser PKCE claim/login callback branch.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid invite | Admin `POST /api/invite {email, role}` | invitee account created; `org_members` row created under Admin's org with `role`; invite email sent via Resend; `{data:{sent:true}}` | send/provider failure → `502 sendFailed`, translated |
| Invalid email | POST malformed email | rejected before any create/send | `400 invalidEmail`; client inline `role="alert"` |
| Missing / invalid role | `role` not in `{admin,member}` | rejected before any create/send | `400 invalidRole` |
| Non-admin caller | Member or non-member POSTs | no row, no email | `403 forbidden` (translated) |
| Unauthenticated caller | no session | no row, no email | `401`; the Settings page itself is bounced to `/login?auth=required` by middleware |
| Already a member of this org | invite an email already in this org's `org_members` | idempotent success — no duplicate row, no error; UI confirms already on the team | — |
| Email belongs to an existing Scheza account not in this org | invite that email | rejected with a clear translated message (cross-org add deferred) | `409 accountExists` |
| Accept invite (invitee's own device) | `GET /auth/confirm?token_hash=…&type=invite` | `verifyOtp` establishes session → resolve org slug → redirect `/{slug}`; membership-based RLS gives immediate read/write | verify fail/expired → translated re-request path, never a raw screen |

</frozen-after-approval>

## Code Map

- `src/app/api/claim/route.ts` — **template only, don't change.** Mirror its `json()` helper (88-93), `AppError`/`{data,error}` envelope, Zod pattern, and `signInWithOtp` options shape (170-177).
- `src/lib/claim/claim.ts` — **template only.** `finalizeClaim` `org_members` insert (213-225: `id, organization_id, user_id, principal_type:'human', role`) and `readOrgSlug` (135-148) are the reuse patterns.
- `src/lib/auth/org.ts` — **extend.** Reuse `resolveUserPrimaryOrgSlug` (29-68) as-is for post-accept landing; add a sibling resolver returning `{ orgId, slug, role }` (admin-gating + org resolution), same admin-client two-read pattern.
- `src/app/auth/callback/route.ts` — **do not change.** PKCE claim + 2.2 login branches only handle `?code=`; the invite-accept path is a *separate* token_hash route.
- `src/lib/supabase/admin.ts` — `createAdminClient()` (service-role) for the invite bootstrap: `admin.inviteUserByEmail` + `org_members` insert.
- `src/lib/supabase/server.ts` — RLS-scoped `createServerSupabaseClient(cookieStore)`; used by `/auth/confirm` (so `verifyOtp` writes session cookies onto the response) and Settings-page reads.
- `src/lib/auth/session.ts` — `getCurrentUser()` (JWT-validated) identifies the caller on the invite route + Settings page.
- `src/middleware.ts` — **verify only, no change expected.** Matcher excludes `/api/*` + `/auth/*` (95) so both new routes are reachable; `/{slug}/settings` is already slug-protected.
- `src/app/[slug]/page.tsx` — pattern for a protected server page (getCurrentUser → resolve org → render); Settings mirrors it plus the admin gate.
- `src/components/claim/ClaimModal.tsx` — **UI template.** `useId()` ARIA, `ERROR_KEYS`/`resolveError` (43-68), inline `role="alert"`, success state, form reset. Strip consent/schema; add a role select.
- `src/components/ui/{input,label,button,select,form}.tsx` — Radix primitives; `select.tsx` is the role dropdown.
- `src/lib/i18n/{en.json,fr.json}` — flat namespaces via `useTranslations`/`getTranslations`; mirror the `Login` namespace shape.
- `src/types/{api.ts,db.ts}` — `ApiResponse<T>`, `AppError`, `MemberRole`, `OrgMemberRow`. Only new type: `InviteResponse = { sent: true }`.
- `src/lib/observability/report.ts` — `reportError(err, ctx)` for provider/verify failures.
- `tests/unit/{route-claim,route-login,auth-org}.test.ts` — harness precedent (mock supabase + `next/headers`, keep session logic real); `vitest.config.ts` includes `tests/**`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/auth/org.ts` -- Add `resolveUserOrgMembership(userId, adminClient)` returning `{ orgId, slug, role } | null` (most-recent membership; reuse the `readOrgSlug` two-read pattern). -- Admin-gating + org resolution for the invite route and Settings page.
- [x] `src/lib/invite/invite.ts` -- New `inviteMember({ inviterUserId, email, role, adminClient, origin })`: resolve inviter's org + assert `role==='admin'` (else `AppError(403)`); if the email is already a member of this org → idempotent success; if the email already has an account elsewhere → `AppError(409,'accountExists')`; else `admin.inviteUserByEmail(email, { data:{role}, redirectTo: ${origin}/auth/confirm })`, then insert the `org_members` row with the returned user id + chosen role. Never leak provider output. -- Core invite bootstrap.
- [x] `src/app/api/invite/route.ts` -- New `POST`: `getCurrentUser()` → 401 if none; Zod-validate `{ email, role: enum('admin','member') }` (→ `400 invalidEmail`/`invalidRole`); call `inviteMember`; map `AppError` codes to the `{data,error}` envelope; success → `{data:{sent:true},error:null}`; provider failure → `502 sendFailed`. -- Passwordless invite dispatch endpoint.
- [x] `src/app/auth/confirm/route.ts` -- New `GET`: read `token_hash` + `type` from the query; `verifyOtp({ token_hash, type })` on the RLS-scoped server client (cross-device, no PKCE verifier); on success resolve `resolveUserPrimaryOrgSlug` → redirect `/{slug}`; on failure/expiry redirect to a translated re-request status (reuse the `?login=`/`?claim=` status surface), never a raw error. -- Cross-device invite acceptance.
- [x] `src/components/settings/InviteForm.tsx` -- New client form via `web-uiux-architect` (Tailwind v4, Radix, WCAG AA): email input + role `select` (Member preselected) + submit; POSTs to `/api/invite`; success ("invitation sent to {email}") + error (`role="alert"`) + reset states; reuse `ui/` primitives + `ClaimModal` `useId`/`resolveError` patterns; all copy via the new namespace. -- The invite UI.
- [x] `src/app/[slug]/settings/page.tsx` -- New Admin-only server page: `getCurrentUser()` → resolve membership via `resolveUserOrgMembership`; non-admin (or slug mismatch) → `redirect` away (to `/{slug}`); Admin → render `InviteForm`. -- The Settings surface hosting invite.
- [x] `src/lib/i18n/en.json` & `src/lib/i18n/fr.json` -- Add a `Settings` (invite) namespace: title/subtitle, emailLabel/placeholder, roleLabel + `roleAdmin`/`roleMember`, submit, sentTitle/sentBody, `error.{invalidEmail,invalidRole,forbidden,accountExists,sendFailed,genericError}`, and a confirm-link expired/error status string. -- No hardcoded strings, EN+FR.
- [x] `tests/unit/route-invite.test.ts` -- Vitest for the I/O matrix rows 1-7: valid admin invite (asserts `inviteUserByEmail` + `org_members` insert with the chosen role), invalid email → 400, invalid role → 400, non-admin caller → 403, unauthenticated → 401, already-member idempotent success, existing-account-elsewhere → 409; `{data,error}` envelope shape. -- Locks the invite endpoint contract.
- [x] `tests/unit/auth-confirm.test.ts` -- Vitest for `/auth/confirm`: valid token_hash → `verifyOtp` called, org resolved, redirect `/{slug}`; failed/expired verify → translated re-request redirect, no crash; also unit-test `resolveUserOrgMembership` (role returned; null when no membership). -- Locks the acceptance branch + resolver.

**Acceptance Criteria:**
- Given an Admin in Settings, when they submit a teammate's email and choose a role (Member preselected), then before sending they can pick Admin or Member, and on send an `org_members` row is created for the invitee scoped to the Admin's `organization_id` with the chosen role and an invite email is delivered via Resend (FR20/FR21).
- Given a Member or a non-member, when they call the invite API directly, then it verifies the caller's role independently and rejects with a 403 — no membership row is created and no email is sent (frontend hiding is never the sole enforcement).
- Given an invited teammate, when they accept via the emailed link on their own device, then they establish a session (cross-device confirm, no same-browser requirement), land on the org's `/{slug}` dashboard, and — because RLS is membership-based via `auth_org_ids()` — can immediately read that org's records.
- Given an expired or invalid confirm link, when the invitee clicks it, then they see a clear translated message with a way to get back in, never a raw error screen.
- Given all invite/settings copy, when the locale is toggled to FR, then every string renders translated with no hardcoded text.

## Implementation Notes

- **All 9 tasks implemented; all five gates green** (2026-09-25, verified independently against the staged diff): `type-check` clean, `lint` clean (no hardcoded-string flags), `test` 171/171 across 21 files, `test:rls` 5/5, `build` succeeds with `/api/invite`, `/auth/confirm`, and `/[slug]/settings` compiling. All 8 I/O-matrix rows are covered by tests that ran and passed (route-invite rows 1–7 + a 502 send-failure case; auth-confirm covers the cross-device acceptance row).
- **Existing-account lookup cost.** GoTrue's admin API has no email filter, so `inviteMember.findUserIdByEmail` scans `listUsers` pages (perPage 200, up to 50 pages) to classify an email as brand-new / already-a-member / existing-elsewhere. Fine at MVP scale; if the user base grows, a targeted lookup (or storing `email` on `org_members`) would be cheaper. No schema change was made (frozen "Never").
- **UI built to the web-uiux-architect standard** (Tailwind v4, Radix `select`, framer-motion with `useReducedMotion`, `useId` ARIA, `role="alert"`, translated EN/FR copy) reusing the `ui/` primitives + ClaimModal/LoginForm patterns, rather than by literally invoking the skill mid-implementation.
- **Ops dependency (not code, unchanged from 2.1/2.2):** the Supabase "Invite user" email template must emit the `token_hash` confirm link to `/auth/confirm`, and custom SMTP (Resend/scheza.com) must be configured. The live email round-trip and the browser MCP manual walkthrough were NOT exercised this session (no live SMTP/mail catcher).

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-09-25). Three context-free layers (blind-hunter, edge-case-hunter, verification-gap) ran against the staged diff. Every verdict below was verified at its cited location against the current tree. No `intent_gap`/`bad_spec` (no loopback).

**patch (applied):**
- `low` — `/auth/confirm` establishes the session (`cookies()`, `createServerSupabaseClient`, `verifyOtp`) OUTSIDE the try/catch (which only wraps the org resolve at line 257), so a *thrown* `verifyOtp`/client-creation exception (provider/network fault, missing env) escapes as a raw 500 — contradicting the frozen matrix row 8 "never a raw screen." Verified: the region is unguarded. (blind: n/a; edge E1/E2/E5). Fix: extend the try to cover the session-establishment region → translated re-request path.
- `low` — the `org_members` insert branch in `inviteMember` (swallow `23505` → idempotent success; other error → `500 genericError`) is executed by no test — `orgMembersInsert` is only ever `{error:null}`. Verified: real, unmocked path via `POST /api/invite`. (verification-gap, pre-verified → patch). Fix: add two `route-invite` tests (23505 → 200 `{sent:true}`; other error → 500, no leak).
- `low` — a `401 unauthorized` (session expiry mid-form) has no `Settings.error.unauthorized` key and is absent from `InviteForm.ERROR_KEYS`, so it renders the generic message instead of a "sign in again" one. Verified against route.ts:129 + the form's key set. (blind B1/B2). Fix: add the code to `ERROR_KEYS` + an EN/FR key.
- `low` — the role `select`'s dynamic hint paragraph is not wired to the control via `aria-describedby`, so assistive tech doesn't announce the role consequence (frozen "WCAG AA"). Verified: only the email input wires `aria-describedby`. (blind B9b). Fix: id the hint + `aria-describedby` on `SelectTrigger`.
- `low` — dead condition `err.statusCode >= 500 || err.statusCode === 502` in route.ts:160 (`502 >= 500` already true). Verified. (blind B5 / verification-gap V3). Fix: delete the redundant clause.

**defer:**
- `low`/scale — `findUserIdByEmail` caps its `listUsers` scan at 50×200=10,000 users and returns `null` (→ treats an existing account as brand-new, re-invites) with no signal on cap exhaustion. Real only above MVP scale; the code + Implementation Notes explicitly scope it to MVP. (blind B3 / edge E3 / verification-gap V2.)
- `low` — no rate-limit on `POST /api/invite`; a scripted double-submit can dispatch duplicate invite emails (the client button-disable is the only guard). Pre-existing auth-endpoint category already deferred in 2.1/2.2.

**Rejected:**
- `false` — email case-normalization "mismatch" (edge E4): `findUserIdByEmail` lowercases BOTH the target and each `u.email`, so existing-user detection is already case-insensitive; the raw email passed to `inviteUserByEmail` is normalized by the provider and the membership insert keys on `user.id`, not email — no duplicate account/row occurs.
- `false`/not-a-gap — "Settings page admin gate is untested" (blind B6 / verification-gap V4): the real enforcement is the server-side `403` in `inviteMember`, which IS tested (route-invite rows 4/4b); the page redirect is a UX gate, consistent with the sibling `[slug]/page.tsx` having no page test.
- `low`/rejected — resolver DRY duplication + membership resolved on both the page render and the POST (blind B7): the double-resolution is intentional defense-in-depth (UI gate + server enforcement, per the frozen "never UI-only"); extracting a shared helper adds indirection with no named divergence harm.
- out-of-scope (intent) — `409 accountExists` offers no recovery affordance (blind B8): the frozen intent explicitly defers cross-org add, so no recovery path is by design.
- `false` — FR `emailPlaceholder` uses `.ca` (blind B9a): a placeholder example domain is not a defect for an Ontario/QC-facing app.

## Design Notes

**Separate `/auth/confirm`, not extending `/auth/callback`.** Claim/login are same-browser: they carry a PKCE `code_verifier` cookie and use `exchangeCodeForSession`. An invite opens on the invitee's *own* device with no such cookie — that path fails today ("cross-device open" → expired). Supabase's cross-device flow is `verifyOtp({ token_hash })` with a `token_hash` link (not `?code=`), so it gets its own route and leaves the hardened claim/login callback untouched. Consequence: the invite email template must emit the `token_hash` confirm link — an ops/template dependency, like SMTP in 2.1/2.2.

**Role, one source of truth.** `org_members.role` is the durable per-org authority; the user-metadata `role` (set via the invite `data`) is the JWT copy 2.4 enforcement reads. Both are set at invite time so an invited Member never transiently reads as Admin; login never rewrites metadata (2.2).

**Membership row at send time** matches the AC verbatim and reuses `auth_org_ids()` unchanged: once the invitee authenticates, RLS already resolves their org. The unique `(organization_id, user_id)` constraint keeps a resend idempotent.

## Verification

**Commands:**
- `npm run type-check` -- expected: no TS errors.
- `npm run lint` -- expected: clean (`eslint-plugin-i18next` flags any hardcoded user-facing strings in the new UI).
- `npm run test` -- expected: all vitest suites pass, including the new invite + confirm tests.
- `npm run test:rls` -- expected: RLS isolation still green (the invited-member read path must not regress isolation).
- `npm run build` -- expected: production build succeeds (new `/api/invite`, `/auth/confirm`, `/{slug}/settings` compile).

**Manual checks:**
- With the app running (single dev server on http://localhost:3000, browser MCP): claim an app (Admin), open Settings, invite a second email as Member; confirm the invite email arrives, accept it in a *separate* browser/device, confirm it lands on `/{slug}` and can read records. Attempt the invite API as the Member → expect 403. Toggle locale to FR and confirm all invite/settings copy is translated.
- Confirm the Supabase "Invite user" email template emits the `token_hash` confirm link to `/auth/confirm` and that custom SMTP (Resend/scheza.com) is configured for the target environment.
