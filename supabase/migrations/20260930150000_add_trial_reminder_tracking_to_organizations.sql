-- ===========================================================================
-- Story 7.4 — Read-Only Gating & Trial Reminders: per-stage reminder tracking
-- plus the trial-lifecycle sweep index.
--
-- The daily `/api/cron/trial-lifecycle` sweep (this story) sends two trial
-- reminders — Day 12 (~2 days before expiry) and Day 14 (~at expiry) — and must
-- send each AT MOST ONCE across repeated daily runs. Rather than a counter, each
-- reminder stage gets its own nullable `*_sent_at` timestamp: the sweep stamps it
-- only AFTER Resend succeeds, so a transient send failure retries next run while a
-- successful send is never repeated. Both columns are additive and nullable; every
-- existing row reads as "neither reminder sent yet", which is correct.
--
-- The partial index on `trial_expires_at WHERE subscription_status = 'trial'`
-- supports the sweep's narrow scan (Story 7.1 deferred this lapse-sweep index to
-- this story): the cron only ever loads trial orgs with a non-null expiry, so a
-- partial index over exactly that working set keeps the daily sweep cheap as the
-- org count grows.
--
-- The `subscription_status` CHECK is NOT touched — 7.4 adds enforcement over the
-- existing (trial|active|past_due|read_only) states, no new state.
-- ===========================================================================

alter table public.organizations
  add column trial_reminder_day12_sent_at timestamptz,
  add column trial_reminder_day14_sent_at timestamptz;

comment on column public.organizations.trial_reminder_day12_sent_at is
  'When the Day-12 trial-conversion reminder email was successfully sent (Story '
  '7.4). Null until the daily lifecycle cron sends it; stamped only after Resend '
  'succeeds so the exactly-once reminder retries on a transient failure.';

comment on column public.organizations.trial_reminder_day14_sent_at is
  'When the Day-14 (at-expiry) trial reminder email was successfully sent (Story '
  '7.4). Null until the daily lifecycle cron sends it — in the same sweep pass '
  'that flips an expired trial to read_only; stamped only after Resend succeeds.';

create index organizations_trial_expiry_sweep_idx
  on public.organizations (trial_expires_at)
  where subscription_status = 'trial';

comment on index public.organizations_trial_expiry_sweep_idx is
  'Supports the daily trial-lifecycle sweep (Story 7.4): the cron scans only '
  'trial orgs by trial_expires_at (expiry flip + Day-12/Day-14 reminders), so a '
  'partial index over exactly that working set keeps the sweep cheap. Deferred '
  'from Story 7.1 to the story that introduced the sweep.';
