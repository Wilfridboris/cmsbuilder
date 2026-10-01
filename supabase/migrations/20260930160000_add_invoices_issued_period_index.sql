-- ===========================================================================
-- Story 7.5 — Tier View, Tier-Change Prompt & Tier Reconciliation: the
-- per-cycle issued-invoice counting index.
--
-- The tier-change prompt (FR55, no-silent-overage) counts how many invoices an
-- org ISSUED within its last completed Stripe billing cycle, to compare against
-- the current tier's band. `countIssuedInvoicesInPeriod` runs
-- `where organization_id = $org and status in ('issued','paid')
--  and issue_date >= $start and issue_date < $end` (a `count(head)` query).
--
-- A PARTIAL index over exactly that working set — keyed `(organization_id,
-- issue_date)` and filtered to the issued states — lets the per-cycle count stay
-- an index-only scan as invoice volume grows, without indexing the draft rows
-- that never participate in the count. Additive and forward-only: no column,
-- constraint, or CHECK change (this story adds a read path, nothing structural).
-- ===========================================================================

create index invoices_issued_period_idx
  on public.invoices (organization_id, issue_date)
  where status in ('issued', 'paid');

comment on index public.invoices_issued_period_idx is
  'Supports the Story 7.5 tier-change prompt: the per-billing-cycle issued-invoice '
  'count (countIssuedInvoicesInPeriod) scans by organization_id + issue_date over '
  'issued/paid invoices only, so a partial index over exactly that working set keeps '
  'the count cheap as invoice volume grows. Read-only support; no structural change.';
