---
title: 'Tier View, Tier-Change Prompt & Tier Reconciliation'
type: 'feature'
created: '2026-09-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '690e41a2d59da33063575d382403fa8ab322ac1c'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Stories 7.1-7.4 record the cached subscription state and gate access, but a subscribed Admin has no in-app view of *what plan they are on, what it includes, or when they are billed next* (FR54), there is no prompt to move up a plan when invoicing volume outgrows the current tier (FR55, the no-silent-overage trust promise), and nothing detects when the tier held in Stripe drifts from the stored `subscription_tier` (NFR-R5, billing-accuracy trust requirement). Checkout/portal exist but the account can silently sit on a wrong or outgrown tier with no signal.

**Approach:** Add a read-only tier-view card to the Settings billing section showing the current tier, its inclusions, and next billing date (fetched live from Stripe), with no usage meter or spend cap. Compute invoicing volume per billing cycle from the Epic 12 `invoices` table and surface a non-blocking upgrade prompt (never an auto-charge) when the last completed cycle's issued-invoice count exceeds the tier's configured band; the prompt's CTA routes to the existing Stripe Customer Portal. Add a `CRON_SECRET`-protected per-cycle Vercel Cron that compares each subscribed org's Stripe-held tier against the stored `subscription_tier` and pages Sentry on any drift, correcting nothing.

## Boundaries & Constraints

**Always:**
- The tier-view card renders only for orgs with a subscription (`active` / `past_due`, i.e. a non-null `subscription_tier` + `stripe_subscription_id`); it shows the tier label, the inclusions list (unlimited team members, customers, historical records, and import — no per-seat or per-record charge), and the next billing date. Trial / read_only orgs keep the existing `BillingStart` (add-billing) surface unchanged — no tier card.
- Next billing date and the authoritative current tier come from a live Stripe fetch of the subscription (`stripe.subscriptions.retrieve(stripe_subscription_id)`); the period boundary used for volume counting is the subscription's current billing period. If the Stripe fetch fails, degrade gracefully: render the tier label and inclusions from the cached `subscription_tier` and omit the next-billing-date (log via `reportError`), never block the page.
- Billing surfaces stay Admin-only (Member RBAC excludes billing): the tier card and upgrade prompt render only for admins, reached through the already-admin-gated Settings page.
- The tier-change prompt is a non-blocking suggestion, never a gate and never an auto-charge. Its CTA reuses the Customer Portal path (same as `BillingManage`), where the owner changes plan on Stripe-hosted UI. Shop (top tier) never prompts.
- Tier bands (issued invoices per cycle per tier) and tier inclusions live as configuration in the billing lib (mirroring `tiers.ts` module style), documented as provisional pending willingness-to-pay validation — tunable without structural change. **Decision (trigger):** provisional bands are Solo ≤ 20, Crew ≤ 100, Shop = no cap (Shop never prompts); the prompt fires when the **last fully-completed billing cycle's** issued-invoice count exceeds the current tier's band (a single completed over-band cycle is the sustained signal — a mid-cycle partial count never triggers). The bands may later be tightened to a two-consecutive-cycle rule without structural change.
- The reconcile cron (`GET /api/cron/reconcile-tier`, `runtime="nodejs"`) rejects any request without `Authorization: Bearer ${CRON_SECRET}` (401, no work) and reads/writes via the service-role admin client. For each subscribed org it retrieves the Stripe subscription, reverse-maps the price id to a tier via `priceIdToTier`, and on any mismatch vs stored `subscription_tier` emits a high-severity Sentry alert (via `reportError` / a `fatal`-level variant) carrying `{ orgId, storedTier, stripeTier }`; one failing org is logged and never aborts the sweep.

**Never:**
- Never show a usage meter, quota countdown, remaining-invoice count, or spend cap anywhere (flat-tier predictability — FR54). Never auto-charge, auto-upgrade, or meter overage when a band is exceeded (FR55).
- Never have the reconcile cron *mutate* `subscription_tier` / `subscription_status` to "fix" drift — it alerts only; the webhook remains the sole writer of tier (billing accuracy is surfaced for a human, not silently reconciled). Never let reconciliation affect the access path (`subscription_status` stays the access authority).
- Never build a bespoke in-app plan-switcher, card form, or price table — plan changes happen on the Stripe Customer Portal. Never gate reads or writes here (that is 7.4). Never add new `subscription_status` states or touch the trial/offboarding lifecycle.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tier view, subscribed | Org `active`/`past_due`, tier set, Stripe fetch ok | Card shows tier label, inclusions, next billing date; no meter | N/A |
| Tier view, Stripe down | Subscribed org, `subscriptions.retrieve` throws | Card shows tier label + inclusions from cached tier, no next-billing-date | `reportError`, page still renders |
| Tier view, trial/read-only | Org `trial` or `read_only` | No tier card; existing add-billing surface only | N/A |
| Upgrade prompt shown | Subscribed, last completed cycle issued count > band for current tier, tier < Shop | Non-blocking prompt with "move up a plan" CTA to Customer Portal | N/A |
| Upgrade prompt hidden | Count within band, or already Shop, or no completed cycle yet | No prompt | N/A |
| Reconcile match | Cron authed, Stripe tier == stored tier | No alert; counted as checked | N/A |
| Reconcile drift | Cron authed, Stripe tier != stored tier | High-severity Sentry alert `{orgId,storedTier,stripeTier}`; no DB write | logged, sweep continues |
| Reconcile, Stripe error | `subscriptions.retrieve` throws / 404 for one org | That org logged via `reportError`; sweep continues | per-org isolation |
| Reconcile unauthorized | Missing/invalid `Bearer CRON_SECRET` | Rejected, no reads/writes | 401 |

</frozen-after-approval>

## Code Map

- `src/lib/billing/tiers.ts` -- `TIERS`, `DEFAULT_TIER`, `getPriceIdForTier`, `priceIdToTier` (reverse lookup, reuse for cron + view), `isSubscriptionTier`. ADD provisional `TIER_INVOICE_BANDS: Record<SubscriptionTier, number | null>` (null = no cap) and a tier-ordering helper (`nextTierUp`) for the prompt. Server-only, lazy-env style.
- `src/lib/billing/access.ts` -- module-style reference (pure, dependency-light) for a new `src/lib/billing/tier-prompt.ts`.
- `src/lib/billing/tier-prompt.ts` -- NEW. Pure `shouldPromptUpgrade({ tier, issuedThisCycle, ... })` predicate + `resolveTierInclusions(tier)` (or keep inclusions as i18n keys). Mirrors `access.ts`.
- `src/lib/stripe/client.ts` -- `getStripeClient()` (lazy singleton, API `2026-04-22.dahlia`). Reuse for the view fetch + cron. NOTE: on this API version the billing-period fields live on the subscription **item** (`subscription.items.data[0].current_period_end`), not top-level — read from the item (webhook already handles items).
- `src/app/api/stripe/webhook/route.ts` -- reference for how a Stripe subscription's price id maps to a tier (`priceIdToTier`) and item extraction.
- `src/lib/data/invoices.ts` -- `listInvoices` (RLS query style). ADD `countIssuedInvoicesInPeriod(client, orgId, startDate, endDate)` counting `status in ('issued','paid')` by `issue_date` in `[start, end)`.
- `supabase/migrations/20260930150000_add_trial_reminder_tracking_to_organizations.sql` -- latest migration (style reference: additive, forward-only, `COMMENT ON`). New index migration sorts after it.
- `src/app/[slug]/settings/page.tsx` -- server component, `#billing` section (~L122), admin-gated (`requireAdmin` ~L47). EXTEND the org select to `subscription_status, subscription_tier, stripe_subscription_id`; for subscribed orgs fetch the Stripe subscription + compute the volume-vs-band result server-side; render `<TierView>` inside the billing section. Handle Stripe-fetch failure per the matrix.
- `src/components/settings/BillingStart.tsx` / `BillingManage.tsx` -- client-component + Customer-Portal-CTA reference (props = `{ slug }`, `useReducedMotion`, error-key switch). `BillingManage`'s portal POST is the CTA target for the upgrade prompt.
- `src/components/settings/TierView.tsx` -- NEW client component (see Tasks).
- `src/app/api/cron/trial-lifecycle/route.ts` -- EXACT cron pattern to mirror (CRON_SECRET 401 gate, `runtime`/`dynamic` exports, `createAdminClient()` scan, per-item try/`reportError`/continue, `{ data, error }` summary via `json`/`handleError`).
- `src/lib/observability/report.ts` -- `reportError(err, context)` → Sentry `captureException` (DSN-gated, fire-and-forget). ADD a `fatal`-level variant (e.g. `reportCritical`) for drift paging, or pass through `reportError` (exceptions default to `error` severity, already alert-worthy).
- `src/lib/supabase/admin.ts` -- `createAdminClient()` (service-role) for the cron scan.
- `src/lib/api/route-helpers.ts` -- `json`, `handleError`, `AppError` envelope.
- `vercel.json` -- current `crons` = `[{ trial-lifecycle, "0 12 * * *" }]`. ADD the reconcile-tier cron entry.
- `src/lib/i18n/en.json` + `fr.json` -- `Billing` namespace (~L170). ADD tier-view keys (tier labels, inclusions list, next-billing-date with ICU `{date, date, medium}`, upgrade-prompt title/body/CTA), EN + FR, no em-dashes.
- `.env.example` -- `CRON_SECRET` (L22) + `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` already present; no new env vars.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/billing/tiers.ts` -- add `TIER_INVOICE_BANDS` (provisional per decision) + a `nextTierUp(tier)` helper; keep `priceIdToTier` as the reverse-map reused by the cron and view.
- [x] `src/lib/billing/tier-prompt.ts` -- NEW pure module: `shouldPromptUpgrade(tier, issuedLastCycle)` (per the approved trigger rule; false for Shop / under-band / no-data) mirroring `access.ts`.
- [x] `src/lib/data/invoices.ts` -- add `countIssuedInvoicesInPeriod(client, orgId, startDate, endDate)`: count `invoices` where `organization_id=orgId`, `status in ('issued','paid')`, `issue_date >= startDate and issue_date < endDate`. RLS-scoped client.
- [x] `supabase/migrations/2026093016XXXX_add_invoices_issued_period_index.sql` -- NEW additive, forward-only: partial index `on invoices (organization_id, issue_date) where status in ('issued','paid')` to support per-cycle counting; repo-style `COMMENT ON INDEX`. No column/constraint changes.
- [x] `src/components/settings/TierView.tsx` -- NEW client component built via the `/web-uiux-architect` skill, mirroring `BillingStart` (framer-motion `useReducedMotion`, Lucide icon, `useTranslations("Billing")`). Props: `{ slug, tier, nextBillingDate (ISO | null), showUpgradePrompt, suggestedTier }`. Renders a plain card: tier label + inclusions bullet list + next-billing-date (omitted when null); when `showUpgradePrompt`, a non-blocking `role="status"` prompt with a "move up a plan" button that POSTs to `/api/stripe/portal` (reuse `BillingManage`'s fetch + redirecting state). No meter, no spend cap. WCAG AA, no layout shift, no em-dashes.
- [x] `src/app/[slug]/settings/page.tsx` -- extend org select to `subscription_status, subscription_tier, stripe_subscription_id`; for `active`/`past_due` orgs with a `stripe_subscription_id`, fetch the subscription (next-billing-date from the subscription item; authoritative tier via `priceIdToTier`), count issued invoices in the last completed cycle via `countIssuedInvoicesInPeriod`, compute `shouldPromptUpgrade`, and render `<TierView>` in the `#billing` section. On Stripe-fetch error, `reportError` and render the degraded card (cached tier, no date, no prompt). Leave trial/read_only path unchanged.
- [x] `src/lib/observability/report.ts` -- add `reportCritical(err, context)` emitting Sentry `captureException` at `level: "fatal"` (console fallback), for drift paging; reuse the DSN-gated lazy-load pattern.
- [x] `src/app/api/cron/reconcile-tier/route.ts` -- NEW `GET` mirroring `trial-lifecycle`: 401 unless `Bearer ${CRON_SECRET}`; `runtime="nodejs"`, `dynamic="force-dynamic"`. Via `createAdminClient()`, load orgs where `subscription_status in ('active','past_due')` and `stripe_subscription_id` not null; for each retrieve the Stripe subscription, reverse-map the item price id to a tier, and on mismatch vs stored `subscription_tier` call `reportCritical(..., { orgId, storedTier, stripeTier })`; per-org errors via `reportError`, sweep continues. Return `{ data: { processed, drifted }, error: null }`. No DB writes.
- [x] `vercel.json` -- add `{ "path": "/api/cron/reconcile-tier", "schedule": "0 3 * * *" }` (daily; satisfies per-cycle, catches drift promptly).
- [x] `src/lib/i18n/en.json` + `fr.json` -- add `Billing` tier-view keys: tier labels (solo/crew/shop), inclusions bullets, `nextBillingDate` (ICU date), `upgradePromptTitle`/`Body`/`Cta`. EN + FR, no em-dashes.
- [x] `tests/unit/` -- cover the I/O matrix: `tier-prompt` predicate (under-band/over-band per the rule, Shop never, no-data); `countIssuedInvoicesInPeriod` (counts issued+paid in window, excludes draft/void and out-of-window); `TierView` render rows (subscribed card, degraded no-date, prompt shown vs hidden, admin-only) via `renderToStaticMarkup`; the reconcile cron (401 unauthorized; match → no alert; drift → `reportCritical` with payload + no DB write; per-org Stripe error → sweep continues); EN/FR copy has no em-dashes. Mock Stripe client + Supabase admin client mirroring existing route/cron tests.

**Acceptance Criteria:**
- Given an Admin on a subscribed org, when they open the billing settings, then they see their current tier, its inclusions, and the next billing date, with no usage meter and no spend cap; given the Stripe fetch fails, then the tier and inclusions still render (no next-billing-date) and the page is not blocked.
- Given a subscribed org whose last completed billing cycle's issued-invoice count exceeds its tier band (and it is not already Shop), when the Admin views billing, then a non-blocking upgrade prompt appears whose CTA opens the Stripe Customer Portal; given the count is within band or the org is Shop, then no prompt appears; in no case is overage metered or charged.
- Given the reconcile-tier cron with a valid `CRON_SECRET`, when it runs, then every subscribed org whose Stripe-held tier differs from the stored `subscription_tier` produces a high-severity Sentry alert carrying the org id and both tiers, no `subscription_tier`/`subscription_status` row is modified, and one org's Stripe error does not abort the sweep; a request without a valid `CRON_SECRET` performs no work and returns 401.
- Given EN and FR locales, when the tier card, inclusions, and upgrade prompt render, then both locales are present and contain no em-dashes.

## Implementation Notes

- **Tier view.** `src/lib/billing/tiers.ts` gained `TIER_INVOICE_BANDS` (Solo 20 / Crew 100 / Shop `null` = no cap) + `nextTierUp`. `settings/page.tsx` (server, already admin-gated) extends the org select to `subscription_status, subscription_tier, stripe_subscription_id`; a new `resolveTierView` helper does a live Stripe `subscriptions.retrieve`, reads the next-billing-date + authoritative tier from the subscription **item** (`items.data[0].current_period_end`/`.price.id` on the pinned `2026-04-22.dahlia` API), counts last-completed-cycle issued invoices via the RLS server client, and computes `shouldPromptUpgrade`. On any Stripe error it `reportError`s and degrades (cached tier, no date, no prompt); the page never blocks. `<TierView>` (client, built via `/web-uiux-architect`) renders above `<BillingManage>` for subscribed orgs only; trial/read_only keep the unchanged add-billing surface.
- **Tier-change prompt.** Pure `src/lib/billing/tier-prompt.ts` (`shouldPromptUpgrade`) fires only when the last fully-completed cycle's issued count strictly exceeds the band and a higher tier exists (Shop never prompts). Volume comes from new `countIssuedInvoicesInPeriod` in `src/lib/data/invoices.ts` (`status in ('issued','paid')` by `issue_date`, half-open window, `count:"exact", head:true`, read error → 0). The prompt CTA reuses `BillingManage`'s `POST /api/stripe/portal` handoff — no in-app plan switcher.
- **Reconciliation cron.** `GET /api/cron/reconcile-tier` mirrors `trial-lifecycle`: `Bearer ${CRON_SECRET}` 401 gate, `runtime="nodejs"`, service-role scan of `active`/`past_due` orgs with a `stripe_subscription_id`, reverse-maps the subscription item price id, and on mismatch (including an unmappable price id) calls new `reportCritical` (Sentry `level:"fatal"`) with `{ orgId, storedTier, stripeTier }`. It writes nothing (webhook stays sole tier writer); a per-org Stripe error is `reportError`d and the sweep continues. Returns `{ processed, drifted }`. `vercel.json` adds the `0 3 * * *` daily cron.
- **Migration.** `20260930160000_add_invoices_issued_period_index.sql` — additive partial index `(organization_id, issue_date) WHERE status in ('issued','paid')`, forward-only, no structural change. **Verified independently** on the linked `snapbusy-test` project via Supabase MCP: the index exists with exactly that definition.
- **Lazy Stripe import (perf).** `settings/page.tsx` loads the Stripe client via `await import("@/lib/stripe/client")` inside `resolveTierView` rather than a top-level import, keeping the large SDK out of the page module's eager graph — the common unauthenticated/trial/read-only settings loads never evaluate it.
- **Test-flake fix (found during verification, not in the implementer report).** The implementer's "full suite green" was wrong: `tests/unit/settings-page.test.tsx`'s first `importPage()` test timed out (5s) under full-suite parallel load. Root cause: that node page-boundary test deliberately stubs every billing/client component to avoid pulling client deps (framer-motion/lucide), but the new `TierView` import was unstubbed, so the test transformed the real framer-motion graph. Baseline (pre-change) was green 3/3; my change flaked. Fix: added a `TierView` stub mirroring the existing `BillingStart`/`BillingManage` stubs. Suite is now stable 3/3 at 1022 tests.
- **Verified independently (judged against the diff, not the implementer report):** `npm run type-check` clean; `npm run lint` clean (only the pre-existing eslintrc-deprecation warning); `npm run test` → **1022 passed (98 files)**, stable across 3 consecutive full runs. Matrix Test Audit: all 9 rows covered by passing tests — tier-view rows (`tier-view.test.tsx`), the trial/read-only no-card row (explicit `not.toContain(TierViewStub)` added to `settings-page.test.tsx`), prompt shown/hidden (`tier-view.test.tsx` + `tier-prompt.test.ts`), and all four cron rows (`route-cron-reconcile-tier.test.ts`); EN/FR no-em-dash copy (`tier-view-copy.test.ts`).
- **Not run (needs live infra):** the end-to-end Vercel Cron trigger with a real `CRON_SECRET` + a real Sentry page on live drift, and a live Stripe `subscriptions.retrieve` against a real subscription. Auth, drift detection, no-write, per-org isolation, graceful degradation, and copy are all covered by unit tests; a live cron + Stripe + Sentry pass before release remains prudent.

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **VG-1 (verification-gap, pre-verified) + BH-4 + BH-5 — `patch`.** `resolveTierView` (settings/page.tsx) is never exercised by any test: the only page-boundary test (`settings-page.test.tsx`) sets a `billingRead` fixture with no `subscription_tier` / `stripe_subscription_id`, so the `showManageBilling && subscriptionId && cachedTier` branch is never entered and `resolveTierView` (next-billing-date derivation, last-completed-cycle window `[periodStart-(periodEnd-periodStart), periodStart)`, `priceIdToTier`→cached fallback, graceful degradation on Stripe throw) ships unverified. A regression (wrong window end, wrong date field, dropped catch) would pass the whole suite. Grouped (one root cause: the composition is untested). → patch: add a `resolveTierView` composition test.
- **BH-6 (blind) — `low` → `patch`.** `countIssuedInvoicesInPeriod` returns `0` on a read error with no `reportError`, so a persistently broken count query silently disables the FR55 upgrade prompt with no signal — while the sibling cron + page paths all log their failures. Safe degradation (never false-charges), but the silent-trust-erosion is real and the fix is a one-line observability add in the existing `if (error)` branch (no new surface/branch). → patch.
- **BH-1 (blind) — `false`.** "UTC `.toISOString().slice(0,10)` window mismatches a local-timezone `issue_date`." Refuted: `issue_date` is itself stamped UTC via `new Date().toISOString().slice(0,10)` at issuance (`invoice-mutate.ts:275`), and the window uses the identical UTC slice — both sides share the UTC "business day" convention (a pre-existing Epic 12 decision), so counting is internally consistent with no boundary drift.
- **BH-2 (blind) — `low` → reject.** "Upgrade prompt can fire for a `past_due` org." Real mechanically, but the frozen spec defines a subscribed org (tier-view + prompt surface) as `active`/`past_due`, and the prompt is a non-blocking advisory whose copy states "You are never charged automatically." `past_due` is mid-dunning (still writable per NFR-R4), the over-band + past_due overlap is uncommon, and suppressing it adds a branch — conforms to intent, everyday harm negligible → reject.
- **BH-3 (blind) — `low` → reject.** "`reportCritical`'s `level:'fatal'` is untested." The cron test asserts `reportCritical` is CALLED with the right `{orgId,storedTier,stripeTier}` payload on drift; only the one-line `level:'fatal'` kwarg inside the 5-line wrapper is unasserted. The repo has no observability/report test at all (the sibling `reportError` is likewise uncovered — a deliberate convention for the thin, DSN-gated, lazy-Sentry-load module), and adding a @sentry/nextjs mock harness is more than a direct correction → reject.
- **BH-7 (blind) — `false`.** "Index lacks `IF NOT EXISTS` and may duplicate existing coverage." Refuted: every repo migration uses plain `create index` (forward-only, never re-run — `IF NOT EXISTS` is not the convention), and no existing index covers partial `(organization_id, issue_date)` on issued/paid (the only invoices index is `invoices_org_created_idx` on `created_at`). The index is additive, correctly styled, and verified applied on `snapbusy-test`.
- **BH-8 (blind) — `low` → reject.** "FR54 no-meter test is a brittle substring check (`meter`/`remaining`)." The assertion is weak, but the component structurally renders no count/quota at all, and a stronger "no numeric quota anywhere" assertion risks false positives (dates/tier labels carry digits). Code is correct; a regression adding a quota is unlikely and would also need new copy keys → reject.
- **BH-9 (blind) — `false`.** "FR `tierCrew`/`tierShop` left as the English word." Refuted: Solo/Crew/Shop are product tier names (proper nouns), intentionally identical across locales (like "Stripe"); `tierSolo` matching is a cognate coincidence, not evidence of an incomplete FR translation.
- **BH-10 (blind) — `low` → reject.** "`nextBillingDate` renders in the browser timezone, so admins in different zones see different dates." Real but cosmetic: at most a one-day visual variance on an approximate billing-period boundary; anchoring to a fixed billing timezone adds config complexity, and co-located org admins rarely hit it → reject.
- **Narrative note (not a routed finding; Edge Case Hunter returned []).** The reconcile route comment / spec say "the webhook already reads items this way," but the webhook reads the price id from the Checkout **session line items**, not `subscription.items.data[0]`. The field the new code reads is correct for `subscriptions.retrieve`; only the cross-reference is imprecise. No code defect → no change.

## Design Notes

- **Alert-only reconciliation.** NFR-R5 asks that drift be *paged before it can affect access*; access is governed by `subscription_status` (7.4), not `subscription_tier`, so the reconcile job stays strictly read-only and raises a human-actionable Sentry alert rather than silently rewriting tier. The webhook remains the single writer of `subscription_tier`, preserving one source of truth and avoiding a cron/webhook write race.
- **Server-rendered tier view, live Stripe read.** The Settings page is already a server component and already admin-gated, so it fetches the Stripe subscription server-side and passes plain props to the client `TierView` (matching the existing server→client settings pattern). `current_period_end` is not stored; reading it live keeps it correct without a new column, and the graceful-degradation path means Stripe downtime never blanks the billing page.
- **Volume from Epic 12, bands as config.** The issued-invoice count reads the fixed `invoices` table (`status in ('issued','paid')`, by `issue_date`) over the subscription's billing period; the tier bands are provisional configuration in the billing lib so willingness-to-pay validation can tune them without code restructuring. The prompt is advisory and routes plan changes to the Stripe-hosted Customer Portal, honoring the "no custom billing UI" mandate.
- **One cron per concern.** Reconciliation is a separate `/api/cron/reconcile-tier` route (not folded into 7.4's trial-lifecycle sweep), mirroring its auth/scan/summary pattern; the two are independent per the epic's one-mechanism-many-sweeps note.

## Verification

**Commands:**
- `npm run test -- tests/unit/<tier-prompt, invoices-count, tier-view, reconcile-tier tests>` -- expected: all pass (prompt predicate; period count; card render rows; cron auth + drift alert + no-write + per-org isolation; EN/FR no em-dashes).
- `npm run type-check` -- expected: clean (new tiers/tier-prompt exports, Stripe subscription-item period typing, TierView props compile).
- `npm run lint` -- expected: clean (only the pre-existing eslintrc-deprecation warning).
- `npm run db:reset` (if Docker/Supabase up) -- expected: the new partial index applies. If unavailable, validate against the linked `snapbusy-test` project via Supabase MCP (7.1-7.4 precedent); the committed migration is authoritative.

**Manual checks (if no CLI):**
- Open Settings billing as an admin on an `active` org and confirm the tier card (label + inclusions + next billing date) with no meter; simulate a Stripe outage and confirm the degraded card still renders.
- Seed issued invoices above the band for a completed cycle and confirm the upgrade prompt appears with a Customer-Portal CTA; drop below the band and confirm it disappears.
- Trigger `GET /api/cron/reconcile-tier` with and without the `Bearer CRON_SECRET` header; confirm 401 without, and with it that a deliberately mismatched stored tier raises a Sentry alert while the row is left unchanged.
