-- ===========================================================================
-- Story 12.8 — issue_credit_note() RPC (I1, I4, I6)
--
-- Mirrors issue_invoice (20260928120900): issues a validated credit-note draft in ONE
-- transaction under the caller's RLS (SECURITY INVOKER). The compliance gate
-- (assertIssuableCreditNote) and the snapshot/token construction run in the mutation
-- layer BEFORE this call; this RPC performs only the atomic state change:
--
--   1. Version + status='draft' + org gate. A 0-row match raises
--      `credit_note_issue_conflict` (SQLSTATE P0001 — a DETERMINISTIC conflict, NOT a
--      retryable 40001 the pooler would auto-retry), matched by the mutation layer's
--      message marker and mapped to 409.
--   2. Allocate the next per-org credit-note number GAP-FREE from the locked counter row
--      (credit_note_number_counters — a namespace DISJOINT from invoice numbers, I1):
--      ensure the row exists, then
--      `update ... set next_number = next_number + 1 ... returning next_number - 1`.
--      A row-lock serialization, never max()+1; the number only advances on commit.
--   3. Set status='issued', credit_note_number, issue_date, supplier_snapshot,
--      customer_snapshot, original_invoice_number (frozen from the source invoice, I6),
--      share_token; bump version; record actor.
--
-- It does NOT touch child line/tax rows (already stored, verified equal by the gate) and
-- NEVER writes the original invoice (FR88). The draft->issued flip is permitted by the
-- immutability trigger because OLD.status = 'draft'.
-- ===========================================================================

create or replace function public.issue_credit_note(
  p_org                     uuid,
  p_credit_note_id          uuid,
  p_expected_version        integer,
  p_actor                   uuid,
  p_issue_date              date,
  p_original_invoice_number bigint,
  p_supplier_snapshot       jsonb,
  p_customer_snapshot       jsonb,
  p_share_token             text
)
  returns table (id uuid, version integer, credit_note_number bigint)
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
  -- version, and still be a draft. A 0-row match raises the distinguishable conflict
  -- marker. Lock + allocate the counter only after the gate passes so a stale/non-draft
  -- issue never advances the number.
  if not exists (
    select 1
    from public.credit_notes
    where credit_notes.id = p_credit_note_id
      and credit_notes.organization_id = p_org
      and credit_notes.version = p_expected_version
      and credit_notes.status = 'draft'
  ) then
    raise exception 'credit_note_issue_conflict'
      using errcode = 'P0001';
  end if;

  -- Allocate the next per-org credit-note number GAP-FREE from the locked counter row
  -- (its OWN namespace, disjoint from invoices). The first allocation for an org returns 1.
  insert into public.credit_note_number_counters (organization_id)
    values (p_org)
    on conflict (organization_id) do nothing;

  update public.credit_note_number_counters
    set next_number = next_number + 1,
        updated_at  = now()
    where organization_id = p_org
    returning next_number - 1
      into v_number;

  -- Flip the draft to issued, freezing number/date/snapshots/original_invoice_number/
  -- token and bumping the version. Re-assert the gate in the UPDATE itself so a concurrent
  -- writer cannot double-issue.
  update public.credit_notes
    set status                  = 'issued',
        credit_note_number      = v_number,
        issue_date              = p_issue_date,
        original_invoice_number = p_original_invoice_number,
        supplier_snapshot       = p_supplier_snapshot,
        customer_snapshot       = p_customer_snapshot,
        share_token             = p_share_token,
        version                 = credit_notes.version + 1,
        actor_id                = p_actor,
        updated_at              = now()
    where credit_notes.id = p_credit_note_id
      and credit_notes.organization_id = p_org
      and credit_notes.version = p_expected_version
      and credit_notes.status = 'draft'
    returning credit_notes.id, credit_notes.version, credit_notes.credit_note_number
      into v_id, v_version, v_number;

  if v_id is null then
    -- A concurrent issue won the race between the guard and the UPDATE. Raise the same
    -- deterministic conflict; the whole function is one transaction, so the counter
    -- increment rolls back with it (no number is burned).
    raise exception 'credit_note_issue_conflict'
      using errcode = 'P0001';
  end if;

  return query select v_id, v_version, v_number;
end;
$$;

comment on function public.issue_credit_note(uuid, uuid, integer, uuid, date, bigint, jsonb, jsonb, text) is
  'Story 12.8 — atomically issue a validated credit-note draft under caller RLS (SECURITY '
  'INVOKER). Version+status=draft+org gate (0 rows -> raises credit_note_issue_conflict, '
  'SQLSTATE P0001 — NOT a retryable 40001). Allocates the next gap-free per-org '
  'credit-note number from credit_note_number_counters (a namespace disjoint from invoice '
  'numbers, I1) under a row lock (never max()+1), then sets status=issued, number, '
  'issue_date, original_invoice_number, supplier/customer snapshots, share_token; bumps '
  'version; records actor. Does not touch child rows or the original invoice (FR88).';
