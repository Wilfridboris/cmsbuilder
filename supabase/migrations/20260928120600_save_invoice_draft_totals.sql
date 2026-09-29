-- ===========================================================================
-- Story 12.3 — save_invoice_draft(): store totals + replace tax lines
--
-- Extends the Story 12.2 atomic "upsert invoice + replace line items" RPC to also
-- store the money totals (subtotal / tax_total / total) on the invoice row and
-- REPLACE its invoice_tax_lines from a provided jsonb set. All figures ARRIVE
-- PRECOMPUTED from the canonical computeInvoiceTotals (src/lib/invoicing/tax.ts,
-- Invariants I2/I3) — no SQL re-implements subtotal, tax, or line amount.
--
-- The signature grows (p_subtotal / p_tax_total / p_total / p_tax_lines), so the
-- old 8-arg overload is DROPPED first to avoid an ambiguous overload. Everything
-- else — SECURITY INVOKER (caller RLS), the version + status='draft' gate, the
-- non-retryable P0001 'invoice_draft_conflict' marker, replace-all line items — is
-- preserved exactly.
--
-- Story 12.3 stores totals on DRAFT rows only; it never issues, mints a number,
-- freezes a snapshot, or transitions status (those are 12.4-12.8).
-- ===========================================================================

drop function if exists public.save_invoice_draft(
  uuid, uuid, integer, uuid, text, text, uuid, jsonb
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
  p_tax_lines         jsonb
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
      total
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
      coalesce(p_total, 0)
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
      -- auto-retry as transient serialization/deadlock failures, stalling what
      -- should be an instant conflict.
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
  -- For the MVP Ontario path this is zero or one row; the table supports more for a
  -- future Quebec path. No SQL re-implements tax — amounts arrive precomputed.
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

comment on function public.save_invoice_draft(uuid, uuid, integer, uuid, text, text, uuid, jsonb, numeric, numeric, numeric, jsonb) is
  'Story 12.3 — atomic upsert invoice + replace line items + replace tax lines under '
  'caller RLS (SECURITY INVOKER). Stores subtotal/tax_total/total and the tax lines '
  'from computeInvoiceTotals (I2/I3). Inserts a new draft when p_invoice_id is null, '
  'else a version-gated + status=draft update (0 rows -> raises invoice_draft_conflict, '
  'SQLSTATE P0001 — NOT a retryable 40001). All money figures arrive precomputed.';
