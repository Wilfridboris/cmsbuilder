-- ===========================================================================
-- Story 12.7 — invoices.due_date (nullable, owner-set on the draft, frozen at issue)
--
-- The Invoices tab defaults to an Unpaid / Overdue receivables view derived AT READ
-- TIME from `status` + `due_date` (FR92). A due date is the ONLY input to the Overdue
-- label: an issued invoice whose `due_date` is before today is shown Overdue (a derived
-- label only — `overdue` is never written to `invoices.status`). A blank due date means
-- the invoice shows Unpaid but never Overdue.
--
-- The owner enters an optional Due date on the invoice DRAFT form; it is persisted on
-- the draft row via `save_invoice_draft` (extended in the next migration) and frozen at
-- issue by the existing immutability trigger — `due_date` is NOT in the mutable whitelist,
-- so once the parent invoice is non-draft the trigger's frozen-column check blocks any
-- change to it. All existing 12.2-12.6 rows read null (never Overdue) until (re)saved.
-- ===========================================================================

alter table public.invoices
  add column if not exists due_date date;

comment on column public.invoices.due_date is
  'Story 12.7 — optional owner-set invoice due date (YYYY-MM-DD). Set on the draft via '
  'save_invoice_draft and frozen at issue (NOT in the immutability whitelist). Drives the '
  'read-time Overdue label on the Invoices receivables view (issued AND due_date < today); '
  'never written to invoices.status. Null = Unpaid but never Overdue.';

-- Extend the immutability trigger to freeze due_date once the invoice is non-draft. The
-- 12.5 body (20260928121100) permitted a one-time null->value pdf_path write and froze
-- every other column EXCEPT the four transition columns and pdf_path. due_date is a new
-- column, so it is added to the frozen-column drift check here.
create or replace function public.enforce_invoice_immutability()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  -- Drafts stay fully mutable and discardable. This branch also permits the
  -- draft->issued flip (OLD.status = 'draft'), which writes the number/snapshots/token
  -- in the same statement — the freeze only engages once the row is already non-draft.
  if OLD.status = 'draft' then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;

  -- OLD.status is non-draft (issued/paid/overdue/void): a finalized document.
  if TG_OP = 'DELETE' then
    raise exception 'invoice_immutable'
      using errcode = 'P0001';
  end if;

  -- UPDATE on a non-draft invoice. Only a whitelisted status transition is allowed,
  -- and even then ONLY status + version + updated_at + actor_id (and the one-time
  -- pdf_path write below) may change. Every other column must be byte-for-byte
  -- unchanged.
  if NEW.status is distinct from OLD.status then
    if not (
      (OLD.status = 'issued' and NEW.status in ('paid', 'void', 'overdue'))
      or (OLD.status = 'paid' and NEW.status = 'overdue')
    ) then
      raise exception 'invoice_status_transition'
        using errcode = 'P0001';
    end if;
  end if;

  -- Story 12.5 (I5): pdf_path may change EXACTLY ONCE, null->value, on a non-draft
  -- invoice. A value->value change or a null overwrite (value->null) is forbidden and
  -- falls through to the frozen-column check below (OLD is distinct from NEW), raising
  -- invoice_immutable. Only the null->OLD-value case is exempted here.
  if NEW.pdf_path is distinct from OLD.pdf_path
     and not (OLD.pdf_path is null and NEW.pdf_path is not null)
  then
    raise exception 'invoice_immutable'
      using errcode = 'P0001';
  end if;

  -- Freeze every remaining column except the four that may change during a whitelisted
  -- transition (status, version, updated_at, actor_id) and the one-time pdf_path write
  -- handled above. Any drift raises immutable. due_date is frozen at issue (Story 12.7).
  if NEW.id is distinct from OLD.id
     or NEW.organization_id is distinct from OLD.organization_id
     or NEW.customer_record_id is distinct from OLD.customer_record_id
     or NEW.place_of_supply_province is distinct from OLD.place_of_supply_province
     or NEW.language is distinct from OLD.language
     or NEW.subtotal is distinct from OLD.subtotal
     or NEW.tax_total is distinct from OLD.tax_total
     or NEW.total is distinct from OLD.total
     or NEW.invoice_number is distinct from OLD.invoice_number
     or NEW.issue_date is distinct from OLD.issue_date
     or NEW.due_date is distinct from OLD.due_date
     or NEW.supplier_snapshot is distinct from OLD.supplier_snapshot
     or NEW.customer_snapshot is distinct from OLD.customer_snapshot
     or NEW.share_token is distinct from OLD.share_token
     or NEW.created_at is distinct from OLD.created_at
  then
    raise exception 'invoice_immutable'
      using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

comment on function public.enforce_invoice_immutability() is
  'Story 12.4 (I7) + 12.5 (I5) + 12.7 — invoice immutability whitelist. Drafts stay '
  'mutable/discardable (and the draft->issued flip is permitted). A non-draft invoice '
  'cannot be deleted; an UPDATE may change ONLY status/version/updated_at/actor_id '
  '(via issued->paid|void|overdue or paid->overdue) PLUS exactly one null->value write '
  'of pdf_path. due_date is frozen at issue. Anything else raises invoice_immutable / '
  'invoice_status_transition (P0001). Corrections are via a credit note (12.8).';
