-- ===========================================================================
-- Story 7.3 — Manage Subscription via Stripe Customer Portal: widen the
-- `subscription_status` CHECK to the lapse states, and enforce the
-- one-subscription-per-org invariant.
--
-- Story 7.1 constrained `subscription_status` to ('trial','active'); the portal
-- lifecycle webhook (this story) now also records lapse states written from the
-- signature-verified Stripe events:
--   * invoice.paid                 -> 'active'    (re-affirm)
--   * invoice.payment_failed       -> 'past_due'
--   * customer.subscription.deleted-> 'read_only' (canceled; terminal)
-- So the CHECK widens to ('trial','active','past_due','read_only'). The column
-- stays `text` + CHECK (never a Postgres enum), NOT NULL, default 'trial' — an
-- additive widening that leaves every existing row valid.
--
-- Story 7.3 only RECORDS these states. The read-only ENFORCEMENT (blocking
-- writes), trial reminders, and any grace/deleted states are Story 7.4's change.
--
-- The webhook resolves the org by `stripe_subscription_id` via `.maybeSingle()`
-- (which throws on >1 row). One Stripe subscription belongs to exactly one org,
-- so a UNIQUE index both documents and enforces that invariant, guaranteeing the
-- resolve can never match two rows. The column stays NULLABLE (it is null before
-- the first checkout completes); a partial (NOT NULL) index keeps multiple nulls
-- legal while enforcing uniqueness on the populated values.
-- ===========================================================================

alter table public.organizations
  drop constraint organizations_subscription_status_check;

alter table public.organizations
  add constraint organizations_subscription_status_check
    check (subscription_status in ('trial', 'active', 'past_due', 'read_only'));

comment on column public.organizations.subscription_status is
  'Cached access source of truth (Story 7.1, widened 7.3). During trial the '
  'account has full unlimited access. Constrained to '
  '(trial|active|past_due|read_only): the signature-verified portal webhook '
  'records invoice.paid->active, invoice.payment_failed->past_due, '
  'customer.subscription.deleted->read_only (terminal for lifecycle events — '
  'only a new checkout.session.completed reactivates). Story 7.3 records state; '
  'Story 7.4 adds the read-only enforcement that gates on it.';

create unique index organizations_stripe_subscription_id_key
  on public.organizations (stripe_subscription_id)
  where stripe_subscription_id is not null;

comment on index public.organizations_stripe_subscription_id_key is
  'Enforces one-subscription-per-org (Story 7.3): the portal lifecycle webhook '
  'resolves the org by stripe_subscription_id via .maybeSingle(), which throws '
  'on more than one match. UNIQUE documents and guarantees the invariant. '
  'Partial (WHERE NOT NULL) so the column can stay null before the first checkout '
  'completes.';
