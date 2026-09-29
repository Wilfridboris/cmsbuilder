-- ===========================================================================
-- Story 12.4 — Invoice immutability triggers (I7)
--
-- Once issued, an invoice is a finalized legal document: it is immutable and can be
-- corrected only via a future credit note (12.8). Immutability is enforced in the
-- database (not just the app) as a status-transition WHITELIST, not a blanket freeze.
--
-- enforce_invoice_immutability (BEFORE UPDATE OR DELETE on invoices):
--   * While OLD.status = 'draft': allow everything, including DELETE (discard) and the
--     draft→issued flip (which writes number/snapshots/token in one statement). Drafts
--     stay fully mutable — the freeze keys on OLD.status, so the issuing UPDATE itself
--     is permitted and every LATER write hits the frozen branch.
--   * Once OLD.status is non-draft:
--       - DELETE is blocked (invoice_immutable).
--       - UPDATE permits ONLY the whitelisted status transitions
--         issued→paid, issued→void, issued→overdue, paid→overdue — with version,
--         updated_at, and actor_id allowed to change alongside. Any OTHER column change
--         raises invoice_immutable; a non-whitelisted status change raises
--         invoice_status_transition.
--
-- enforce_invoice_child_immutability (BEFORE INSERT OR UPDATE OR DELETE on
-- invoice_line_items and invoice_tax_lines): blocks the write when the parent invoice's
-- status is non-draft; allows it when the parent is a draft OR already gone (so a
-- draft's ON DELETE CASCADE discard still works — the parent row is deleted first).
--
-- Both raise P0001 (a deterministic block), never a retryable 40001.
--
-- Note for 12.5: it will ALTER enforce_invoice_immutability to also permit a one-time
-- null→value write of pdf_path on an issued invoice.
-- ===========================================================================

create or replace function public.enforce_invoice_immutability()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  -- Drafts stay fully mutable and discardable. This branch also permits the
  -- draft→issued flip (OLD.status = 'draft'), which writes the number/snapshots/token
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
  -- and even then ONLY status + version + updated_at + actor_id may change. Every
  -- other column must be byte-for-byte unchanged.
  if NEW.status is distinct from OLD.status then
    if not (
      (OLD.status = 'issued' and NEW.status in ('paid', 'void', 'overdue'))
      or (OLD.status = 'paid' and NEW.status = 'overdue')
    ) then
      raise exception 'invoice_status_transition'
        using errcode = 'P0001';
    end if;
  end if;

  -- Freeze every column except the four that may change during a whitelisted
  -- transition (status, version, updated_at, actor_id). Any drift raises immutable.
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
  'Story 12.4 (I7) — invoice immutability whitelist. Drafts stay mutable/discardable '
  '(and the draft→issued flip is permitted). A non-draft invoice cannot be deleted, and '
  'an UPDATE may change ONLY status/version/updated_at/actor_id and ONLY via '
  'issued→paid|void|overdue or paid→overdue; anything else raises invoice_immutable / '
  'invoice_status_transition (P0001). Corrections are via a credit note (12.8).';

create trigger enforce_invoice_immutability
  before update or delete on public.invoices
  for each row
  execute function public.enforce_invoice_immutability();

-- --- Child rows (line items + tax lines) -----------------------------------------

create or replace function public.enforce_invoice_child_immutability()
  returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  v_invoice_id uuid;
  v_status     text;
begin
  -- The parent invoice id on the row being written (NEW for insert/update, OLD for
  -- delete).
  v_invoice_id := case when TG_OP = 'DELETE' then OLD.invoice_id else NEW.invoice_id end;

  select status into v_status
    from public.invoices
    where id = v_invoice_id;

  -- A missing parent means the parent invoice was already deleted in this statement
  -- (a draft's ON DELETE CASCADE discard) — allow the child delete to proceed. Only a
  -- parent that EXISTS and is non-draft blocks the write.
  if v_status is not null and v_status <> 'draft' then
    raise exception 'invoice_immutable'
      using errcode = 'P0001';
  end if;

  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

comment on function public.enforce_invoice_child_immutability() is
  'Story 12.4 (I7) — freeze invoice line/tax child rows once the parent invoice is '
  'non-draft. Blocks INSERT/UPDATE/DELETE when the parent status is non-draft; allows it '
  'when the parent is a draft or already gone (a draft cascade-delete discard). Raises '
  'invoice_immutable (P0001).';

create trigger enforce_invoice_line_items_immutability
  before insert or update or delete on public.invoice_line_items
  for each row
  execute function public.enforce_invoice_child_immutability();

create trigger enforce_invoice_tax_lines_immutability
  before insert or update or delete on public.invoice_tax_lines
  for each row
  execute function public.enforce_invoice_child_immutability();
