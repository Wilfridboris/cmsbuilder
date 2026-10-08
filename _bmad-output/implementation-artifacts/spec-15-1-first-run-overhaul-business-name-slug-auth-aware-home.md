---
title: 'Story 15.1: First-Run Overhaul — Business Name, Confirmed Slug, Reshaped Intake & Auth-Aware Home'
type: 'feature'
created: '2026-10-08'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'ed45acf1eb81d8335d42e4db3906a5165c191497'
context:
  - '_bmad-output/implementation-artifacts/epic-15-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A new owner cannot name their business, is given an ugly auto-derived slug (`tradeType+city`, e.g. `/other-toronto`) they never see or confirm, and once signed in lands on that slug with no way back to log in. The landing intake also forces the owner to enumerate what they track instead of describing their business, and the public first-run surfaces (landing, login, legal) are English-only.

**Approach:** Capture a business name on the landing prompt and make it the org's first-class display name; derive the dashboard slug from that name (globally unique, reserved-word guarded) and let the owner see/edit/confirm it before claiming; reshape the single "what you track" field into a free-form business description plus an optional explicit-items field that generation blends; make `/` authentication-aware (signed-in owners get a "go to my dashboard" + sign-out surface, signed-out returning visitors get a prominent log-in path); harden `finalizeClaim` to be atomic; and surface the existing EN/FR toggle on all public surfaces. All new/changed copy is wired through next-intl (en + fr), carries no em-dash, and validates on submit.

## Boundaries & Constraints

**Always:**
- The business name is the authoritative org display name (`organizations.name`), set at claim-submit on the session org that `finalizeClaim` later promotes; the exact typed name is preserved (capitalization/punctuation), never a slug round-trip. **Resolved decision:** the name persists to `organizations.name` ONLY; `business_profiles.operating_name` is NOT written at first-run (its `legal_name` is `NOT NULL` with no row yet) and is deferred to Epic 12 profile capture.
- The slug is derived from the business name, passed through a reserved-word/degenerate guard, then resolved to a globally unique value via the existing `ensureUniqueSlug` at finalize. Duplicate business *names* are allowed; only the slug is unique.
- Slug uniqueness is enforced solely because the slug also keys public intake-form URLs. Access control stays auth-scoped (RLS + `org_members`) — the slug is a routing label, never a security boundary.
- The slug preview shown pre-claim is best-effort (checked when shown and when edited); the authoritative slug is resolved at finalize, and the owner is always shown their final dashboard URL after login.
- Form validation runs on submit only (never per keystroke), with accessible inline messages.
- All new/changed user-facing copy resolves through next-intl (en + fr) and contains no em-dash.
- `finalizeClaim`'s promotion sequence is atomic: a mid-sequence failure can never leave a half-provisioned org. Existing idempotency guarantees are preserved. **Resolved decision:** atomicity is implemented as a Postgres RPC (single transaction, SECURITY DEFINER) modeled on the existing `issue_invoice()` RPC; this adds one additive migration (knowingly overriding the sprint-change proposal's "no migration" note).

**Never:**
- Do not break the existing magic-link claim/login redirect contract in `/auth/confirm` (verified-identity routing, idempotent finalize, translated re-request surfaces, never a raw error screen).
- Do not make the slug a per-keystroke uniqueness gate or claim the preview is authoritative — finalize owns authority.
- Do not introduce a new runtime dependency, a per-tenant subdomain, or opaque public-form tokens (post-MVP).
- Do not auto-redirect a signed-in visitor off `/` in a way that removes the sign-out affordance.
- Out of scope: the SchezaBot reveal (15.2), em-dash scrub of pre-existing i18n strings and the AI-output guard (15.3), Google sign-in (15.4), slug rename after claim (deferred G5).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Slug from name | businessName `"Joe's Plumbing"` | preview base `joes-plumbing` | N/A |
| Slug collision | base `joes-plumbing` already an org slug | finalize resolves `joes-plumbing-2` (then `-3`…) | N/A |
| Reserved slug | name slugifies to `login`/`api`/`forms`/`generate`/`demo`/`auth`/`i` or empty | guard re-derives/suffixes (e.g. `login` → `login-app`) so no system route is shadowed | never emit a reserved/empty slug |
| Availability check | owner edits slug in claim modal | service-role check returns `{available, normalized, suggestion?}`; reserved/taken → not available + suggestion | network error → treat as unconfirmed, allow submit (finalize is authoritative) |
| Claim with business name | valid email + consent + businessName + confirmed slug | `organizations.name` = businessName; `slug_base` = guarded base; magic link sent | missing/blank businessName → 400 translated |
| Reshaped intake submit | businessName + trade + city + description (+ optional items) | intent persisted; generation blends description and items | blank businessName/description → inline submit error |
| Auth-aware home (signed-in) | valid session on `/` | render "go to my dashboard" card (links `/{slug}`) + sign-out; no empty claim form | no org resolved → show claim UI (first-time) |
| Auth-aware home (signed-out) | no session on `/` | render claim UI + prominent "Already have a dashboard? Log in" entry | N/A |
| Sign out | POST sign-out from home/nav | `supabase.auth.signOut()` then redirect `/` | signOut error → still redirect `/` |
| Public locale toggle | visitor on `/`, `/login`, `/privacy`, `/terms` | EN/FR toggle visible, flips chrome in place, no reload | N/A |
| Atomic finalize fault | failure after membership insert, before slug set | org left in its pre-claim state (no partial promotion); retry/re-entry completes cleanly | surfaced as `ClaimError('failed')` → translated re-request |

</frozen-after-approval>

## Code Map

- `src/lib/generation/intent.ts` -- `GenerationIntent` + the three Zod schemas (`createPromptIntentSchema`, `storedIntentSchema`, `generationIntentBodySchema`) and `INTENT_STORAGE_KEY`/`saveIntent`/`readIntent`. Extend with `businessName` (required) and reshape `whatYouTrack` → `description` + optional `explicitItems`. All three schemas must change together (reuse pattern already enforces this). `readIntent` returns `null` on shape mismatch, so a stale stored intent degrades safely.
- `src/lib/claim/slug.ts` -- `deriveSlug` (trade+city today), `ensureUniqueSlug` (collision suffixing; reuse as-is), `slugBaseToName`. Add name-based derivation and a `RESERVED_SLUGS` constant + guard (no central reserved list exists today).
- `src/lib/claim/claim.ts` -- `createPendingClaim` (sets up `pending_claims` + schema) and `finalizeClaim` (5 sequential service-role writes: membership → slug+name → trial → clear synthetic records → consume token; currently non-transactional; derives name via `slugBaseToName`). `finalizeClaim` must stop overwriting `organizations.name` from the slug and delegate the promotion writes to the new Postgres RPC (so the sequence is one transaction); keep the TS-side token resolution, idempotent-re-entry, and expiry checks.
- `supabase/migrations/<timestamp>_finalize_claim_rpc.sql` -- **new**: a `finalize_claim(...)` plpgsql function (SECURITY DEFINER, single transaction) performing the membership insert, slug + trial set, synthetic-record soft-delete, and token consume atomically. Model it on the existing `issue_invoice()` RPC in `supabase/migrations/20260928120900_issue_invoice.sql` (same security model, deterministic conflict errors).
- `src/app/api/claim/route.ts` -- POST handler; body `{email, consent, schema, intent?{tradeType,city}}`; derives `slugBase` via `deriveSlug`; `CURRENT_POLICY_VERSION` lives here (imported by `/auth/confirm`). Thread `businessName` + confirmed `slug` through `intent`; apply reserved-word guard; set `organizations.name` at claim-submit.
- `src/app/api/claim/slug-check/route.ts` -- **new**: service-role slug availability check (reserved-word guard + `organizations.slug` existence) returning `{available, normalized, suggestion?}`. Needed because anon cannot read `organizations.slug` (deny-all RLS).
- `src/lib/gemini/prompts.ts` -- `buildGenerationPrompt(intent)` injects the free-form text between triple quotes (line ~93). Inject the `description` and, when present, the optional `explicitItems` as additional hints the model honors alongside inference.
- `src/app/api/generate/route.ts` -- validates its body against `generationIntentBodySchema` (from `intent.ts`); updated transitively. Confirm it forwards the reshaped fields to `buildGenerationPrompt`.
- `src/components/generation/PromptBuilder.tsx` -- landing form (RHF `mode:'onSubmit'`, shadcn Form). Add the business-name field (first) and reshape the `whatYouTrack` textarea into a description field + optional explicit-items field. `onSubmit` calls `saveIntent` then routes to `/generate`.
- `src/components/claim/ClaimModal.tsx` -- "Make it Real" modal; reads stored intent, POSTs to `/api/claim`. Add the slug preview ("your dashboard will live at scheza.com/{slug}"), inline edit, and availability check (calls the new slug-check route); send `businessName` + confirmed slug.
- `src/app/page.tsx` -- landing route, currently `"use client"` rendering `PromptBuilder` + `ClaimNotice` + an existing `/login` link (reuse/strengthen, do not duplicate). Convert to a server component that branches on session: signed-in → "go to my dashboard" card + sign-out; signed-out → the client claim UI. Keep `ClaimNotice`/`PromptBuilder` as client children.
- `src/lib/auth/session.ts` (`getCurrentUser(): User|null`), `src/lib/auth/org.ts` (`resolveUserPrimaryOrgSlug(userId, adminClient): {slug}|null`) -- reuse for the auth-aware branch (same resolver `/auth/confirm` uses). Do not change.
- `src/app/auth/signout/route.ts` -- **new**: POST → `supabase.auth.signOut()` → redirect `/`.
- `src/components/auth/SignOutButton.tsx` -- **new**: small client button posting to the sign-out route; used on the home signed-in card and in `DashboardNav`.
- `src/components/layout/DashboardNav.tsx` -- hosts `LocaleToggle` today; add the sign-out affordance (none exists anywhere yet).
- `src/components/i18n/LocaleToggle.tsx` -- existing client EN/FR toggle (uses `useLocaleSwitcher` from `LocaleProvider`, which wraps the root layout). Render it directly on the public surfaces below (a server component may render this client component as-is).
- `src/app/login/page.tsx`, `src/app/(legal)/privacy/page.tsx`, `src/app/(legal)/terms/page.tsx` -- public surfaces to receive the `LocaleToggle`.
- `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add keys under `PromptBuilder` (business name, description, explicit items + validation), `Claim` (slug preview/edit/checking/taken), `Home` (signed-in card), and a new `SignOut` namespace. En + fr, no em-dash.
- `supabase/migrations/20260928120000_business_profiles.sql`, `supabase/migrations/20260924060000_pending_claims.sql` -- schema reference: `organizations.name` is display name, `organizations.slug` is `UNIQUE`; `business_profiles.legal_name` is `NOT NULL` (relevant to OQ1).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/generation/intent.ts` -- add required `businessName` (1–80, trimmed), rename `whatYouTrack` → `description` (keep 3–280 bounds), add optional `explicitItems` (0–280); update `GenerationIntent`, all three Zod schemas, and length-bound constants together.
- [x] `src/lib/claim/slug.ts` -- add `deriveSlugFromName(name)` (kebab via shared util, fallback guard), a `RESERVED_SLUGS` constant (top-level route folders: `login`, `auth`, `forms`, `generate`, `demo`, `i`, `api`, plus the home/empty case), and `guardReservedSlug(base)` that re-derives/suffixes a reserved or empty base; keep `ensureUniqueSlug` unchanged.
- [x] `supabase/migrations/<timestamp>_finalize_claim_rpc.sql` -- new `finalize_claim(...)` RPC (SECURITY DEFINER, single transaction) mirroring `issue_invoice()`: membership insert (idempotent on the unique index) + slug set + trial-once + synthetic-record soft-delete + token consume, all-or-nothing.
- [x] `src/lib/claim/claim.ts` -- `createPendingClaim`: accept `businessName` + confirmed `slugBase`, set `organizations.name = businessName` on the session org, store the guarded `slug_base`. `finalizeClaim`: stop deriving/overwriting `name` from the slug (preserve the already-set business name); delegate the promotion writes to the `finalize_claim` RPC so they are atomic; keep the TS token resolution, idempotent re-entry, and expiry checks. Preserve the trial-once guarantee inside the RPC.
- [x] `src/app/api/claim/route.ts` -- extend the body `intent` with `businessName` (required when claiming) + optional confirmed `slug`; apply `guardReservedSlug` + re-slugify server-side; pass through to `createPendingClaim`; keep the consent hard-gate and translated error envelope.
- [x] `src/app/api/claim/slug-check/route.ts` -- new service-role route: normalize + `guardReservedSlug` + check `organizations.slug`; return `{available, normalized, suggestion?}`; never leak SQL/stacks.
- [x] `src/lib/gemini/prompts.ts` -- inject `description` (output-language driver, as today) and, when non-empty, `explicitItems` as an explicit "also make sure to cover" hint blended with inference; keep user text delimited as non-instructions.
- [x] `src/components/generation/PromptBuilder.tsx` -- add the business-name field first; reshape into description + optional explicit-items; submit-only validation; i18n-namespaced labels/placeholders/messages. (UI/UX via the web-uiux-architect skill.)
- [x] `src/components/claim/ClaimModal.tsx` -- read `businessName` from stored intent; show + inline-edit the slug with the live availability check; send `businessName` + confirmed slug to `/api/claim`. (UI/UX via web-uiux-architect.)
- [x] `src/app/page.tsx` -- convert to a server component branching on `getCurrentUser()`: signed-in with resolved org → "go to my dashboard" card (`/{slug}`) + `SignOutButton`; otherwise the client claim UI with the strengthened "Already have a dashboard? Log in" entry. (UI/UX via web-uiux-architect.)
- [x] `src/app/auth/signout/route.ts` + `src/components/auth/SignOutButton.tsx` -- new sign-out route + reusable button; redirect `/` even on signOut error.
- [x] `src/components/layout/DashboardNav.tsx` -- add the sign-out affordance.
- [x] `src/app/login/page.tsx`, `src/app/(legal)/privacy/page.tsx`, `src/app/(legal)/terms/page.tsx` -- surface `LocaleToggle` on each public page. (UI/UX via web-uiux-architect.)
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add all new keys (en + fr), no em-dash.
- [x] Unit tests -- cover the I/O matrix: name→slug derivation, reserved-word guard, `ensureUniqueSlug` collision, slug-check route (available/taken/reserved/error), reshaped intent schema (valid/blank/too-long), `buildGenerationPrompt` includes description + explicit items, and `finalizeClaim` name-preservation + atomic-fault behavior.

**Acceptance Criteria:**
- Given the landing prompt, when it loads, then it collects a business name, trade type, city, a free-form business description, and an optional explicit-items field, validating on submit with accessible inline messages.
- Given a submitted claim, when it is created, then `organizations.name` is the exact typed business name and the dashboard slug is derived from that name (not trade+city), globally unique via `ensureUniqueSlug`, and reserved-word/degenerate-guarded.
- Given the claim modal, when the slug is shown or edited, then availability is checked (best-effort) and the owner is always routed to and shown their authoritative final dashboard URL after login.
- Given generation, when it runs on the reshaped intake, then the model infers tables from the free-form description and also honors any explicitly listed items.
- Given an authenticated owner visiting `/`, when the page renders, then they see a "go to my dashboard" surface and a sign-out affordance, never the empty claim form; a signed-out returning visitor always sees a clear "log in" entry.
- Given any public unauthenticated surface (landing, login, legal), when it renders, then an EN/FR toggle is available and flips the chrome in place.
- Given `finalizeClaim`, when a write fails mid-sequence, then the org is never left half-provisioned and re-entry completes cleanly; the magic-link routing contract in `/auth/confirm` is unchanged.

## Implementation Notes

**UI/UX design direction (from the web-uiux-architect skill — follow for all surface work; CSS-first motion, Tailwind v4 `size-*`, Zinc theme tokens, WCAG AA, `motion-reduce` guards, submit-only validation):**

- **PromptBuilder** — keep the existing shadcn `Form`/`FormField` column (`gap-6`, `min-h-12` controls). Field order: Business name (`Input`, first, `autoComplete="organization"`), Trade (`Select`), City (`Input`), "Describe your business" (`Textarea rows={4}`, replacing `whatYouTrack`), "Anything specific to track? (optional)" (`Input`; mark optional in the label via `text-muted-foreground`). All copy via the `PromptBuilder` namespace. No motion.
- **ClaimModal slug preview** — below the email field: muted `scheza.com/` prefix + an inline `Input` for the editable slug segment (`font-mono text-sm`, `min-h-10`). Status affordance from the availability check, debounced ~400ms, `aria-live="polite"`: `checking` → `Loader2` spin + sr-only text; `available` → `Check` (`text-emerald-600`); `taken` → `AlertCircle` (`text-amber-600`) + a one-tap "use {suggestion}" button. Network error → silent "unconfirmed", still submittable (finalize is authoritative). CSS transitions only.
- **Auth-aware home (signed-in)** — one lift card (`rounded-2xl border bg-card p-8 shadow-xl shadow-black/5`, centered, `max-w-md`): greeting with `organizations.name`, primary `Button asChild size="lg"` → `/{slug}` with trailing `ArrowRight` (`group-hover:translate-x-1`), quiet secondary `SignOutButton` below. Mount with `animate-in fade-in slide-in-from-bottom-2` + `motion-reduce:animate-none`.
- **SignOutButton** — client; `<form action="/auth/signout" method="post">` wrapping a `Button variant="ghost"` (`LogOut` icon + label), `focus-visible:ring-2`. Reused on the home card and in `DashboardNav`.
- **Public LocaleToggle** — reuse the existing segmented control unchanged (already AA, `role="group"`, `aria-pressed`). Landing/login: top-right within the top padding region. Legal pages: a small `flex justify-end` top bar (server pages render this client component directly).

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter, edge-case-hunter, verification-gap). No intent_gap or bad_spec findings → no loopback.

- **patch** `RESERVED_SLUGS` omits `home` (`src/lib/claim/slug-derive.ts`) — medium. Verified: `src/app/home/route.ts` is a real top-level route (PWA start_url); a business named "Home" slugifies to `home` and shadows it. The spec's Code Map/Tasks explicitly listed "the home route," so this is an implementation deviation from a correct spec. Fixed: added `"home"` to the set + unit test (`guardReservedSlug("home")` → `home-app`) + a `/api/claim` reserved-name route test.
- **patch** French `slugHint` dangling pronoun (`src/lib/i18n/fr.json`) — low. Verified: "Vous pouvez la modifier" has no feminine antecedent in its sentence (the only noun is the masculine "tableau de bord"). User-facing FR copy. Fixed: reworded to "Vous pouvez modifier cette adresse."
- **patch** `getCurrentUser()` not guarded in the home route (`src/app/page.tsx`) — low. The resolver below is try/caught and the code claims graceful degradation, but an auth/cookie fault from `getCurrentUser()` would crash the most-hit authed page. Fixed: wrapped in try/catch returning null, mirroring the adjacent guard.
- **patch** reserved-word path through `POST /api/claim` untested (verification-gap other-finding) — low. Only the non-reserved "Joe's Plumbing" path was asserted. Fixed by the reserved-name route test added above.
- **defer** `POST /api/claim/slug-check` has no rate limiting; `finalize_claim` RPC relies solely on the GRANT revoke (blind, edge) — medium. New unauthenticated service-role endpoint created after Story 15.5's hardening plan; revoke verified in place/advisor-clean so currently secure. Routed to 15.5 launch hardening (ledger entry added).
- **defer** PRD FR105 / epics 15.1 AC still say "persisted to `business_profiles` operating name," contradicting the approved organizations.name-only decision (blind) — medium (doc). Planning-doc reconciliation, out of scope for the build; ledger entry added.
- **defer** (subsumed) Abandoned session org keeps the typed business name indefinitely (blind) — low. Covered by the existing anonymous-org TTL cleanup deferral; the name sits on a throwaway anonymous org and is overwritten on re-claim.
- **reject** ClaimModal has no business-name input; a blank stored intent → 400 `businessNameRequired` dead-end (blind, edge) — low/false-in-practice. The happy path always carries `businessName` (PromptBuilder requires it; same-session sessionStorage); only storage-loss mid-flow reaches it, the server rejects safely (no data harm), and a recovery UI would add surface. Narrow + non-trivial fix → rejected.
- **reject** `deriveSlugFromName` could persist a reserved slug if a caller skips the guard (edge) — false. All three callers (`/api/claim`, `slug-check`, ClaimModal) pipe through `guardReservedSlug`; verified.
- **reject** slug input not normalized, so the previewed slug can differ from the final (edge) — low/by-design. The frozen matrix declares the preview best-effort and guarantees the owner is shown the authoritative final URL after login; `ensureUniqueSlug`/finalize is authoritative.
- **reject** `finalize_claim` silently no-ops on a missing `p_org` (edge) — false. The membership `insert` carries an FK to `organizations`; a missing org raises (not a conflict), so the RPC fails with a `ClaimError` rather than reporting false success.
- **reject** `createPendingClaim` name-write not rolled back if a later write fails (edge) — low. The name sits on a throwaway anonymous session org and is overwritten on re-claim (reviewer concurs low impact).
- **reject** `slug-check` `ensureUniqueSlug` after the "taken" branch not inner-wrapped (edge) — low. The outer catch returns 500, which the client treats as "unconfirmed" and still submits; finalize is authoritative. No user harm.
- **reject** five `eslint-disable react-hooks/set-state-in-effect` in ClaimModal (blind) — low cosmetic. Developer-facing; the fix is a non-trivial sync-from-store restructure, not a direct correction.
- **reject** signed-in home does two sequential admin queries (resolve slug, then read name) (blind) — low. Negligible latency; the one-query fix would change the frozen `resolveUserPrimaryOrgSlug` contract or add a parameter.
- **reject** `createPendingClaim` `nameError` throw branch untested (blind) — low. A standard error-propagation branch identical to the adjacent tested ones; not an I/O-matrix row.
- **reject** no length cap on name-derived slugs (edge) — low cosmetic. A rare 80-char single-token name yields a long URL; adding a cap is new logic for negligible harm.
- **note** `finalize_claim` SQL is not executed by any unit test (verification-gap other-finding) — known limitation. The repo verifies migrations via Supabase MCP/manual (the RPC was applied to the test project and is advisor-clean), and the spec's Verification mandates a manual Playwright pass of the full claim path; the TS orchestration around the RPC is unit-tested via the fake.

## Design Notes

- **Why `organizations.name` at claim-submit (not `pending_claims`):** the session org that `finalizeClaim` promotes is the same org referenced by the pending claim (`session_org_id`), so writing the name onto that org at claim-submit carries it across the magic-link round-trip with no new column — avoiding a migration for the name. `finalizeClaim` therefore only needs to stop overwriting it.
- **Slug authority split:** the preview + availability check are UX affordances only; `ensureUniqueSlug` at finalize is the single source of truth, so two same-name businesses can both claim concurrently and deterministically land on `name` / `name-2` without the preview ever stranding them.
- **UI/UX standard:** all surface work (PromptBuilder reshape, slug preview/edit, auth-aware home card, sign-out, public locale toggle) is designed through the `/web-uiux-architect` skill — WCAG AA, submit-only validation, reduced-motion-safe, no layout shift, Zinc theme tokens, consistent with the existing `LocaleToggle` and shadcn Form patterns.
- **Reserved-word guard example:** `guardReservedSlug("login")` → `"login-app"`; `guardReservedSlug("")` → the `SLUG_FALLBACK` base; a normal name passes through untouched so the common path is unaffected.

## Verification

**Commands:**
- `npm run type-check` -- expected: no errors.
- `npm run lint` -- expected: clean on `src`.
- `npm run test` -- expected: all unit tests pass, including the new slug/intent/claim/slug-check suites.
- `npm run build` -- expected: production build succeeds (watch for the typed-routes/policy-version build blocker noted in epic context; relocate the constant if it reproduces).

**Manual checks (if no CLI):**
- Run the Playwright MCP manual review on localhost:3000 over the rich path: name a business (one that collides and one with punctuation), confirm/edit the slug, generate from a description + explicit items, claim, open the magic link, land on the final dashboard URL, then revisit `/` signed-in (card + sign out) and signed-out (log-in entry); toggle EN/FR on landing, login, and a legal page.
