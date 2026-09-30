-- ===========================================================================
-- Story 7.2 — Start a Flat-Tier Subscription via Stripe Checkout: tier + Stripe
-- linkage columns on `organizations`.
--
-- Adds the columns the signature-verified `checkout.session.completed` webhook
-- writes when a trial is converted to a paid flat-tier subscription:
--   * `subscription_tier`      — the billed plan (solo|crew|shop); NULL during
--     trial and set only by the webhook at the first successful checkout.
--   * `stripe_customer_id`     — the org's Stripe Customer, created/reused at
--     checkout start and persisted so later stories reuse it (portal 7.3, etc.).
--   * `stripe_subscription_id` — the org's Stripe Subscription, recorded by the
--     webhook so later stories (portal 7.3, gating 7.4, tier view 7.5) can read
--     the linkage without re-querying Stripe.
--
-- `subscription_tier` is deliberately ORTHOGONAL to `subscription_status`:
-- status is the cached access authority (Story 7.1), tier is the billed plan.
-- Keeping them separate lets Story 7.4 evolve status states (lapse/grace)
-- without touching tier. This migration does NOT touch the `subscription_status`
-- CHECK — widening it for lapse/grace is Story 7.4's change.
--
-- Additive + backward-compatible: all three columns are nullable with no default,
-- so existing trial rows are untouched (tier/ids stay NULL until first checkout).
-- The tier CHECK mirrors the repo's text + CHECK convention (never a PG enum).
-- ===========================================================================

alter table public.organizations
  add column subscription_tier text
    check (subscription_tier in ('solo', 'crew', 'shop')),
  add column stripe_customer_id text,
  add column stripe_subscription_id text;

comment on column public.organizations.subscription_tier is
  'The billed flat-tier plan (Story 7.2): solo|crew|shop. Orthogonal to '
  'subscription_status (status = cached access authority, tier = billed plan). '
  'Null throughout the trial; set only by the signature-verified '
  'checkout.session.completed webhook at the first successful checkout, resolved '
  'from the session price id (authoritative) so tampered metadata cannot grant a '
  'different plan than paid for.';
comment on column public.organizations.stripe_customer_id is
  'The org''s Stripe Customer id (Story 7.2). Created (or reused) when the Admin '
  'starts checkout and persisted so later stories reuse the same customer. Null '
  'until the first checkout is started.';
comment on column public.organizations.stripe_subscription_id is
  'The org''s Stripe Subscription id (Story 7.2). Recorded by the '
  'checkout.session.completed webhook so later stories (portal 7.3, gating 7.4, '
  'tier view 7.5) read the linkage without re-querying Stripe. Null until the '
  'first checkout completes.';
