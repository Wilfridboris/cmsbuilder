-- ===========================================================================
-- Story 12.7 — record_invoice_payment() RPC (one out-of-band payment + issued->paid)
--
-- Marks an issued invoice paid in ONE transaction under the caller's RLS (SECURITY
-- INVOKER, like issue_invoice / save_invoice_draft). Scheza never processes money —
-- this only RECORDS an out-of-band payment and flips the whitelisted issued->paid
-- transition. In one transaction it:
--
--   1. Version + status='issued' + org gate. A 0-row match (missing, foreign/RLS-hidden,
--      stale version, or not currently 'issued') raises `invoice_payment_conflict`
--      (SQLSTATE P0001 — a DETERMINISTIC conflict, NOT a retryable 40001 the pooler
--      would auto-retry), matched by the mutation layer's message marker and mapped to
--      409 versionConflict. The precise already-paid / not-issued reasons are surfaced
--      by the mutation layer BEFORE this call from the loaded status.
--   2. Insert exactly ONE invoice_payments row (UNIQUE(invoice_id) also guards a race:
--      a duplicate raises 23505 unique_violation, mapped to 409 alreadyPaid).
--   3. Update invoices status->'paid', bump version, set actor_id + updated_at. The
--      immutability trigger permits issued->paid (status/version/updated_at/actor_id
--      only); no frozen column changes.
--
-- It does NOT recompute totals/tax, read live records/business_profiles, or touch any
-- frozen column (I2/I3/I6 untouched).
-- ===========================================================================

create or replace function public.record_invoice_payment(
  p_org               uuid,
  p_invoice_id        uuid,
  p_expected_version  integer,
  p_actor             uuid,
  p_method            text,
  p_paid_date         date,
  p_amount            numeric,
  p_reference         text
)
  returns table (id uuid, version integer)
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  v_id      uuid;
  v_version integer;
begin
  -- Guard the transition FIRST: the row must exist under this org, be the expected
  -- version, and still be 'issued'. A 0-row match (missing, foreign/RLS-hidden, stale
  -- version, or no longer issued) raises the distinguishable conflict marker.
  if not exists (
    select 1
    from public.invoices
    where invoices.id = p_invoice_id
      and invoices.organization_id = p_org
      and invoices.version = p_expected_version
      and invoices.status = 'issued'
  ) then
    raise exception 'invoice_payment_conflict'
      using errcode = 'P0001';
  end if;

  -- Record the single out-of-band payment. UNIQUE(invoice_id) turns a concurrent
  -- double-mark into a 23505 unique_violation (mapped to 409 alreadyPaid) rather than
  -- a second payment row.
  insert into public.invoice_payments (
    invoice_id,
    organization_id,
    method,
    paid_date,
    amount,
    reference,
    actor_id
  )
  values (
    p_invoice_id,
    p_org,
    p_method,
    p_paid_date,
    p_amount,
    p_reference,
    p_actor
  );

  -- Flip the whitelisted issued->paid transition and bump the version. Re-assert the
  -- version+status+org gate in the UPDATE itself so a concurrent writer that slipped in
  -- between the check and here cannot mark paid twice. The immutability trigger permits
  -- this transition (only status/version/updated_at/actor_id change).
  update public.invoices
    set status     = 'paid',
        version    = invoices.version + 1,
        actor_id   = p_actor,
        updated_at = now()
    where invoices.id = p_invoice_id
      and invoices.organization_id = p_org
      and invoices.version = p_expected_version
      and invoices.status = 'issued'
    returning invoices.id, invoices.version
      into v_id, v_version;

  if v_id is null then
    -- A concurrent payment won the race between the guard and the UPDATE. Raise the
    -- same deterministic conflict; the whole function is one transaction, so the
    -- payment insert above rolls back with it (no orphan payment row).
    raise exception 'invoice_payment_conflict'
      using errcode = 'P0001';
  end if;

  return query select v_id, v_version;
end;
$$;

comment on function public.record_invoice_payment(uuid, uuid, integer, uuid, text, date, numeric, text) is
  'Story 12.7 — atomically record ONE out-of-band payment and flip the invoice '
  'issued->paid under caller RLS (SECURITY INVOKER). Version+status=issued+org gate '
  '(0 rows -> raises invoice_payment_conflict, SQLSTATE P0001 — NOT a retryable 40001). '
  'Inserts exactly one invoice_payments row (UNIQUE(invoice_id) makes a race a 23505), '
  'then sets status=paid, bumps version, records actor. Scheza never processes money; no '
  'totals/tax recompute, no frozen-column change (I2/I3/I6 untouched).';
