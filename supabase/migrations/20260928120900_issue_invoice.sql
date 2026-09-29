-- ===========================================================================
-- Story 12.4 — issue_invoice() RPC (I1, I4, I6)
--
-- Issues a validated draft in ONE transaction under the caller's RLS (SECURITY
-- INVOKER, like save_invoice_draft). The compliance gate (assertIssuable) and the
-- snapshot/token construction run in the mutation layer BEFORE this call; this RPC
-- performs only the atomic state change:
--
--   1. Version + status='draft' + org gate. A 0-row match raises
--      `invoice_issue_conflict` (SQLSTATE P0001 — a DETERMINISTIC conflict, NOT a
--      retryable 40001 the pooler would auto-retry), matched by the mutation layer's
--      message marker and mapped to 409.
--   2. Allocate the next per-org number GAP-FREE from the locked counter row:
--      ensure the row exists (insert ... on conflict do nothing), then
--      `update ... set next_number = next_number + 1 ... returning next_number - 1`.
--      This is a row-lock serialization, never max()+1; the number only advances on
--      commit, so a rolled-back issue burns nothing.
--   3. Set status='issued', invoice_number, issue_date, supplier_snapshot,
--      customer_snapshot, share_token; bump version; record actor.
--
-- It does NOT touch child line/tax rows — those are already stored (12.3) and were
-- verified equal by assertIssuable. The draft→issued flip is permitted by the
-- immutability trigger because OLD.status = 'draft' (drafts stay mutable).
-- ===========================================================================

create or replace function public.issue_invoice(
  p_org               uuid,
  p_invoice_id        uuid,
  p_expected_version  integer,
  p_actor             uuid,
  p_issue_date        date,
  p_supplier_snapshot jsonb,
  p_customer_snapshot jsonb,
  p_share_token       text
)
  returns table (id uuid, version integer, invoice_number bigint)
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  v_number  bigint;
  v_id      uuid;
  v_version integer;
begin
  -- Guard the transition FIRST: the row must exist under this org, be the expected
  -- version, and still be a draft. A 0-row match (missing, foreign/RLS-hidden, stale
  -- version, or no longer a draft) raises the distinguishable conflict marker.
  -- `perform` locks nothing yet; we lock + allocate the counter only after the gate
  -- passes so a stale/non-draft issue never advances the number.
  if not exists (
    select 1
    from public.invoices
    where invoices.id = p_invoice_id
      and invoices.organization_id = p_org
      and invoices.version = p_expected_version
      and invoices.status = 'draft'
  ) then
    raise exception 'invoice_issue_conflict'
      using errcode = 'P0001';
  end if;

  -- Allocate the next per-org number GAP-FREE from the locked counter row. Ensure the
  -- row exists, then increment under its row lock and return the pre-increment value.
  -- The first allocation for an org returns 1 (default next_number = 1).
  insert into public.invoice_number_counters (organization_id)
    values (p_org)
    on conflict (organization_id) do nothing;

  update public.invoice_number_counters
    set next_number = next_number + 1,
        updated_at  = now()
    where organization_id = p_org
    returning next_number - 1
      into v_number;

  -- Flip the draft to issued, freezing number/date/snapshots/token and bumping the
  -- version. Re-assert the version+status+org gate in the UPDATE itself so a concurrent
  -- writer that slipped in between the check and here cannot double-issue.
  update public.invoices
    set status            = 'issued',
        invoice_number    = v_number,
        issue_date        = p_issue_date,
        supplier_snapshot = p_supplier_snapshot,
        customer_snapshot = p_customer_snapshot,
        share_token       = p_share_token,
        version           = invoices.version + 1,
        actor_id          = p_actor,
        updated_at        = now()
    where invoices.id = p_invoice_id
      and invoices.organization_id = p_org
      and invoices.version = p_expected_version
      and invoices.status = 'draft'
    returning invoices.id, invoices.version, invoices.invoice_number
      into v_id, v_version, v_number;

  if v_id is null then
    -- A concurrent issue won the race between the guard and the UPDATE. Raise the
    -- same deterministic conflict; the whole function is one transaction, so the
    -- counter increment above rolls back with it (no number is burned).
    raise exception 'invoice_issue_conflict'
      using errcode = 'P0001';
  end if;

  return query select v_id, v_version, v_number;
end;
$$;

comment on function public.issue_invoice(uuid, uuid, integer, uuid, date, jsonb, jsonb, text) is
  'Story 12.4 — atomically issue a validated draft under caller RLS (SECURITY INVOKER). '
  'Version+status=draft+org gate (0 rows -> raises invoice_issue_conflict, SQLSTATE P0001 '
  '— NOT a retryable 40001). Allocates the next gap-free per-org number from '
  'invoice_number_counters under a row lock (never max()+1), then sets status=issued, '
  'invoice_number, issue_date, supplier/customer snapshots, share_token; bumps version; '
  'records actor. Does not touch child line/tax rows. assertIssuable + snapshot/token '
  'construction run in the mutation layer before this call.';
