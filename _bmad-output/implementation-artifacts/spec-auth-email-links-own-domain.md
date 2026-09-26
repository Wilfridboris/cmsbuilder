---
title: 'Migrate auth email links onto SiteURL/auth/confirm (token_hash flow)'
type: 'refactor'
created: '2026-09-26'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: 'd1c2bc0238f67be434d4e7a81ffff77891da9a07'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Magic-link login and claim/confirm-signup emails link to `https://<project>.supabase.co/auth/v1/verify?...&redirect_to=<app>/auth/callback` (a PKCE `code` link on the supabase.co domain, same-browser only). We want every auth email link on our own SiteURL: `${SITE_URL}/auth/confirm?token_hash=...&type=...`, cross-device, with no supabase.co hop.

**Approach:** Make `/auth/confirm` (today's invite-only `verifyOtp` landing) the single landing for claim, login, AND invite. Port the claim finalization (`finalizeClaim` + consent/policy-version metadata write) and returning-user org resolution — today living in the PKCE route `/auth/callback` — onto the `token_hash` path, so all three flows are driven by a SiteURL `verifyOtp` link. Invite behavior is unchanged. The Supabase email templates + redirect allowlist are rewritten manually by the user (documented here).

**Decisions (locked):**
- **Claim vs login is resolved server-side by verified email — no `claim_token` in the link.** After `verifyOtp`: if the user has a membership → login landing; else finalize the most-recent unconsumed+unexpired `pending_claims` row for the verified email (`finalizeClaimByEmail`, delegating to the existing token-keyed `finalizeClaim`). Idempotent by construction (once finalized, membership exists so re-entry lands as login). Failure/re-request surface is chosen from a per-flow static `next` marker on the link (template-set), so an expired verify — where no user/email is available — still routes claim→`/?claim=…` vs login/invite→`/login?login=link-expired`.
- **`/auth/callback` (the PKCE route) is removed now**, along with its two unit tests (`route-callback.test.ts`, `route-callback-login.test.ts`). Its finalize+consent-metadata sequence is ported into `/auth/confirm` first. (In-flight old-template links sent before the switch will fail to a translated re-request surface — accepted.)

## Boundaries & Constraints

**Always:**
- After a successful `verifyOtp`, `/auth/confirm` must land the user on their `/{slug}` dashboard for every flow: login (existing membership), claim (finalize creates membership + slug, clears synthetic records, records consent timestamp/policy version), invite (membership pre-exists).
- Claim finalization stays idempotent (re-entry with an already-consumed claim is a safe no-op that still lands the user) and never leaves a partial/half-bootstrapped org.
- Role authority stays exclusively in `org_members` (`finalizeClaim` writes `role:'admin'`); NO role is ever written to user metadata. Only the consent timestamp + `policy_version` are written to metadata, and a metadata-write failure must not strand a live org.
- Every failure path redirects to a translated status surface with a re-request path — never a raw error screen, never a crash. Claim failures land on the claim re-request surface (`/?claim=expired|error`); login/invite failures land on the login surface (`/login?login=link-expired`); an authenticated-but-no-membership user lands on `/login?login=no-org`.
- Cross-device works: the flow relies only on `token_hash`/`verifyOtp` (no PKCE `code_verifier` cookie).
- Anti-enumeration on `POST /api/login` is preserved (no-user outcome swallowed into the `{sent:true}` envelope); consent hard-gate on `POST /api/claim` is preserved; tenant isolation (RLS via `auth_org_ids()`) is unchanged.

**Never:**
- Do not change invite flow behavior (`inviteMember` / `POST /api/invite` stay as-is; invite already lands on `/auth/confirm`).
- Do not thread a `claim_token` through the email link — claim is resolved server-side by verified email (locked decision).
- Do not buy/enable a Supabase custom auth domain — the SiteURL/auth/confirm code path is the chosen mechanism.
- Do not write a role scalar to user metadata; do not trust metadata for authorization.
- Do not use the raw service-role client for any tenant write beyond the existing narrow claim bootstrap.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Login land | valid `token_hash`+`type`, user has membership | `verifyOtp` OK → resolve primary org → redirect `/{slug}`; no finalize, no metadata write | N/A |
| Claim land | valid link, verified user, unconsumed+unexpired pending claim, no membership yet | `verifyOtp` OK → `finalizeClaim` (membership+slug+clear synthetic) → write consent+policy metadata → redirect `/{slug}` | finalize `ClaimError` expired → `/?claim=expired`; not-found/failed → `/?claim=error` |
| Claim re-entry | valid link, pending claim already consumed for same org | idempotent finalize returns existing slug → redirect `/{slug}` | N/A |
| Invite land | valid link `type=invite`, membership pre-exists | unchanged: `verifyOtp` OK → resolve org → `/{slug}` | failed verify → `/login?login=link-expired` |
| Expired/invalid verify | bad/expired `token_hash` | redirect to the flow's re-request surface | claim flow → `/?claim=expired`; login/invite → `/login?login=link-expired` |
| Missing/bad params | no `token_hash` or unrecognized `type` | re-request redirect, `verifyOtp` NOT called | login/invite → `/login?login=link-expired` |
| Verified, no org, no pending claim | login link but user has no membership | redirect `/login?login=no-org` | N/A |
| Metadata write fails (claim) | finalize OK, `updateUser` errors | log via `reportError`, still redirect `/{slug}` (org already live) | swallow — never strand a live org |

</frozen-after-approval>

## Code Map

- `src/app/auth/confirm/route.ts` -- THE change site. Today: `verifyOtp` → `resolveUserPrimaryOrgSlug` → `/{slug}`; all failures → `/login?login=link-expired`. Add: membership-first branch, else `finalizeClaimByEmail` + consent metadata write (ported from the deleted callback), and per-flow failure-surface selection driven by the `next` marker. `CONFIRM_TYPES` already includes `signup|magiclink|invite|email`.
- `src/app/auth/callback/route.ts` -- **delete this route.** It was the current PKCE landing for claim+login; its exact finalize + consent-metadata sequence is the reference to port into `/auth/confirm` before removal.
- `src/app/api/claim/route.ts` -- `signInWithOtp({shouldCreateUser:true, emailRedirectTo})`; owns `CURRENT_POLICY_VERSION`. Retarget `emailRedirectTo` to `/auth/confirm` (no `claim_token` — resolved server-side). Keep consent hard-gate + envelope + no metadata role.
- `src/app/api/login/route.ts` -- `signInWithOtp({shouldCreateUser:false, emailRedirectTo:'${origin}/auth/callback'})`. Point `emailRedirectTo` at `/auth/confirm`. Keep anti-enumeration + no `data.role`.
- `src/lib/claim/claim.ts` -- `finalizeClaim` (token-keyed), `createPendingClaim`, `ClaimError`, `PENDING_CLAIM_TTL_MS`. `pending_claims` has `email`, `consumed_at`, `expires_at`. Add `finalizeClaimByEmail(email, userId, adminClient)`: resolve the most-recent unconsumed+unexpired token for the email, then delegate to the existing token-keyed core; missing → `ClaimError('not-found')`.
- `src/lib/auth/org.ts` -- `resolveUserPrimaryOrgSlug` (reused for the membership-first landing; unchanged).
- `src/lib/invite/invite.ts` -- reference pattern only (`inviteUserByEmail` → `${origin}/auth/confirm`). Do not modify.
- `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- `Claim.sentBody` and `Login.sentBody` say "Open it in this browser" (a same-browser artifact now false). Update copy to drop the browser constraint; keep existing status keys (`Claim.linkExpired/linkError`, `Login.linkExpired/noOrg`) — no new keys needed. No em-dashes.
- Tests: `tests/unit/auth-confirm.test.ts` (expand: claim-land finalizes+writes consent, login-land resolves with no finalize, per-flow failure surface, metadata-write-failure still lands), `tests/unit/route-claim.test.ts` + `tests/unit/route-login.test.ts` (assert new `/auth/confirm` `emailRedirectTo` target; claim no longer carries `claim_token`), `tests/unit/claim.test.ts` (add `finalizeClaimByEmail` coverage). **Delete `tests/unit/route-callback.test.ts` and `tests/unit/route-callback-login.test.ts`** with the route.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/claim/claim.ts` -- add `finalizeClaimByEmail(email, userId, adminClient)`: resolve the most-recent unconsumed+unexpired `pending_claims` token for the email, then delegate to the existing token-keyed `finalizeClaim`; no matching pending claim → `ClaimError('not-found')`.
- [x] `src/app/auth/confirm/route.ts` -- after a successful `verifyOtp`, branch: existing membership (`resolveUserPrimaryOrgSlug`) → land `/{slug}` (login/invite/claim re-entry); else `finalizeClaimByEmail(user.email)` → write consent + `policy_version` metadata (swallow write failure), land `/{slug}`; neither → `/login?login=no-org`. Select the failure/re-request surface from the per-flow `next` marker (claim → `/?claim=expired|error`, else `/login?login=link-expired`). Port the finalize+metadata sequence from the callback route being deleted.
- [x] `src/app/api/claim/route.ts` -- retarget `emailRedirectTo` to `/auth/confirm` (no `claim_token`). Preserve consent gate, `{data,error}` envelope, no metadata role.
- [x] `src/app/api/login/route.ts` -- retarget `emailRedirectTo` to `/auth/confirm`. Preserve anti-enumeration, `shouldCreateUser:false`, no `data.role`.
- [x] `src/app/auth/callback/route.ts` -- delete the route (finalize+metadata already ported to `/auth/confirm`).
- [x] `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- update `Claim.sentBody` / `Login.sentBody` to remove "Open it in this browser" (cross-device now works). No em-dashes.
- [x] `tests/unit/auth-confirm.test.ts`, `tests/unit/route-claim.test.ts`, `tests/unit/route-login.test.ts`, `tests/unit/claim.test.ts` -- cover the I/O matrix: claim-land finalizes+writes consent+lands; login-land resolves+lands with no finalize/metadata; each failure lands on the correct per-flow surface; metadata-write failure still lands; new `/auth/confirm` `emailRedirectTo` target; `finalizeClaimByEmail`. Delete `tests/unit/route-callback.test.ts` + `tests/unit/route-callback-login.test.ts`.
- [x] `docs` -- record the required manual Supabase config (user performs it): Magic Link + Confirm-signup templates rewritten to `${SITE_URL}/auth/confirm?token_hash={{ .TokenHash }}&type=<magiclink|signup>&next=<per-flow marker>`, and `/auth/confirm` (+ SiteURL) added to the Auth redirect allowlist. Place as a short section in the spec's Implementation Notes or a `docs/` note.

**Acceptance Criteria:**
- Given a returning user opens their login link on a different device, when `/auth/confirm` verifies it, then they land on `/{slug}` with no PKCE cookie required and no finalize/metadata write.
- Given a new user opens their claim link, when `/auth/confirm` verifies it, then membership + unique slug are provisioned, synthetic records are cleared, the consent timestamp + policy version are recorded, and they land on `/{slug}`.
- Given any expired/invalid/missing-param link, when `/auth/confirm` handles it, then the user is redirected to the correct translated re-request surface (claim → `/?claim=…`, login/invite → `/login?login=link-expired`) — never a raw error screen.
- Given an invite link, when `/auth/confirm` verifies it, then behavior is byte-for-byte unchanged from today.

## Implementation Notes

### Required manual Supabase config (performed by the user)

The code path lands every auth email on `${SITE_URL}/auth/confirm`, but the actual
email URLs are set by the Supabase email templates and gated by the redirect
allowlist. `emailRedirectTo` in `/api/claim` and `/api/login` only sets the
fallback/allowlist target; the visible link comes from the template. Apply these
in the Supabase dashboard (Authentication → URL Configuration and Email Templates):

1. **Redirect allowlist** (Authentication → URL Configuration → Redirect URLs):
   add `${SITE_URL}/auth/confirm` (and confirm `${SITE_URL}` is set as the Site
   URL). Without this, Supabase falls back to the project's default and the link
   reverts to `supabase.co`.

2. **Magic Link template** (returning-user login → `type=magiclink`):
   ```
   ${SITE_URL}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink
   ```
   (no `next` marker → failures route to `/login?login=link-expired`).

3. **Confirm signup template** (new-email claim → `type=signup`):
   ```
   ${SITE_URL}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=claim
   ```
   The `next=claim` marker routes an expired/failed verify (where no user/email is
   available) to the claim re-request surface `/?claim=expired|error`.

4. **Invite template** (teammate invite → `type=invite`): already lands on
   `${SITE_URL}/auth/confirm` via `inviteUserByEmail`'s `redirectTo`; if the
   template hardcodes the URL, use:
   ```
   ${SITE_URL}/auth/confirm?token_hash={{ .TokenHash }}&type=invite
   ```
   (no `next` marker → login surface on failure, matching prior invite behavior).

Note: a claim opened by an **existing** email is delivered as a Magic Link
(`type=magiclink`), so claim detection is NOT by `type` — `/auth/confirm` resolves
claim vs login server-side by membership + pending-claim (the locked design). The
`next=claim` marker only affects the *failure* surface, which is why the
Confirm-signup template (the new-email claim path) carries it.

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **[VG] `finalizeClaimByEmail` email discriminator is untested against a foreign claim** — `high` — code IS correct today (the `row.email === normalized` predicate exists, `claim.ts`), but no test seeds an unconsumed+unexpired claim for email A and calls with email B; a regression to "newest unconsumed" would pass every existing test and enable cross-tenant finalize (admin row on the wrong user's org). Untested security-critical guard. Route: **patch** (add test).
- **[BH1/BH2/EC2] Unbounded lookup: `finalizeClaimByEmail` fetches all unconsumed `pending_claims` table-wide** — `low` — query filters only `consumed_at IS NULL`, no email filter, no `.limit()`; grows with abandoned/expired-but-unconsumed rows. Real at scale, negligible at MVP. The naive bounded fix is unsafe: a server-side `.ilike("email", …)` treats `_` (legal in email local-parts) and `%` as wildcards, so a correct bounded filter needs pattern-escaping or a normalized column + index migration — more than a direct correction. The current JS exact-match is correct today, only unbounded. Route: **reject** (low + non-trivial/added-surface fix, per the reject-low rule); a bounded-lookup + index is a separate scale optimization.
- **[BH8] Expired pending claim collapses to `not-found`→`/login?login=no-org` instead of the frozen matrix's `expired`→`/?claim=expired`** — `low` — the JS `.find()` filters expired rows out, so the real function never raises `expired` and the route's expired branch is unreachable via integration. Near-unreachable at default config (OTP TTL mirrors `PENDING_CLAIM_TTL_MS`), but deviates from the frozen I/O matrix. Fix is a direct deletion (drop the expiry sub-clause; let `finalizeClaim` own expiry). Route: **patch**.
- **[BH3] Two same-email claims produce interchangeable links (newest wins), dropping the token→session_org binding** — `false` — by design: the locked frozen decision specifies finalizing "the most-recent unconsumed+unexpired pending_claims row for the verified email." No harm beyond the accepted multi-org deferral. Route: reject.
- **[BH4/EC1] `user.email ?? ""` could match a blank-email claim and finalize a stranger's org** — `false` — `createPendingClaim` only inserts a Zod-validated non-empty email (`claimBodySchema.email = z.string().trim().email()`, `api/claim/route.ts:76`), so no blank-email row can exist; `""` matches nothing → benign `not-found` → no-org. Consequence unreachable. Route: reject.
- **[BH5] `sentBody` still says "secure sign-in link"; no copy for the cross-device no-org terminal state** — `low` — cosmetic, no concrete named harm; `Login.noOrg` copy already exists and the browser→any-device edit was the scoped change. Route: reject.
- **[BH6] Supabase email-template/allowlist config not captured in the diff** — out of scope by intent — the request explicitly assigns the dashboard steps to the user ("I will do the dashboard steps"); the config is documented in Implementation Notes. Route: reject (out of scope).
- **[BH7 / EC deletion note] Deleting `/auth/callback` makes in-flight old-template links 404 rather than a translated surface** — `low` — the intent explicitly accepts cutover breakage; a back-compat shim would contradict the locked "Remove now" decision. Route: reject.
- **[VG-minor] `created_at` is ordered but not selected in the lookup** — `low` — valid PostgREST behavior; the fake test DB reproduces ordering itself. Inherent to unit-mocking, not a defect. Route: reject.

Routing: no `intent_gap` / `bad_spec` → no loopback. Two `patch` entries: {[VG] discriminator test — add foreign-email exclusion coverage}, {[BH8] expiry fidelity — delegate expiry to `finalizeClaim`}. SendMessage was unavailable to re-engage the implementer, so the patches were applied directly (sanctioned fallback), then full verification re-run.

## Design Notes

The trap (why this is not a template-only tweak): claim's finalize logic lives only in the PKCE route `/auth/callback`; the token_hash route `/auth/confirm` does `verifyOtp` + org-resolve and would return `null` for a claimant who has no membership yet, bouncing them to a re-request path with synthetic data uncleared. So finalize must be ported onto the confirm path before templates switch.

Flow → template → `type`: new-email claim triggers **Confirm signup** (`type=signup`); returning login triggers **Magic Link** (`type=magiclink`); invite triggers **Invite** (`type=invite`). All already in `CONFIRM_TYPES`. Claim-by-existing-email would send `magiclink`, so claim detection must NOT rely on `type` alone — this is why the locked design resolves by membership+pending-claim rather than by type.

Locked shape, single post-verify decision:
```
verifyOtp → user
if resolveUserPrimaryOrgSlug(user) → /{slug}            // login / invite / claim re-entry
else if finalizeClaimByEmail(user.email) → {slug}       // first claim: bootstrap + consent write
else → /login?login=no-org
```
Failure surface is chosen from a per-flow `next` marker on the link (template-set) so an expired verify (where we have no user/email) still routes claim→`/?claim=expired` vs login→`/login?login=link-expired`.

## Verification

**Commands:**
- `npm run test` -- expected: all vitest suites pass, including new/updated `auth-confirm` claim+login coverage.
- `npm run type-check` -- expected: no TS errors.
- `npm run lint` -- expected: clean.

**Manual checks:**
- After the user applies the Supabase template + allowlist changes: run the three flows on localhost:3000 (login, claim with a fresh email, invite) per the memory'd Playwright MCP manual review, confirming each lands on `/{slug}` and every email link points at the SiteURL `/auth/confirm`, not `supabase.co`.
