-- Story 7 retro remediation [F1]: track when an org entered `past_due`.
--
-- `past_due` is a writable state (NFR-R4: a failed-payment customer is mid-dunning
-- and must not be locked out). The ONLY exits are a Stripe `invoice.paid` -> active
-- or a `customer.subscription.deleted` -> read_only. If Stripe is configured to leave
-- an exhausted subscription uncollectible-but-active rather than cancel it,
-- `customer.subscription.deleted` never fires and the org would stay writable forever
-- without paying. This column lets the daily lifecycle cron escalate a long-overdue
-- `past_due` org to `read_only` as an app-side safety net, independent of the Stripe
-- dunning configuration.
--
-- Stamped by the webhook when an org first enters `past_due`; cleared when it returns
-- to `active`. Null for every other state. Additive, forward-only, no PG enum.

alter table public.organizations
  add column past_due_since timestamptz;

comment on column public.organizations.past_due_since is
  'When the org most recently entered subscription_status=past_due (Story 7 retro [F1]). '
  'Set by the Stripe webhook on the trial/active -> past_due transition, cleared on the '
  'return to active. The daily lifecycle cron escalates an org whose past_due_since is '
  'older than PAST_DUE_GRACE_DAYS to read_only (a safety net for a Stripe account not '
  'configured to cancel on exhausted dunning). Null outside past_due.';
