-- ===========================================================================
-- Story 8.5 — Self-Service Offboarding (Grace + Cascade Delete): hang an
-- offboarding lifecycle off the existing cancellation signal.
--
-- FR38/FR39: a voluntary subscription cancellation (`customer.subscription.deleted`)
-- flips the org to the EXISTING `read_only` state AND stamps `offboarding_initiated_at`
-- to start a 30-day read-only grace clock. A daily cron sweep then sends staged warning
-- emails at Day 1/7/25 and, at Day 30, hard-cascade-deletes the user-data tables while
-- PRESERVING the statutorily-retained invoice/credit-note tables and their frozen PDFs.
--
-- Grace is NOT a new writable state: `read_only` stays the single enforced non-writable
-- state. `offboarding_initiated_at` is what distinguishes a cancellation (delete-bound)
-- from a trial-expiry / dunning `read_only` (untouched by this story). The ONLY new
-- subscription_status value is the terminal `deleted` tombstone, written by the Day-30
-- purge: the org ROW survives (it FK-cascades the retained invoices) but every user-data
-- table under it is gone.
--
-- All columns are additive and nullable; every existing row reads as "not offboarding",
-- which is correct. Each reminder stage gets its own nullable `*_sent_at` timestamp so the
-- sweep sends each AT MOST ONCE across repeated daily runs (stamped only after Resend
-- succeeds). `offboarding_purged_at` marks the Day-30 cascade as done so it is re-entrant
-- and skipped on later sweeps. The column stays `text` + CHECK (never a Postgres enum).
-- ===========================================================================

alter table public.organizations
  add column offboarding_initiated_at timestamptz,
  add column offboarding_reminder_day1_sent_at timestamptz,
  add column offboarding_reminder_day7_sent_at timestamptz,
  add column offboarding_reminder_day25_sent_at timestamptz,
  add column offboarding_purged_at timestamptz;

comment on column public.organizations.offboarding_initiated_at is
  'When the 30-day offboarding grace clock started (Story 8.5, FR38). Stamped once '
  '(idempotent) by the Stripe webhook when a voluntary customer.subscription.deleted '
  'flips the org to read_only; null for a read_only reached via trial expiry or dunning '
  '(untouched by this story). Cleared when the org re-subscribes (checkout -> active). '
  'The daily offboarding cron acts only on orgs where this is set and offboarding_purged_at '
  'is null.';

comment on column public.organizations.offboarding_reminder_day1_sent_at is
  'When the Day-1 offboarding warning email was successfully sent (Story 8.5, FR39). '
  'Stamped only after Resend succeeds so the exactly-once warning retries on a transient '
  'failure; cleared on re-subscription.';

comment on column public.organizations.offboarding_reminder_day7_sent_at is
  'When the Day-7 offboarding warning email was successfully sent (Story 8.5, FR39). '
  'Stamped only after Resend succeeds; cleared on re-subscription.';

comment on column public.organizations.offboarding_reminder_day25_sent_at is
  'When the Day-25 offboarding warning email was successfully sent (Story 8.5, FR39). '
  'Stamped only after Resend succeeds; cleared on re-subscription.';

comment on column public.organizations.offboarding_purged_at is
  'When the Day-30 cascade purge completed (Story 8.5, FR38). Set together with '
  'subscription_status=deleted on the surviving org tombstone. Non-null means the purge '
  'is done: the sweep skips the org and the cascade is re-entrant. The purge deletes only '
  'the user-data tables (records, org_schemas, org_members, business_profiles, '
  'pending_claims, forms) + the logo; it NEVER deletes the org row (which would cascade '
  'the statutorily-retained invoice/credit-note tables under the six-year retention rule).';

-- Widen the CHECK to add the terminal `deleted` tombstone state. Forward-only; every
-- existing row (trial|active|past_due|read_only) stays valid.
alter table public.organizations
  drop constraint organizations_subscription_status_check;

alter table public.organizations
  add constraint organizations_subscription_status_check
    check (subscription_status in ('trial', 'active', 'past_due', 'read_only', 'deleted'));

comment on column public.organizations.subscription_status is
  'Cached access source of truth (Story 7.1, widened 7.3 + 8.5). During trial the account '
  'has full unlimited access. Constrained to (trial|active|past_due|read_only|deleted): the '
  'portal webhook records invoice.paid->active, invoice.payment_failed->past_due, '
  'customer.subscription.deleted->read_only (which also starts the offboarding grace clock). '
  '`deleted` is the terminal tombstone the Day-30 offboarding cascade writes after purging '
  'the user-data tables while retaining the invoice tables under the org row. read_only and '
  'deleted are both non-writable.';

-- Partial index backing the daily offboarding sweep: the cron scans only orgs with a
-- started, not-yet-purged grace clock.
create index organizations_offboarding_sweep_idx
  on public.organizations (offboarding_initiated_at)
  where offboarding_initiated_at is not null and offboarding_purged_at is null;

comment on index public.organizations_offboarding_sweep_idx is
  'Supports the daily offboarding sweep (Story 8.5): the cron scans only orgs with a '
  'started grace clock (offboarding_initiated_at not null) that have not yet been purged '
  '(offboarding_purged_at null), so a partial index over exactly that working set keeps '
  'the daily sweep cheap.';
