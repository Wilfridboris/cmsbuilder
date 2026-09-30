-- ===========================================================================
-- Story 12.8 — save_credit_note_draft() RPC
--
-- Mirrors save_invoice_draft (20260928121260) — the atomic "upsert parent + replace
-- line items + replace tax lines" draft RPC — for credit notes, MINUS due_date (a
-- credit note has no due date) and PLUS p_invoice_id (the source-invoice link, NOT
-- NULL on create). SECURITY INVOKER (runs under the caller's RLS), version +
-- status='draft' gate, the non-retryable P0001 'credit_note_draft_conflict' marker,
-- replace-all children, precomputed totals (I2/I3). Money figures arrive precomputed
-- from computeInvoiceTotals — no SQL re-implements any money math.
--
-- On create (p_credit_note_id null) invoice_id is stored (the source link, immutable
-- after that); on update it is NOT changed (a draft's source invoice is fixed).
-- ===========================================================================

create or replace function public.save_credit_note_draft(
  p_org                uuid,
  p_credit_note_id     uuid,
  p_invoice_id         uuid,
  p_expected_version   integer,
  p_customer_record_id uuid,
  p_province           text,
  p_language           text,
  p_actor              uuid,
  p_line_items         jsonb,
  p_subtotal           numeric,
  p_tax_total          numeric,
  p_total              numeric,
  p_tax_lines          jsonb
)
  returns table (id uuid, version integer)
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  v_credit_note_id uuid;
  v_version        integer;
begin
  if p_credit_note_id is null then
    -- New draft. RLS with-check gates the org; status is forced to 'draft'. invoice_id
    -- (the source link) is stored here and never changed thereafter.
    insert into public.credit_notes (
      organization_id,
      invoice_id,
      customer_record_id,
      place_of_supply_province,
      language,
      status,
      version,
      actor_id,
      subtotal,
      tax_total,
      total
    )
    values (
      p_org,
      p_invoice_id,
      p_customer_record_id,
      p_province,
      coalesce(p_language, 'en'),
      'draft',
      1,
      p_actor,
      coalesce(p_subtotal, 0),
      coalesce(p_tax_total, 0),
      coalesce(p_total, 0)
    )
    returning credit_notes.id, credit_notes.version
      into v_credit_note_id, v_version;
  else
    -- Existing draft. Version-gated + status-gated update; bump version. invoice_id is
    -- NOT updated — the source link is fixed at create.
    update public.credit_notes
      set customer_record_id       = p_customer_record_id,
          place_of_supply_province = p_province,
          language                 = coalesce(p_language, 'en'),
          subtotal                 = coalesce(p_subtotal, 0),
          tax_total                = coalesce(p_tax_total, 0),
          total                    = coalesce(p_total, 0),
          version                  = credit_notes.version + 1,
          actor_id                 = p_actor,
          updated_at               = now()
      where credit_notes.id = p_credit_note_id
        and credit_notes.organization_id = p_org
        and credit_notes.version = p_expected_version
        and credit_notes.status = 'draft'
      returning credit_notes.id, credit_notes.version
        into v_credit_note_id, v_version;

    if v_credit_note_id is null then
      -- The row is missing, foreign (RLS-hidden), stale (wrong version), or no longer a
      -- draft (issued/void). Raise a DISTINGUISHABLE error the mutation layer matches on
      -- the message marker and maps to versionConflict/notDraft. Uses the default
      -- raise_exception SQLSTATE P0001 (a DETERMINISTIC conflict) — deliberately NOT
      -- 40001/40P01, which PostgREST + the pooler auto-retry as transient failures.
      raise exception 'credit_note_draft_conflict'
        using errcode = 'P0001';
    end if;
  end if;

  -- Replace-all line items: clear then re-insert the provided set. The whole function
  -- runs in one transaction, and the version gate above already rejected a stale save.
  delete from public.credit_note_line_items
    where credit_note_line_items.credit_note_id = v_credit_note_id;

  insert into public.credit_note_line_items (
    credit_note_id,
    organization_id,
    description,
    quantity,
    unit_price,
    amount,
    sort_order
  )
  select
    v_credit_note_id,
    p_org,
    (item ->> 'description'),
    (item ->> 'quantity')::numeric,
    (item ->> 'unit_price')::numeric,
    (item ->> 'amount')::numeric,
    coalesce((item ->> 'sort_order')::integer, ordinality::integer - 1)
  from jsonb_array_elements(coalesce(p_line_items, '[]'::jsonb))
    with ordinality as t(item, ordinality);

  -- Replace-all tax lines from the canonical computeInvoiceTotals output (I2/I3).
  delete from public.credit_note_tax_lines
    where credit_note_tax_lines.credit_note_id = v_credit_note_id;

  insert into public.credit_note_tax_lines (
    credit_note_id,
    organization_id,
    label,
    rate,
    base,
    tax_amount,
    sort_order
  )
  select
    v_credit_note_id,
    p_org,
    (item ->> 'label'),
    (item ->> 'rate')::numeric,
    (item ->> 'base')::numeric,
    (item ->> 'tax_amount')::numeric,
    coalesce((item ->> 'sort_order')::integer, ordinality::integer - 1)
  from jsonb_array_elements(coalesce(p_tax_lines, '[]'::jsonb))
    with ordinality as t(item, ordinality);

  return query select v_credit_note_id, v_version;
end;
$$;

comment on function public.save_credit_note_draft(uuid, uuid, uuid, integer, uuid, text, text, uuid, jsonb, numeric, numeric, numeric, jsonb) is
  'Story 12.8 — atomic upsert credit note + replace line items + replace tax lines '
  'under caller RLS (SECURITY INVOKER). Mirrors save_invoice_draft minus due_date, plus '
  'p_invoice_id (source link, set on create). Stores subtotal/tax_total/total and tax '
  'lines from computeInvoiceTotals (I2/I3). Version-gated + status=draft update (0 rows '
  '-> raises credit_note_draft_conflict, SQLSTATE P0001 — NOT a retryable 40001).';
