-- ===========================================================================
-- Story 12.2 — save_invoice_draft(): atomic "upsert invoice + replace line items"
--
-- supabase-js has no client-side transaction, but a draft save touches two tables
-- (invoices + invoice_line_items). This SECURITY INVOKER function runs under the
-- CALLER'S rights, so the invoices / invoice_line_items tenant-isolation RLS
-- policies stay in force (a cross-org write is impossible) while the whole
-- upsert + replace runs in ONE transaction (a function body is atomic).
--
-- Behavior:
--   - p_invoice_id NULL  -> INSERT a new draft (status forced to 'draft', version 1).
--   - p_invoice_id set   -> UPDATE only when id = p_invoice_id AND version =
--                           p_expected_version AND status = 'draft', bumping version.
--                           0 rows updated -> raise a DISTINGUISHABLE error
--                           ('invoice_draft_conflict', SQLSTATE P0001 — NOT a
--                           retryable 40001/40P01) so the mutation layer maps it to
--                           versionConflict/notDraft by matching the message marker.
--   - Line items: DELETE all existing lines for the invoice, then re-insert the
--     provided set (replace-all — drafts are small and edited wholesale; race-safe
--     under the version gate). Amounts ARRIVE PRECOMPUTED (computeLineAmount, I2);
--     no SQL re-implements line amount here.
--
-- Returns the invoice id + the resulting version.
--
-- Story 12.2 NEVER computes HST, writes invoice-level totals, freezes a snapshot,
-- mints a number, or transitions status — those are 12.3-12.8.
-- ===========================================================================

create or replace function public.save_invoice_draft(
  p_org               uuid,
  p_invoice_id        uuid,
  p_expected_version  integer,
  p_customer_record_id uuid,
  p_province          text,
  p_language          text,
  p_actor             uuid,
  p_line_items        jsonb
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
      actor_id
    )
    values (
      p_org,
      p_customer_record_id,
      p_province,
      coalesce(p_language, 'en'),
      'draft',
      1,
      p_actor
    )
    returning invoices.id, invoices.version
      into v_invoice_id, v_version;
  else
    -- Existing draft. Version-gated + status-gated update; bump version.
    update public.invoices
      set customer_record_id       = p_customer_record_id,
          place_of_supply_province = p_province,
          language                 = coalesce(p_language, 'en'),
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

  return query select v_invoice_id, v_version;
end;
$$;

comment on function public.save_invoice_draft(uuid, uuid, integer, uuid, text, text, uuid, jsonb) is
  'Story 12.2 — atomic upsert invoice + replace line items under caller RLS '
  '(SECURITY INVOKER). Inserts a new draft when p_invoice_id is null, else a '
  'version-gated + status=draft update (0 rows -> raises invoice_draft_conflict, '
  'SQLSTATE P0001 — NOT a retryable 40001). Line amounts arrive precomputed (computeLineAmount, I2).';
