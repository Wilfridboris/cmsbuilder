-- ===========================================================================
-- Story 7.1 — 14-Day Free Trial (No Card): trial-state foundation.
--
-- Adds the subscription/trial columns to `organizations` so a claimed account
-- can record that it is in a 14-day, no-card trial. `subscription_status` on the
-- org becomes the single authoritative access source of truth later billing/
-- gating stories (7.2-7.5) read and gate on — there is NO separate trial table.
--
-- 7.1 records state only: no payment is collected, no quota/meter is imposed,
-- and no read-only enforcement is added (lapse gating is Story 7.4).
--
-- The trial clock is NOT a DB default: it must begin at CLAIM finalization (the
-- account becoming real), not at anonymous session-org row creation. So the
-- application (finalizeClaim) stamps `trial_expires_at`; the anonymous session
-- org keeps it null until claimed. `subscription_status` defaults to 'trial' so
-- existing and newly-provisioned rows adopt the trial tier immediately.
--
-- The CHECK allows only ('trial','active') — the two states in play through
-- Story 7.2. Story 7.4 will ALTER the constraint to add lapse/grace states once
-- their naming is settled; 7.1 deliberately does not pre-lock those names.
-- ===========================================================================

alter table public.organizations
  add column subscription_status text not null default 'trial'
    check (subscription_status in ('trial', 'active')),
  add column trial_expires_at timestamptz;

comment on column public.organizations.subscription_status is
  'Cached access source of truth (Story 7.1). During trial the account has full '
  'unlimited access (no quota, meter, or payment prompt). Constrained to '
  '(trial|active) through Story 7.2; Story 7.4 widens it for lapse/grace states.';
comment on column public.organizations.trial_expires_at is
  'When the 14-day no-card trial ends = claim finalization time + 14 days. Null '
  'until the org is claimed (the clock starts at claim, not at row creation), and '
  'stamped exactly once so re-running claim finalization never resets the clock.';
