-- ===========================================================================
-- Story 12.7 — save_invoice_draft(): persist the owner-set due_date on the draft
--
-- Extends the Story 12.3 atomic "upsert invoice + replace line items + replace tax
-- lines" RPC to also store the optional `due_date` on the invoice row. The owner
-- enters an optional Due date on the draft form; it is stored here on the DRAFT and
-- frozen at issue by the immutability trigger (due_date is not in the mutable
-- whitelist). A null due date is valid — that invoice is Unpaid but never Overdue.
--
-- The signature grows (p_due_date date), so the old 12-arg overload is DROPPED first
-- to avoid an ambiguous overload. Everything else — SECURITY INVOKER (caller RLS),
-- the version + status='draft' gate, the non-retryable P0001 'invoice_draft_conflict'
-- marker, replace-all line + tax lines, precomputed totals (I2/I3) — is preserved
-- exactly.
-- ===========================================================================

drop function if exists public.save_invoice_draft(
  uuid, uuid, integer, uuid, text, text, uuid, jsonb, numeric, numeric, numeric, jsonb
);

create or replace function public.save_invoice_draft(
  p_org               uuid,
  p_invoice_id        uuid,
  p_expected_version  integer,
  p_customer_record_id uuid,
  p_province          text,
  p_language          text,
  p_actor             uuid,
  p_line_items        jsonb,
  p_subtotal          numeric,
  p_tax_total         numeric,
  p_total             numeric,
  p_tax_lines         jsonb,
  p_due_date          date
)
  returns table (id uuid, version integer)
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  v_invoice_id uuid;
  v_version    integer;
begin
  if p_invoice_id is null then
    -- New draft. RLS with-check gates the org; status is forced to 'draft'.
    insert into public.invoices (
      organization_id,
      customer_record_id,
      place_of_supply_province,
      language,
      status,
      version,
      actor_id,
      subtotal,
      tax_total,
      total,
      due_date
    )
    values (
      p_org,
      p_customer_record_id,
      p_province,
      coalesce(p_language, 'en'),
      'draft',
      1,
      p_actor,
      coalesce(p_subtotal, 0),
      coalesce(p_tax_total, 0),
      coalesce(p_total, 0),
      p_due_date
    )
    returning invoices.id, invoices.version
      into v_invoice_id, v_version;
  else
    -- Existing draft. Version-gated + status-gated update; bump version.
    update public.invoices
      set customer_record_id       = p_customer_record_id,
          place_of_supply_province = p_province,
          language                 = coalesce(p_language, 'en'),
          subtotal                 = coalesce(p_subtotal, 0),
          tax_total                = coalesce(p_tax_total, 0),
          total                    = coalesce(p_total, 0),
          due_date                 = p_due_date,
          version                  = invoices.version + 1,
          actor_id                 = p_actor,
          updated_at               = now()
      where invoices.id = p_invoice_id
        and invoices.organization_id = p_org
        and invoices.version = p_expected_version
        and invoices.status = 'draft'
      returning invoices.id, invoices.version
        into v_invoice_id, v_version;

    if v_invoice_id is null then
      -- The row is missing, foreign (RLS-hidden), stale (wrong version), or no
      -- longer a draft (issued/paid/void). Raise a DISTINGUISHABLE error the
      -- mutation layer matches on the message marker and maps to versionConflict/
      -- notDraft. Uses the default raise_exception SQLSTATE P0001 (a DETERMINISTIC
      -- conflict) — deliberately NOT 40001/40P01, which PostgREST + the pooler
      -- auto-retry as transient serialization/deadlock failures.
      raise exception 'invoice_draft_conflict'
        using errcode = 'P0001';
    end if;
  end if;

  -- Replace-all line items: clear then re-insert the provided set. A concurrent
  -- writer cannot interleave — the whole function runs in one transaction, and the
  -- version gate above already rejected a stale save.
  delete from public.invoice_line_items
    where invoice_line_items.invoice_id = v_invoice_id;

  insert into public.invoice_line_items (
    invoice_id,
    organization_id,
    description,
    quantity,
    unit_price,
    amount,
    sort_order
  )
  select
    v_invoice_id,
    p_org,
    (item ->> 'description'),
    (item ->> 'quantity')::numeric,
    (item ->> 'unit_price')::numeric,
    (item ->> 'amount')::numeric,
    coalesce((item ->> 'sort_order')::integer, ordinality::integer - 1)
  from jsonb_array_elements(coalesce(p_line_items, '[]'::jsonb))
    with ordinality as t(item, ordinality);

  -- Replace-all tax lines from the canonical computeInvoiceTotals output (I2/I3).
  delete from public.invoice_tax_lines
    where invoice_tax_lines.invoice_id = v_invoice_id;

  insert into public.invoice_tax_lines (
    invoice_id,
    organization_id,
    label,
    rate,
    base,
    tax_amount,
    sort_order
  )
  select
    v_invoice_id,
    p_org,
    (item ->> 'label'),
    (item ->> 'rate')::numeric,
    (item ->> 'base')::numeric,
    (item ->> 'tax_amount')::numeric,
    coalesce((item ->> 'sort_order')::integer, ordinality::integer - 1)
  from jsonb_array_elements(coalesce(p_tax_lines, '[]'::jsonb))
    with ordinality as t(item, ordinality);

  return query select v_invoice_id, v_version;
end;
$$;

comment on function public.save_invoice_draft(uuid, uuid, integer, uuid, text, text, uuid, jsonb, numeric, numeric, numeric, jsonb, date) is
  'Story 12.7 — atomic upsert invoice + replace line items + replace tax lines under '
  'caller RLS (SECURITY INVOKER), now also persisting the owner-set due_date on the '
  'draft (frozen at issue). Stores subtotal/tax_total/total and the tax lines from '
  'computeInvoiceTotals (I2/I3). Version-gated + status=draft update (0 rows -> raises '
  'invoice_draft_conflict, SQLSTATE P0001 — NOT a retryable 40001). Money figures arrive precomputed.';
