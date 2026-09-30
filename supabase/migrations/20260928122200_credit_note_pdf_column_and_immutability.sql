-- ===========================================================================
-- Story 12.8 — credit_notes one-time null->value pdf_path immutability relaxation (I8/I7)
--
-- The base credit_notes table (20260928121500) already carries the nullable pdf_path
-- column, and the previous migration (20260928122100) froze it once the credit note is
-- non-draft. This migration re-creates enforce_credit_note_immutability with a SINGLE
-- relaxation, mirroring 12.5 (20260928121100) for invoices: pdf_path may change EXACTLY
-- ONCE, null->value, on a non-draft credit note — and ONLY that column, alongside the
-- already-permitted status/version/updated_at/actor_id.
--
-- Because the PDF freeze lives OUTSIDE the (already-committed, irreversible) issue
-- transaction and is best-effort + retryable, this one-time relaxation lets
-- ensureCreditNotePdf write pdf_path after issue while a value->value change or a null
-- overwrite (or drift on any other frozen column) still raises credit_note_immutable.
-- The child triggers and all other freezes are untouched. The original invoice is never
-- written by any credit-note path (FR88).
-- ===========================================================================

create or replace function public.enforce_credit_note_immutability()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  -- Drafts stay fully mutable and discardable. This branch also permits the
  -- draft->issued flip (OLD.status = 'draft').
  if OLD.status = 'draft' then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;

  -- OLD.status is non-draft (issued/void): a finalized document.
  if TG_OP = 'DELETE' then
    raise exception 'credit_note_immutable'
      using errcode = 'P0001';
  end if;

  -- UPDATE on a non-draft credit note. Only the whitelisted status transition
  -- issued->void is allowed, and even then ONLY status + version + updated_at +
  -- actor_id (and the one-time pdf_path write below) may change.
  if NEW.status is distinct from OLD.status then
    if not (OLD.status = 'issued' and NEW.status = 'void') then
      raise exception 'credit_note_status_transition'
        using errcode = 'P0001';
    end if;
  end if;

  -- Story 12.8 (I8): pdf_path may change EXACTLY ONCE, null->value, on a non-draft credit
  -- note. A value->value change or a null overwrite (value->null) is forbidden and falls
  -- through to the frozen-column check below, raising credit_note_immutable. Only the
  -- null->value case is exempted here.
  if NEW.pdf_path is distinct from OLD.pdf_path
     and not (OLD.pdf_path is null and NEW.pdf_path is not null)
  then
    raise exception 'credit_note_immutable'
      using errcode = 'P0001';
  end if;

  -- Freeze every remaining column except the four transition columns and the one-time
  -- pdf_path write handled above. Any drift raises immutable.
  if NEW.id is distinct from OLD.id
     or NEW.organization_id is distinct from OLD.organization_id
     or NEW.invoice_id is distinct from OLD.invoice_id
     or NEW.original_invoice_number is distinct from OLD.original_invoice_number
     or NEW.customer_record_id is distinct from OLD.customer_record_id
     or NEW.place_of_supply_province is distinct from OLD.place_of_supply_province
     or NEW.language is distinct from OLD.language
     or NEW.subtotal is distinct from OLD.subtotal
     or NEW.tax_total is distinct from OLD.tax_total
     or NEW.total is distinct from OLD.total
     or NEW.credit_note_number is distinct from OLD.credit_note_number
     or NEW.issue_date is distinct from OLD.issue_date
     or NEW.supplier_snapshot is distinct from OLD.supplier_snapshot
     or NEW.customer_snapshot is distinct from OLD.customer_snapshot
     or NEW.share_token is distinct from OLD.share_token
     or NEW.created_at is distinct from OLD.created_at
  then
    raise exception 'credit_note_immutable'
      using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

comment on function public.enforce_credit_note_immutability() is
  'Story 12.8 (I7 analog + I8) — credit-note immutability whitelist. Drafts stay '
  'mutable/discardable (and the draft->issued flip is permitted). A non-draft credit note '
  'cannot be deleted; an UPDATE may change ONLY status/version/updated_at/actor_id (via '
  'issued->void) PLUS exactly one null->value write of pdf_path. Anything else raises '
  'credit_note_immutable / credit_note_status_transition (P0001). The original invoice is '
  'never written (FR88).';
