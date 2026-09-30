---
title: 'Manage Subscription via Stripe Customer Portal'
type: 'feature'
created: '2026-09-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '56d9195794d7039ea8db440cba8ed2fc5a1a5e05'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After Story 7.2 an Admin can start a subscription but cannot self-serve afterward: no entry point to update a card, view invoices, or cancel (FR31), and the webhook still 200-no-ops every post-checkout lifecycle event, so a cancellation or failed payment never reaches the cached `subscription_status` that 7.4/7.5 depend on.

**Approach:** Add an Admin-only "Manage billing" surface that redirects an active-subscription Admin to the Stripe-hosted Customer Portal (card, invoice history, cancel — all on Stripe), mirroring 7.2's checkout redirect, and extend the signature-verified webhook so `customer.subscription.deleted` / `invoice.payment_failed` / `invoice.paid` update the cached `subscription_status` idempotently. **Decision:** 7.3 introduces the lapse states now — an additive migration widens the `subscription_status` CHECK to `('trial','active','past_due','read_only')`, and the webhook writes `invoice.paid`→`active`, `invoice.payment_failed`→`past_due`, `customer.subscription.deleted`→`read_only`. Story 7.4 later adds the *enforcement* (blocking writes when `read_only`), trial reminders, and any `grace`/`deleted` states; 7.3 only records state.

**Decision (reactivation — review loop 1):** `read_only` is terminal for webhook lifecycle events. Once an org is `read_only` (subscription canceled), an `invoice.paid` or `invoice.payment_failed` event does NOT change its status — only a new `checkout.session.completed` (a deliberately restarted subscription) reactivates it to `active`. This prevents an out-of-order or redelivered invoice event from silently restoring paid access to a canceled account.

**Decision (billing surface — review loop 1):** the Settings Billing section maps `active`/`past_due` → "Manage billing" (Stripe portal, so a failed-payment Admin can fix their card) and `trial`/`read_only` → "Add billing" (start or restart checkout — a canceled org's subscription no longer exists, so it re-subscribes rather than opening a portal that cannot restart it).

## Boundaries & Constraints

**Always:**
- Portal access is Stripe's hosted Customer Portal only (`stripe.billingPortal.sessions.create`); Scheza renders one "Manage billing" button + its disabled "Redirecting…" state. Portal features (card update, invoice history, cancel-anytime, no contract) are enabled via the Stripe Dashboard's default portal config.
- Reuse 7.2 plumbing: `getStripeClient()`, the `requireUser`→`resolveAdminIdentity(slug,user)` admin gate, the `{ data, error }` envelope + `handleError`, `AppError` with translated keys (never leak Stripe internals), `createAdminClient()` for webhook org writes.
- The webhook stays the sole, idempotent writer of state transitions; every event is verified with `constructEvent` against `STRIPE_WEBHOOK_SECRET` (bad/absent sig → 400, not processed — unchanged); unhandled types and unresolvable orgs still log + 200 no-op.
- `read_only` is terminal for lifecycle events: the invoice handlers read the org's current status and skip the write when it is already `read_only` (only `checkout.session.completed` can move an org out of `read_only`). Every other transition is a straight idempotent write.
- `subscription_status` stays the single cached access authority; the webhook records only explicit Stripe events and never infers a lapse from downtime (NFR-R4).
- The Settings Billing section branches on cached state: `active`/`past_due` → "Manage billing" (`BillingManage`, Stripe portal); `trial`/`read_only` → "Add billing" (`BillingStart`, checkout). Both Admin-only, enforced server-side.

**Never:**
- Never build a custom card/payment form, render prices or invoices in-app, or collect card data (FR53).
- Never add read-only *enforcement* (blocking writes), the trial banner, or reminder emails — Story 7.4 (this story only *records* state; 7.4 gates on it). Never build the tier-change prompt or reconciliation cron — Story 7.5.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior | Error Handling |
|----------|--------------|-------------------|----------------|
| Open portal | Admin, `status='active'`, stored `stripe_customer_id`, taps "Manage billing" | Create portal session (`customer`=stored id, `return_url`→ settings `#billing`); return `{ data:{ url } }`; button disabled "Redirecting…" | Stripe error → `AppError(500,"billingUnavailable")` |
| No customer | Admin, no `stripe_customer_id` (e.g. trial) | Rejected before Stripe call | `AppError(409,"noSubscription")` |
| Non-admin | Member / non-member hits route | Rejected before Stripe call | 403 `forbidden` / 401 `unauthorized` |
| Payment paid | `invoice.paid`, valid sig, org resolvable, not `read_only` | Org `status='active'` (re-affirm) | Unresolvable org → log + 200 |
| Payment failed | `invoice.payment_failed`, valid sig, not `read_only` | Org `status='past_due'` | Unresolvable org → log + 200 |
| Invoice event on canceled org | `invoice.paid`/`invoice.payment_failed`, org already `read_only` | No state change (read_only is terminal) — only a new checkout reactivates | Logged as skipped + 200 |
| Canceled | `customer.subscription.deleted`, valid sig | Org `status='read_only'` | Unresolvable org → log + 200 |
| Re-delivery | Same lifecycle event twice | No-op (status already at target) | N/A |
| Invalid signature | Bad/absent `stripe-signature` | Rejected, not processed | 400 |
| Billing surface: manageable | Admin, `status ∈ {active, past_due}` | Settings shows "Manage billing" (`BillingManage`, portal) | N/A |
| Billing surface: checkout | Admin, `status ∈ {trial, read_only}` | Settings shows "Add billing" (`BillingStart`, checkout) | N/A |

</frozen-after-approval>

## Code Map

- `src/app/api/stripe/webhook/route.ts` -- EXTEND. Verifies sig (raw `req.text()` first, `runtime="nodejs"`), routes only `checkout.session.completed`→`handleCheckoutCompleted` (~L75-167), else 200 `{received:true}`. Add `invoice.paid` / `invoice.payment_failed` / `customer.subscription.deleted` handlers reusing the org-resolve + admin-update shape; keep outer try/catch → always-200.
- `src/app/api/stripe/checkout/route.ts` (+`schemas.ts`) -- TEMPLATE for the new portal route: `requireUser`→`resolveAdminIdentity`→Zod→admin-client org read→Stripe call→`json({data:{url}})`→`handleError` (customer read ~L74-107, URL build ~L115-126).
- `src/lib/stripe/client.ts` -- `getStripeClient()` singleton, `STRIPE_API_VERSION="2026-04-22.dahlia"`; `billingPortal` lives here. No change.
- `src/types/db.ts` -- `SubscriptionStatus` (L101, `"trial"|"active"`); `OrganizationRow.subscription_status` (L117), `stripe_customer_id` (L134), `stripe_subscription_id` (L139). Widen per Open Question.
- `supabase/migrations/20260930130000_*.sql` -- style reference (text + CHECK + `COMMENT ON COLUMN`, never PG enum); new migration `ALTER`s the `subscription_status` CHECK and adds a UNIQUE index on `stripe_subscription_id`, sorts last.
- `src/app/[slug]/settings/page.tsx` -- Billing `<section id="billing">` (~L81-91) always renders `<BillingStart slug>`; read org `subscription_status` via the in-scope admin client (handle the read `error` explicitly — do not silently default an errored read to `trial` and hide Manage from an active admin) and branch: `active`/`past_due` → `BillingManage`, `trial`/`read_only` → `BillingStart`.
- `src/components/settings/BillingStart.tsx` -- MIRROR for new `BillingManage.tsx` (`useState<"idle"|"redirecting">`, POST, `window.location.href=data.url`, disabled state, `resolveError`, `useTranslations("Billing")`).
- `src/lib/api/route-helpers.ts` (`json`,`requireUser`,`resolveAdminIdentity→{client,actorId,orgId}`,`handleError`), `src/lib/supabase/admin.ts` `createAdminClient()`, `src/lib/auth/rbac.ts` `requireAdmin`.
- `src/lib/i18n/en.json` + `fr.json` -- `Billing` namespace (~L170-182); add `manageButton`, `manageRedirecting`, `manageNote`, `error.noSubscription`. No em-dashes.
- `tests/unit/route-stripe-webhook.test.ts`, `route-stripe-checkout.test.ts` -- mock patterns (`constructEvent`, `billingPortal.sessions.create`, `createAdminClient`, `reportError`) to mirror.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<new-ts>_widen_subscription_status_lapse_states.sql` -- NEW additive migration: recreate the `subscription_status` CHECK as `('trial','active','past_due','read_only')`; repo-style `COMMENT ON COLUMN`; default `'trial'`, NOT NULL. Add a UNIQUE index on `stripe_subscription_id` (webhook resolves the org by it; one subscription belongs to exactly one org — unique documents+enforces that invariant so `.maybeSingle()` cannot throw on duplicates). NOT-NULL is not required on the index column (it stays null pre-checkout).
- [x] `src/types/db.ts` -- widen `SubscriptionStatus` to match the migration.
- [x] `src/app/api/stripe/portal/route.ts` (+`schemas.ts`) -- NEW `POST`: `requireUser`→`resolveAdminIdentity(slug,user)`→Zod `{ slug }`→read org `stripe_customer_id` via admin client (null → `AppError(409,"noSubscription")`)→`billingPortal.sessions.create({ customer, return_url:<settings>#billing })`→`json({data:{url},error:null})`; wrap in `handleError`.
- [x] `src/app/api/stripe/webhook/route.ts` -- add the three events. `customer.subscription.deleted`→`read_only` (straight write). `invoice.paid`→`active` and `invoice.payment_failed`→`past_due`, BUT read the org's current `subscription_status` first and SKIP the write (log as skipped) when it is already `read_only` — read_only is terminal; only `checkout.session.completed` reactivates. Resolve org by `stripe_subscription_id` (indexed) with `subscription_data.metadata.org_id` fallback; write via `createAdminClient()`, idempotent; unresolvable → log + 200.
- [x] Billing UI via the `/web-uiux-architect` skill -- `src/components/settings/BillingManage.tsx` (mirror `BillingStart`: "Manage billing" button → `POST /api/stripe/portal`, disabled "Redirecting…", inline `role="alert"` error map, `useReducedMotion`-aware, WCAG AA) + branch `settings/page.tsx`: `active`/`past_due` → `BillingManage`, `trial`/`read_only` → `BillingStart`; handle the org-read `error` explicitly (do not silently fall back to `trial`).
- [x] `src/lib/i18n/en.json` + `fr.json` -- add `Billing.manageButton`/`manageRedirecting`/`manageNote`/`error.noSubscription` (EN + FR, no em-dashes).
- [x] `tests/unit/` -- portal route (admin gate; missing customer → 409; session args include `customer`+`return_url`) and the webhook events: `customer.subscription.deleted`→`read_only`; `invoice.paid`→`active` and `invoice.payment_failed`→`past_due` when NOT read_only; **read_only-terminal: `invoice.paid`/`invoice.payment_failed` on a `read_only` org performs no write (200)**; org resolved via the `metadata.org_id` fallback (subscription-id miss) **and via the invoice `parent.subscription_details.metadata` fallback**; the expanded-object and string `subscription` shapes; invalid sig still 400; duplicate no-op; unresolvable org → 200. Settings-page branch: `active`/`past_due`→`BillingManage`, `trial`/`read_only`→`BillingStart`. Mock Stripe SDK + Supabase mirroring existing tests.

**Acceptance Criteria:**
- Given an Admin with `subscription_status ∈ {active, past_due}`, when they open Billing and tap "Manage billing", then they reach the Stripe-hosted Customer Portal (update card, view invoices, cancel anytime, no contract) with no in-app billing form (FR31), and the button shows a disabled "Redirecting…" state.
- Given an Admin with `subscription_status ∈ {trial, read_only}`, when they open Billing, then they see "Add billing" (checkout) — a `read_only` (canceled) org re-subscribes via a fresh checkout rather than a portal that cannot restart a deleted subscription.
- Given a portal change, when Stripe fires `customer.subscription.deleted` / `invoice.payment_failed` / `invoice.paid`, then the signature-verified webhook updates the cached `subscription_status` accordingly and idempotently.
- Given an org already in `read_only`, when a (possibly out-of-order or redelivered) `invoice.paid` or `invoice.payment_failed` arrives, then its status is NOT changed — only a new `checkout.session.completed` reactivates it — so a canceled account is never silently restored.
- Given a non-admin, or a trial admin with no Stripe customer, when the portal route is called, then it is rejected (401/403, or 409 `noSubscription`) before any session is created, and Members see no billing surface.
- Given an invalid/absent signature, then the webhook rejects (400) and does not process; an unhandled event or unresolvable org is acknowledged 200 with no state change.

## Implementation Notes

- **Migration** `20260930140000_widen_subscription_status_lapse_states.sql`: recreates `organizations_subscription_status_check` as `('trial','active','past_due','read_only')` (NOT NULL, default `'trial'`); adds a **partial UNIQUE** index `organizations_stripe_subscription_id_key` on `stripe_subscription_id WHERE NOT NULL` — enforces one-sub-per-org (so `.maybeSingle()` cannot throw) while keeping multiple nulls legal pre-checkout. Applied to the linked `snapbusy-test` project via Supabase MCP for validation (per 7.1/7.2 precedent; Docker unavailable). The committed file is authoritative for local `db:reset`/deploy.
- **Webhook**: `switch` adds `customer.subscription.deleted`→`read_only` (straight write) and `invoice.paid`→`active` / `invoice.payment_failed`→`past_due` via `handleInvoiceStatus`, which reads the org's current status and **skips the write when already `read_only`** (terminal; logged via `reportError`) — only `checkout.session.completed` reactivates. Org resolved by `stripe_subscription_id` (unique index) with `metadata.org_id` fallback; `extractSubscriptionId` handles string + expanded-object + `parent.subscription_details` shapes; `invoiceSubscriptionMetadata` checks `parent.subscription_details.metadata` and the legacy top-level shape. Unresolvable org → log + 200; outer always-200 catch unchanged.
- **Portal route** + **UI** as specced: admin-gated `POST`, 409 `noSubscription` before any Stripe call, `billingPortal.sessions.create({ customer, return_url })`. `BillingManage` mirrors `BillingStart`. Settings branch `active`/`past_due`→Manage, `trial`/`read_only`→Add, and **throws** `AppError(500)` on the `subscription_status` read error rather than defaulting to `trial`.
- **Verified independently:** targeted `npx vitest run` of the three files → 38 passed; full suite 941 passed (implementer); `npm run type-check` clean; `npm run lint` clean (only the pre-existing eslintrc-deprecation warning).
- **Not run** (needs Stripe CLI + live keys): `stripe listen` end-to-end trigger of the three events and the manual portal walkthrough. Signature/state coverage is in unit tests; an E2E Stripe pass before release remains prudent.
- **Review pass 2 patches (RT-16..RT-19), applied directly (SendMessage unavailable):** (1) wrapped `billingPortal.sessions.create` in try/catch → `AppError(500,"billingUnavailable")` so a Stripe error conforms to the frozen matrix + docstring, with a covering portal test; (2) webhook test for the realistic `parent.subscription_details.subscription` extractor shape; (3) webhook test proving `checkout.session.completed` reactivates a `read_only` org to `active` (the read_only-terminal guard is invoice-only); (4) webhook test for the invoice status pre-read error branch (caught → 200, no write). Re-verified: 42 targeted tests pass; type-check + lint clean.

## Spec Change Log

### Change 1 (review loop 1) — intent-gap resolution (RT-1, RT-2)

- **Triggering findings:** RT-1 (out-of-order `invoice.paid` silently reactivates a canceled `read_only` org) and RT-2 (`past_due`/`read_only` admins fell through to "Add billing" and could not reach the portal). Both traced into the frozen block, so the first implementation was reverted and the human renegotiated the frozen intent.
- **Amended:** frozen Intent/Boundaries/matrix now specify (a) `read_only` is terminal for `invoice.*` events — only `checkout.session.completed` reactivates; (b) the Settings surface maps `active`/`past_due`→"Manage billing" and `trial`/`read_only`→"Add billing". Non-frozen Tasks/Code Map/Design Notes updated to match, and folded in the low-value hardening (RT-5 UNIQUE index, RT-6 explicit settings read-error handling, RT-3/RT-4 added test coverage for the read_only-terminal skip and the invoice metadata / multi-shape extractor fallbacks).
- **Known-bad avoided:** a redelivered/late invoice event restoring paid access to a cancelled account; and a failed-payment Admin unable to update their card (being pushed into a duplicate Solo checkout instead).
- **KEEP (must survive re-derivation):** the portal route shape (admin gate → `stripe_customer_id` read → `billingPortal.sessions.create({ customer, return_url })` → `{data:{url}}`, 409 `noSubscription` when no customer); the webhook's raw-body/signature path, always-200 outer catch, and org-resolution by `stripe_subscription_id` with `metadata.org_id` fallback; `BillingManage` as a faithful mirror of `BillingStart` (disabled "Redirecting…", `role="alert"`, `useReducedMotion`, WCAG-AA); EN+FR i18n with no em-dashes; migration validated against the linked `snapbusy-test` project when Docker is unavailable.

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **RT-1 (out-of-order reactivation) — `medium` → intent_gap.** `updateOrgStatus` (`webhook/route.ts`) writes `subscription_status = target` unconditionally with no read of the current state. Verified real: Stripe does not guarantee event order and redelivers failed events, so a late/redelivered `invoice.paid` (or `invoice.payment_failed`) arriving after `customer.subscription.deleted` silently moves a `read_only` org back to `active`/`past_due`, restoring access to a canceled account. The fix (a monotonicity guard / read_only-terminal rule) contradicts the FROZEN I/O matrix row `invoice.paid → active` and the frozen "idempotently" approach, so it needs human renegotiation, not a silent patch. (Blind-hunter #1/#2, edge-case #2 grouped here.)
- **RT-2 (billing surface for lapse states) — `medium` → intent_gap.** `settings/page.tsx` branches `status === "active" ? BillingManage : BillingStart`, so the `past_due` and `read_only` states this story introduces fall through to "Add billing". Verified real: a `past_due` admin (has a Stripe customer, failed payment) sees "Add billing" and cannot reach the portal to update their card, and "Add billing" would start a brand-new Solo checkout. The FROZEN Boundary enumerated only `trial→Start` / `active→Manage`; the correct surface for `read_only` (canceled) is genuinely ambiguous (portal invoice-history vs. fresh re-subscribe checkout), so it needs human input. (Edge-case #6.)
- **RT-3 (invoice metadata-fallback path untested) — `low`/patch (pre-verified gap).** `invoiceSubscriptionMetadata` (`parent.subscription_details.metadata`) is never exercised with data that resolves an org; a regression to `null` would silently no-op and CI stay green. Real but low; moot under the loopback (code + tests re-derived). Will fold an explicit test into the re-derivation. (Verification-gap primary.)
- **RT-4 (multi-shape extractors undertested) — `low`.** `extractSubscriptionId` expanded-object branch and the non-`parent` `subscription_details.metadata` fallback lack cases. Low; fold coverage on re-derive. (Blind-hunter #4.)
- **RT-5 (non-unique index vs `.maybeSingle()`) — `low`.** `organizations_stripe_subscription_id_idx` is non-unique while `updateOrgStatus` resolves via `.maybeSingle()` (throws on >1 row). Unreachable in practice (subscription ids are unique per org by construction) but the invariant is undocumented. Will make the index `unique` on re-derive to document+enforce it. (Blind-hunter #7, edge-case #4.)
- **RT-6 (settings read ignores `error`) — `low`.** `settings/page.tsx` destructures only `data`, so a transient read error defaults to `trial` and hides "Manage billing" from an active admin. Transient, self-heals on reload; minor robustness to fold on re-derive. (Edge-case #5.)
- **RT-7 (cancel_at_period_end not recorded) — `false`.** `customer.subscription.deleted` fires at true end-of-life (period end for cancel-at-period-end), not at the cancel request, so writing `read_only` at the deletion event is correctly timed; a mid-period cancel keeps the sub until `deleted` fires. No defect. (Blind-hunter #3.)
- **RT-8 (first-invoice-before-subid timing) — `low`/false.** An `invoice.paid` arriving before `checkout.session.completed` persists `stripe_subscription_id` is harmless: the checkout handler also sets `active`, so activation is not lost. Negligible; a customer-id fallback adds surface for no real gain. (Edge-case #3.)
- **RT-9 (`payment_action_required`/incomplete not handled) — defer.** These fall to the 200 no-op default. AC#2 names only the three lifecycle events; SCA/incomplete handling is outside this story's intent. Defer. (Blind-hunter #6.)
- **RT-10 (`return_url` from request origin) — `low`/false.** Derived from `req.nextUrl.origin` with no allow-list, but this mirrors the 7.2 checkout route (accepted precedent), the redirect target is the admin's own session, and deployment terminates on a trusted proxy. Not attacker-exploitable here. (Blind-hunter #8.)
- **RT-11 (portal body parsed before auth) — `low`/false.** A malformed body from an unauthenticated caller returns 400 before 401. Matches the 7.2 checkout template exactly (7.2 review accepted this as negligible); auth still precedes every Stripe call and all 401/403 tests send well-formed bodies. No defect. (Verification-gap other.)
- **RT-12 (metadata → nonexistent org zero-row update not logged) — `low`.** When the metadata-fallback org id points to a deleted org, the `UPDATE ... eq("id")` affects zero rows silently. Reachable only if an org was deleted while its signed Stripe events still arrive — negligible; a rows-affected guard adds surface. (Edge-case #1.)
- **RT-13 (stray foreign `org_id` in metadata) — `false`.** `metadata.org_id` is set by our own checkout route inside signature-verified events; an attacker cannot forge it without the webhook secret. Not attacker-controllable. (Edge-case #7.)
- **RT-14 (BillingManage has no direct unit test) — `low`.** The client component is only stubbed in the settings-page test. Mirrors the repo's accepted convention for `BillingStart` (7.2); awareness only. (Verification-gap other.)
- **RT-15 (`noSubscription` reachable only via race; `manageNote` names Stripe vs generic `portalNote`; spec "32 passed" reconciliation) — `low`/reject.** Copy/doc nits; the "32 passed" item's only fix is editing this build's spec (rejected by rule). No functional harm. (Blind-hunter #5/#9/#10.)

**Routing:** RT-1 and RT-2 are `intent_gap` (root cause inside the frozen block). Their existence triggers a loopback to the human; all lower entries are moot because the code will be re-derived. RT-3/4/5/6 will be folded into the re-plan so re-derivation is coherent.

### Pass 2 (review_loop_iteration 1)

- **RT-16 (`billingUnavailable` not produced on a Stripe error) — `low` → patch.** Verified real: the portal route's `billingPortal.sessions.create` is not wrapped, so a thrown Stripe error falls through `handleError` as `genericError`, contradicting the FROZEN matrix row (`Open portal → Stripe error → AppError(500,"billingUnavailable")`) and the route docstring. The re-derivation regressed the pass-1 wrap. Fix conforms code to the frozen spec (no frozen change): wrap the create → `AppError(500,"billingUnavailable")`, add a portal test. Also closes the matrix-test-audit gap for that row. (Edge-case #5 = blind #1 = verification-gap other.)
- **RT-17 (realistic `parent.subscription_details.subscription` extractor untested) — `low`/patch (pre-verified gap).** On the pinned `2026-04-22.dahlia` API the invoice→subscription linkage lives at `parent.subscription_details.subscription`; `extractSubscriptionId` handles it but no test exercises it (tests use top-level `subscription` or the `parent...metadata` fallback). A regression would silently no-op a real payment event with CI green. → patch: add a webhook test for that shape. (Verification-gap primary, blind #8.)
- **RT-18 (reactivation-via-checkout invariant untested) — `low` → patch.** The load-bearing rule this loop protects ("only `checkout.session.completed` reactivates a `read_only` org") is asserted nowhere; `handleCheckoutCompleted` writes `active` unconditionally (verified — works), but untested. → patch: add a webhook test (org `read_only` → `checkout.session.completed` → `active`). (Blind #6.)
- **RT-19 (invoice status-read error branch untested) — `low` → patch.** `handleInvoiceStatus` throws on the `subscription_status` pre-read error (outer catch → 200); no test drives it. → patch: add a webhook test (`orgById` errors → 200, no update). Optionally also the legacy top-level `subscription_details.metadata` fallback. (Blind #5, verification-gap other.)
- **RT-20 (settings read-error throws the whole page) — `low`/reject.** The specced "throw so the page fails visibly" nukes the Invite/Profile sections too when the `subscription_status` read errors, and there is no `error.tsx`. But the read uses the same admin client that just resolved `requireAdmin`, so the trigger is near-impossible; adding an error boundary / per-section fallback is architectural, beyond a direct correction, and it matches the page's existing throw-on-error posture. Reject. (Blind #2.)
- **RT-21 (`resolveOrgForSubscription` builds its own admin client) — `low`/reject.** Defeats the stated `writeOrgStatus` client-reuse optimization, but `createAdminClient()` is a cheap constructor and correctness is unaffected. Negligible; reworking helper signatures adds churn for no real gain. (Blind #3.)
- **RT-22 (`manageRedirecting` duplicates `redirecting`) — `low`/reject.** A redundant i18n key holding the same string, but it is specced (independent copy affordance) and harmless. (Blind #7.)
- **RT-23 (7.1/7.2 migration comments still say "7.4 will widen") — `low`/reject.** Stale cross-references in already-shipped migration files; editing historical migrations for a comment is riskier than the staleness. Noted, not fixed. (Blind #9.)
- **RT-24 (zero-row / null-row edges: metadata→deleted org, invoice status row absent, `billingRow` null, unique-index abort on pre-existing dup subscription ids) — `low`/reject.** All require states unreachable by construction (org rows exist for a resolved admin; subscription ids are unique per org; the migration applied clean on the linked test project). Negligible; guards add surface. (Edge-case #1/#2/#3/#4, carries RT-12.)
- **RT-25 (`manageNote` names Stripe vs generic `portalNote`) — `low`/reject.** Carries RT-15: copy nit, no functional harm. (Blind #10.)

**Routing:** No `intent_gap` or `bad_spec` — no loopback. RT-16..RT-19 route to `patch` (auto-fix via the implementer); all other Pass 2 entries are `low`/reject.

## Design Notes

- **`read_only` is terminal (reactivation policy).** The invoice handlers read the org's current `subscription_status` and skip the write when it is already `read_only`; only `checkout.session.completed` moves an org out of `read_only`. Stripe does not guarantee event ordering and redelivers failed events, so without this guard a stale/late `invoice.paid` would restore paid access to a canceled account. `customer.subscription.deleted`→`read_only` and the non-read_only `invoice.*` transitions stay straight idempotent writes.
- **Differentiated billing surface.** `active`/`past_due` → "Manage billing" (portal: a failed-payment Admin fixes their card there). `trial`/`read_only` → "Add billing": a `read_only` org's subscription is deleted, and the Stripe portal cannot restart a deleted subscription, so re-subscribing via a fresh checkout is the correct recovery (checkout reuses the stored `stripe_customer_id`). The settings read handles its `error` explicitly rather than defaulting an errored read to `trial`.
- **Org resolution for non-checkout events.** `customer.subscription.deleted` carries the subscription (its `id` = our `stripe_subscription_id`, plus `metadata.org_id` from 7.2's `subscription_data.metadata`); `invoice.*` carry `subscription`+`customer`. Resolve by `stripe_subscription_id` first, fallback `metadata.org_id` (invoice: `parent.subscription_details.metadata`); the `stripe_subscription_id` index is UNIQUE so the invariant "one subscription ↔ one org" is enforced and `.maybeSingle()` cannot throw on duplicates.
- **Portal config is a Dashboard concern.** `billingPortal.sessions.create` with no `configuration` uses the account default; enabled features are set in the Stripe Dashboard, not code. Document as a release prerequisite.

## Verification

**Commands:**
- `npm run test -- tests/unit/route-stripe-portal tests/unit/route-stripe-webhook tests/unit/settings-page` -- expected: pass (portal admin-gate + 409; `deleted`→read_only; non-read_only `invoice.paid`→active / `invoice.payment_failed`→past_due; read_only-terminal skip; metadata + multi-shape fallback resolution; invalid-sig 400; duplicate no-op; unresolvable-org 200; settings branch active/past_due→Manage, trial/read_only→Add).
- `npm run type-check` -- expected: clean (all `SubscriptionStatus` consumers compile against the widened union).
- `npm run lint` -- expected: clean (only the pre-existing eslintrc-deprecation warning).
- `npm run db:reset` (if Docker up) -- expected: CHECK-widening migration applies; new states accepted. If unavailable, validate against linked `snapbusy-test` via Supabase MCP (7.1/7.2 precedent).

**Manual checks (if no CLI):**
- Stripe CLI `stripe listen` → trigger the three events; confirm `subscription_status` moves to the expected value and re-delivery is a no-op. Open the portal via the button; confirm card-update, invoice history, and cancel are present.
