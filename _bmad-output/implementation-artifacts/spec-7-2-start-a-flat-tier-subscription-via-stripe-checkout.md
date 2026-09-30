---
title: 'Start a Flat-Tier Subscription via Stripe Checkout'
type: 'feature'
created: '2026-09-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'd2bbfec452a526e67a7781f5e05df9b159afc570'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A trial account (Story 7.1 set `subscription_status='trial'`) has no way to start paying. The org record has no Stripe linkage and there is no Checkout entry point, so an Admin cannot convert the trial into a flat-tier subscription and later stories (7.3 portal, 7.4 gating, 7.5 tier view) have no `subscription_tier` or Stripe customer/subscription id to read. FR30/FR53 require starting a flat-tier subscription through Stripe-hosted Checkout with no custom billing UI.

**Approach:** Add an Admin-only "Add Billing" surface that redirects to a Stripe-hosted Checkout session for a flat tier's fixed monthly price. **Decision (tier selection):** 7.2 ships a single "Add Billing" button on a default tier (Solo); the Admin changes plan afterward via the Stripe portal (7.3) / tier-change prompt (7.5) — no in-app plan selector this story. On `checkout.session.completed`, a signature-verified webhook flips the org to `subscription_status='active'` and records the purchased `subscription_tier`, `stripe_customer_id`, and `stripe_subscription_id` on the org record (the cached access source of truth). No billing form, card field, or price is rendered by Scheza — only the "Add Billing" button and its "Redirecting…" state.

## Boundaries & Constraints

**Always:**
- Use Stripe-hosted Checkout only. Scheza renders a single "Add Billing" button (default tier: Solo); the card form and price live on Stripe's page (FR53). Checkout runs in `subscription` mode at a fixed per-tier price id from env (`STRIPE_PRICE_SOLO`/`_CREW`/`_SHOP`), with no metered/usage line item. The checkout route stays tier-parameterized (validated `tier ∈ {solo,crew,shop}`) so 7.5's tier change reuses it, but 7.2's button posts the default tier only.
- The redirect button shows a disabled "Redirecting…" state during the handoff.
- Billing surfaces are Admin-only, enforced server-side via the existing `requireAdmin`/`resolveAdminIdentity` chain (Member RBAC excludes billing).
- The webhook verifies every event with `stripe.webhooks.constructEvent` against `STRIPE_WEBHOOK_SECRET`; an invalid signature is rejected (400) and not processed. Handling of `checkout.session.completed` is idempotent (re-delivery must not corrupt state).
- The org's cached `subscription_status`/`subscription_tier` stays the single authoritative access state; the webhook is the only writer of the post-checkout transition. Stripe id columns are the stored linkage for later stories.
- Follow existing conventions: timestamped additive migration with text CHECK + column comments; `{ data, error }` route envelope via `route-helpers`; `AppError` for failures with translated user keys (never leak Stripe internals); keep `src/types/db.ts` `OrganizationRow` in sync.

**Never:**
- Never build a custom card/payment form, render prices in-app, or collect card data (FR53).
- Never introduce metering, usage reporting, overage, or spend caps (flat-tier model); do not reuse the stale `STRIPE_METERED_PRICE_ID`.
- Never add read-only gating, the trial-expiry banner, or trial reminder emails — Story 7.4. Never build the Customer Portal redirect — Story 7.3. Never build the tier-change prompt or reconciliation cron — Story 7.5.
- Never take subscription-state action on lapse/cancel/payment events in this story: the webhook acknowledges `customer.subscription.deleted` / `invoice.payment_failed` / `invoice.paid` with 200 but performs no state change (deferred to 7.3/7.4) so Stripe does not retry-storm.
- Never widen the `subscription_status` CHECK beyond `('trial','active')` — lapse/grace states are Story 7.4's constraint change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Start checkout | Admin taps "Add Billing" (posts default tier `solo`); org has no `stripe_customer_id` | Create (or reuse) Stripe customer, persist `stripe_customer_id`; create subscription-mode Checkout session for `STRIPE_PRICE_SOLO` with `client_reference_id`=orgId and `metadata.org_id`/`metadata.tier`; return `{ data: { url } }` | Missing/invalid tier → `AppError(400,"invalidTier")`; missing price env → `AppError(500,"billingUnavailable")` |
| Non-admin starts checkout | Member (or non-member) hits checkout route | Rejected before any Stripe call | 403 `forbidden` / 401 `unauthorized` |
| Checkout completed | `checkout.session.completed` with valid signature, `metadata.org_id` set | Org set `subscription_status='active'`, `subscription_tier` = tier resolved from the session's price id (or `metadata.tier`), `stripe_subscription_id` stored | Unknown price id / missing org → log + 200 (no crash), no state change |
| Duplicate webhook | Same `checkout.session.completed` delivered twice | Second delivery is a no-op (already `active` with same ids) | N/A |
| Invalid signature | Webhook body with bad/absent `stripe-signature` | Rejected, event not processed | 400, empty/`error` envelope |
| Unhandled event | `invoice.paid` / `subscription.deleted` etc. | Acknowledged, no state change | 200 `{ received: true }` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20260930120000_add_subscription_trial_to_organizations.sql` -- 7.1 migration; mirror its text-CHECK + `COMMENT ON COLUMN` style for the new columns. New file sorts after it (latest migration).
- `src/types/db.ts` -- `OrganizationRow` (~103-117) and `SubscriptionStatus` (~101). Add `subscription_tier: SubscriptionTier | null`, `stripe_customer_id: string | null`, `stripe_subscription_id: string | null`; add `export type SubscriptionTier = "solo" | "crew" | "shop";`.
- `src/lib/gemini/client.ts` (~32) -- lazy singleton + runtime env-null-check pattern to mirror for the Stripe client.
- `src/lib/api/route-helpers.ts` (~15-119) -- `json`, `handleError`, `requireUser`, `resolveAdminIdentity(slug,user)`; use for both routes' auth + envelope.
- `src/lib/auth/rbac.ts` (~30-49) -- `requireAdmin` → `{ orgId, slug, role }`. `src/lib/supabase/admin.ts` `createAdminClient()` -- service-role writer for the webhook org update (no user session in a webhook).
- `src/app/api/invoices/route.ts` (~49-136) -- representative route: auth chain → Zod `safeParse` → `json(...)`. `src/app/api/claim/route.ts` (~100-105) -- shows `req.json()`; webhook must instead read `await req.text()` BEFORE parsing for signature verification.
- `src/app/[slug]/settings/page.tsx` (~1-82) -- admin-gated settings page (stacks `InviteForm`, `BusinessProfileForm`, `<hr>` dividers, `max-w-2xl` container). Add the Billing section here.
- `src/components/settings/InviteForm.tsx` (~47-212) -- reference client component: `fetch` + `useState` status machine + `Loader2` spinner disabled button + `next-intl` `useTranslations`. Mirror for the redirect button.
- `src/components/ui/button.tsx`, `src/components/ui/card.tsx` -- shadcn primitives (variants, disabled styling) for the plan cards + redirect button.
- `.env.example` (~15-18) -- has stale `STRIPE_METERED_PRICE_ID`; replace with `STRIPE_PRICE_SOLO`/`_CREW`/`_SHOP`. `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` already stubbed.
- `node_modules/next/dist/docs/` -- confirm Next.js 16 App Router route-handler raw-body access (route handlers are not body-parsed by default; `req.text()`), per AGENTS.md.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<new-timestamp>_add_subscription_tier_stripe_ids_to_organizations.sql` -- NEW additive migration: `add column subscription_tier text` with `check (subscription_tier in ('solo','crew','shop'))` (nullable — null during trial), `add column stripe_customer_id text`, `add column stripe_subscription_id text`; repo-style `COMMENT ON COLUMN`. Do not touch the `subscription_status` CHECK.
- [x] `src/types/db.ts` -- add `SubscriptionTier` union and the three nullable fields to `OrganizationRow`.
- [x] `src/lib/stripe/client.ts` -- NEW server-only lazy Stripe singleton (SDK 22.1.1) reading `STRIPE_SECRET_KEY` at call time with a pinned apiVersion; throw a clear error if unset (mirror `gemini/client.ts`).
- [x] `src/lib/billing/tiers.ts` -- NEW config: `TIERS` (`solo`/`crew`/`shop`) → env price-id getter (`STRIPE_PRICE_SOLO`/`_CREW`/`_SHOP`), plus a reverse `priceIdToTier` helper for the webhook. Throw `AppError(500,"billingUnavailable")` when a needed price env is missing.
- [x] `src/app/api/stripe/checkout/route.ts` -- NEW `POST`: `requireUser` → `resolveAdminIdentity(slug,user)` → Zod `{ tier }` → ensure/create Stripe customer and persist `stripe_customer_id` → create `mode:"subscription"` Checkout session (price from tiers config, `client_reference_id`=orgId, `metadata.org_id`+`metadata.tier`, success/cancel URLs back to the settings billing section) → `json({ data:{ url }, error:null })`. Wrap failures in `handleError`.
- [x] `src/app/api/stripe/webhook/route.ts` -- NEW `POST`: read `await req.text()` raw body + `stripe-signature` header → `constructEvent` with `STRIPE_WEBHOOK_SECRET`; bad signature → 400 (not processed). On `checkout.session.completed`: resolve org from `metadata.org_id`/`client_reference_id`, resolve tier from the session price id (fallback `metadata.tier`), update the org via `createAdminClient()` to `subscription_status='active'` + `subscription_tier` + `stripe_subscription_id` (idempotent). Other event types → 200 `{ received:true }` no-op. Ensure raw-body (no pre-parse) per Next 16 docs.
- [x] Billing UI -- design & build the Admin "Add Billing" surface via the `/web-uiux-architect` skill: a Billing section added to `src/app/[slug]/settings/page.tsx` plus a client component under `src/components/settings/` (e.g. `BillingStart.tsx`) with a single "Add Billing" button (default tier: Solo) that posts `{ tier: "solo" }` to the checkout route and `window.location.href = data.url`, showing a disabled "Redirecting…" state during handoff and inline error copy on failure; short note that plan can be changed later in the billing portal; `next-intl` `Billing` namespace copy; WCAG AA, reduced-motion aware. Mirror `InviteForm`'s fetch+`useState` status pattern.
- [x] `.env.example` -- replace `STRIPE_METERED_PRICE_ID` with `STRIPE_PRICE_SOLO`/`_CREW`/`_SHOP` (keep `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).
- [x] `tests/unit/` -- unit-test the I/O matrix: tiers config (price-id ↔ tier mapping, missing-env error), checkout route (admin gate, invalid tier → 400, session args include price + `client_reference_id`/metadata), webhook (invalid signature rejected/not processed; `checkout.session.completed` sets active+tier+sub id; duplicate delivery no-op; unhandled event 200 no-op). Mock the Stripe SDK and Supabase client (mirror existing route test mocks).

**Acceptance Criteria:**
- Given an Admin on the trial account, when they tap "Add Billing", then they are redirected to a Stripe-hosted Checkout session in `subscription` mode for the default tier's fixed monthly price with no metered component, and the app renders no card form or price (FR30/FR53); the button shows a disabled "Redirecting…" state during handoff.
- Given a completed checkout, when Stripe fires `checkout.session.completed`, then a signature-verified webhook sets the org's `subscription_status='active'` and records `subscription_tier`, `stripe_customer_id`, and `stripe_subscription_id` on the Supabase org record.
- Given a webhook whose signature is invalid or absent, when it is received, then it is rejected (400) and not processed.
- Given a non-admin, when they call the checkout route, then it is rejected (401/403) before any Stripe call, and no billing surface is shown to Members.
- Given a duplicate `checkout.session.completed` delivery or an unrelated event type, when received, then org state is not corrupted (idempotent) and the request is acknowledged.

## Implementation Notes

- Migration `supabase/migrations/20260930130000_add_subscription_tier_stripe_ids_to_organizations.sql`: three additive nullable columns; `subscription_tier text CHECK (in solo/crew/shop)`, `stripe_customer_id text`, `stripe_subscription_id text` with repo-style `COMMENT ON COLUMN`. `subscription_status` CHECK untouched.
- `src/lib/stripe/client.ts`: lazy server-only singleton (SDK 22.1.1), `STRIPE_SECRET_KEY` read at call time, apiVersion pinned to `2026-04-22.dahlia` (the SDK's bundled version).
- `src/lib/billing/tiers.ts`: `TIERS`/`DEFAULT_TIER`/`isSubscriptionTier`/`getPriceIdForTier` (throws `AppError(500,"billingUnavailable")` on missing env) + `priceIdToTier` reverse lookup. Price envs read at call time so importing never throws at build.
- `src/app/api/stripe/checkout/route.ts` (+`schemas.ts`): admin-gated `POST`; Zod `{slug,tier}` in a separate module so Next's route type-gen accepts it. Ensures/persists the Stripe customer via the service-role admin client (org UPDATE is service-role-only under RLS; caller already proven Admin of that org). Body is parsed before auth: an invalid tier is a 400 `invalidTier` (matrix), a valid body from a non-admin still hits the 401/403 gate before any Stripe call.
- `src/app/api/stripe/webhook/route.ts`: raw body via `await req.text()` before parse; `constructEvent` verify (bad/absent sig → 400, not processed). `checkout.session.completed` resolves tier from the session price id (authoritative) via inline `line_items` or `listLineItems`, falls back to `metadata.tier`; writes active+tier+sub-id via admin client; idempotent. Missing secret → fail-closed 500 (logged). Missing org / unresolvable tier / other event types → logged (where relevant) + 200 no-op so Stripe does not retry-storm.
- `src/components/settings/BillingStart.tsx` + settings `#billing` section: single "Add Billing" button (posts default tier `solo`), disabled "Redirecting…" state, `role="alert"` inline error mapping server keys to translated copy, portal note, `useReducedMotion`-gated reveal; mirrors `InviteForm`. `Billing` i18n namespace added EN + FR (no em-dashes).
- `.env.example`: `STRIPE_METERED_PRICE_ID` replaced by `STRIPE_PRICE_SOLO`/`_CREW`/`_SHOP`.
- Verified independently (not just via the implementer report): the 3 new test files → 25 passed; `type-check` clean; `lint` clean (only the pre-existing eslintrc-deprecation warning). Docker/local Supabase was unavailable, so the migration was validated against the linked `snapbusy-test` project via MCP: the three columns exist as nullable text, the tier CHECK is `('solo','crew','shop')`, and `subscription_status` is unchanged (NOT NULL default `'trial'`). The repo migration file is authoritative for local `db reset`/`db push`.
- Not run (needs Stripe CLI + live keys): the end-to-end `stripe listen` manual check. Signature verification + activation are covered by unit tests; an E2E Stripe pass before release is prudent.

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **VG-1 (verification-gap) — `patch`.** Webhook fail-closed on missing `STRIPE_WEBHOOK_SECRET` (route.ts ~406-414: log + 500, `constructEvent` never reached) is never verified — the webhook test's `beforeEach` always sets the secret and no case unsets it, so a regression to 200/fall-through would pass CI on a security-relevant path. Pre-verified gap. Add a test.
- **BH-4 (blind) — `patch`.** `success_url`/`cancel_url` are built as `${origin}/${slug}/settings#billing?checkout=success` — the `?checkout=...` sits inside the URL fragment, not the query string, so `location.search`/server reads never see it. No 7.2 consumer yet, but it will silently mislead 7.4/7.5 return handling. Trivial reorder (`?checkout=...#billing`). Also fold in BH-3: assert the return URLs and `subscription_data.metadata` in the checkout test.
- **BH-7 / EC-C (blind + edge-case) — `patch`.** AC#2 says the `checkout.session.completed` webhook records `stripe_customer_id`, but the webhook update writes only status/tier/subscription id (the checkout route persists customer id). End state is correct (customer id is always persisted before a session exists), so no functional gap — but making the webhook also set `stripe_customer_id` from `session.customer` (idempotent) makes AC#2 literally true and hardens against the persist path changing. Small addition to the existing update.
- **BH-10 (blind) — `patch`.** Webhook uses the synchronous `stripe.webhooks.constructEvent` (Node crypto). App Router defaults to the Node runtime so it works today (finding is not a live defect), but the security-critical signature path is unpinned. Add `export const runtime = "nodejs"` to the webhook route as cheap insurance.
- **BH-1 (blind) — `low` → reject.** An unauthenticated caller posting an invalid tier gets `400 invalidTier` before the `401/403` gate (checkout route parses the full body before auth, unlike the invoices reference which validates slug-only first). Negligible: the tier enum is not secret, no Stripe call occurs, and the matrix's non-admin row (valid body) is satisfied and tested. Fix restructures validation ordering — more than a direct correction.
- **BH-2 (blind) — `low` → reject.** The checkout route reads the org row twice (once in `resolveOrgIdentity` for `id`, once via the admin client for `stripe_customer_id`). One extra indexed read on a rare user action (starting checkout); folding it in would change the shared `resolveOrgIdentity` helper's surface. Negligible.
- **BH-5 (blind) — `false`.** "Webhook `{ error }` / `{ received:true }` responses violate the `{ data, error }` contract." The envelope is the app's *client* API contract; the webhook responds to Stripe, not an app client, and the frozen matrix explicitly specifies `{ received:true }` / `error` shapes. Not a defect.
- **BH-6 (blind) — `low` → reject.** The webhook's `UPDATE ... WHERE id=orgId` is unconditional and does not detect a zero-row match (deleted org → silent success). Real Stripe events target existing orgs, and the null-org case is already handled; adding a rowcount guard is complexity for an unreachable-in-practice case.
- **BH-8 (blind) — `low` → reject.** Only `solo` is exercised end-to-end in the checkout route test; `crew`/`shop` are not. The route passes `tier` straight through and the tier→price mapping for all three is covered in `billing-tiers.test.ts`; the route path is identical per tier. Low added value.
- **BH-9 (blind) — `low`/`false` → reject.** (a) `BillingStart` error keys must stay in lockstep with route keys + i18n — a maintenance risk, no runtime defect. (b) The subtitle "you'll enter your card" allegedly over-promises for returning customers — but "Add Billing" only renders for trial orgs with no saved card, so the copy is accurate for the actual flow.
- **EC-A (edge-case) — `low` → reject.** If `session.subscription` were null the org would go `active` with a null `stripe_subscription_id`. In `subscription`-mode Checkout a completed session always carries a subscription, so the state is unreachable; guarding it adds a branch for an impossible case.
- **EC-B (edge-case) — `false`.** "When the price id can't be resolved, a tampered `metadata.tier` grants a different plan." `metadata` is set server-side by our checkout route and arrives only inside a signature-verified event; an attacker cannot set it without forging the webhook signature. Not attacker-controllable.
- **VG-other (verification-gap) — `low` → reject.** The checkout test mocks `requireAdmin` returning `{ organization_id }` while the real `ResolvedMembership` field is `orgId`. Tests pass correctly because the route never consumes that return value (it uses `identity.orgId` from `resolveOrgIdentity`). Cosmetic test-fidelity nit.

## Design Notes

- `subscription_tier` is nullable and separate from `subscription_status`: null throughout trial, set only by the webhook at first successful checkout. Keeping status and tier orthogonal matches the epic (status = access authority, tier = billed plan) and lets 7.4 evolve status states without touching tier.
- The webhook is the sole writer of the trial→active transition and uses the service-role admin client because there is no user session in a Stripe callback; it must be idempotent because Stripe re-delivers. Resolve tier from the session's price id (authoritative) with `metadata.tier` as a fallback so a tampered metadata field cannot grant a different plan than paid for.
- Raw body is mandatory for HMAC verification — read `req.text()` before any JSON parse. Confirm the Next.js 16 route-handler behavior in `node_modules/next/dist/docs/` (AGENTS.md: this is a modified Next.js).
- Billing copy is provisional: exact tiers/prices are open config pending willingness-to-pay validation, so Checkout shows the real price from Stripe and in-app copy stays generic (no asserted feature/seat limits). The single default-tier button (Solo) is the minimal 7.2 entry point; the full plan selector is deferred to the tier-change surface (7.5). Keeping the checkout route tier-parameterized now avoids reworking it then.

## Verification

**Commands:**
- `npm run test -- tests/unit/<new billing/webhook/checkout tests>` -- expected: all pass, including invalid-signature rejection, activate-on-completed, idempotent re-delivery, and admin-gate cases.
- `npm run type-check` -- expected: clean (all `OrganizationRow` consumers compile against the new fields).
- `npm run lint` -- expected: clean (only the pre-existing eslintrc-deprecation warning).
- `npm run db:reset` (if Docker/Supabase up) -- expected: new migration applies; `organizations` has `subscription_tier` (CHECK solo/crew/shop), `stripe_customer_id`, `stripe_subscription_id`. If unavailable, validate the migration against the linked test project via Supabase MCP (per 7.1 precedent).

**Manual checks (if no CLI):**
- Stripe CLI `stripe listen` → trigger `checkout.session.completed` against the local webhook; confirm the org flips to `active` with tier + ids, and that a forged-signature POST returns 400 unprocessed.
