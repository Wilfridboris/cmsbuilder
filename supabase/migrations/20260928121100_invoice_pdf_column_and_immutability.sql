-- ===========================================================================
-- Story 12.5 — invoices.pdf_path + one-time null->value immutability relaxation (I5/I7)
--
-- Story 12.4 froze issued invoices as immutable via enforce_invoice_immutability
-- (a status-transition whitelist). Story 12.5 renders and freezes a branded PDF to
-- the private `invoice-pdfs` bucket AFTER the issue transaction commits, then records
-- the bucket-relative object key in a new `invoices.pdf_path` column.
--
-- Because the PDF freeze lives OUTSIDE the (already-committed, irreversible) issue
-- transaction and is best-effort + retryable, the immutability trigger must permit
-- exactly ONE `null->value` write of `pdf_path` on a non-draft invoice — and ONLY that
-- column changing, alongside the already-permitted status/version/updated_at/actor_id.
-- A `value->value` change or a null overwrite of pdf_path (or drift on any other frozen
-- column) still raises invoice_immutable (P0001). All other 12.4 freezes are intact.
-- ===========================================================================

-- The new nullable column. Null until the post-issue ensureInvoicePdf freeze succeeds;
-- existing draft/issued rows read null until (re)frozen.
alter table public.invoices
  add column if not exists pdf_path text;

comment on column public.invoices.pdf_path is
  'Story 12.5 (I5) — bucket-relative object key of the frozen invoice PDF in the '
  'private invoice-pdfs bucket ({organization_id}/{invoice_id}.pdf). Null until the '
  'post-issue freeze commits; the immutability trigger permits exactly one null->value '
  'write on a non-draft invoice, so a failed freeze stays retryable.';

-- Re-create the immutability whitelist to permit the one-time pdf_path write. This is
-- the 12.4 body (20260928121000_invoice_immutability_triggers.sql) with a single change:
-- pdf_path is REMOVED from the frozen-column drift check and instead allowed to change
-- ONLY as a null->value transition (never value->value, never value->null).
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
  -- handled above. Any drift raises immutable.
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
  'Story 12.4 (I7) + 12.5 (I5) — invoice immutability whitelist. Drafts stay '
  'mutable/discardable (and the draft->issued flip is permitted). A non-draft invoice '
  'cannot be deleted; an UPDATE may change ONLY status/version/updated_at/actor_id '
  '(via issued->paid|void|overdue or paid->overdue) PLUS exactly one null->value write '
  'of pdf_path. Anything else raises invoice_immutable / invoice_status_transition '
  '(P0001). Corrections are via a credit note (12.8).';
