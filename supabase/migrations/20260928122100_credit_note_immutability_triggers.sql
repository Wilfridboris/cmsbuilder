-- ===========================================================================
-- Story 12.8 — Credit-note immutability triggers (I7 analog)
--
-- Once issued, a credit note is a finalized correction document: it is immutable
-- (FR88). Immutability is enforced in the database as a status-transition WHITELIST,
-- mirroring enforce_invoice_immutability (20260928121000) — a credit note's whitelist
-- is `draft->issued` and `issued->void` (no paid/overdue — a credit note is not a
-- receivable). The original invoice is NEVER written by any credit-note path.
--
-- enforce_credit_note_immutability (BEFORE UPDATE OR DELETE on credit_notes):
--   * While OLD.status = 'draft': allow everything, including DELETE (discard) and the
--     draft->issued flip. Drafts stay fully mutable — the freeze keys on OLD.status.
--   * Once OLD.status is non-draft (issued/void):
--       - DELETE is blocked (credit_note_immutable).
--       - UPDATE permits ONLY the whitelisted status transition issued->void — with
--         version, updated_at, and actor_id allowed to change alongside. Any OTHER
--         column change raises credit_note_immutable; a non-whitelisted status change
--         raises credit_note_status_transition.
--
-- The one-time null->value pdf_path relaxation is added by the next migration
-- (20260928122200), mirroring the 12.4/12.5 two-step (triggers, then pdf relaxation).
--
-- enforce_credit_note_child_immutability (BEFORE INSERT OR UPDATE OR DELETE on
-- credit_note_line_items and credit_note_tax_lines): blocks the write when the parent
-- credit note's status is non-draft; allows it when the parent is a draft OR already
-- gone (so a draft's ON DELETE CASCADE discard still works).
--
-- Both raise P0001 (a deterministic block), never a retryable 40001.
-- ===========================================================================

create or replace function public.enforce_credit_note_immutability()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  -- Drafts stay fully mutable and discardable. This branch also permits the
  -- draft->issued flip (OLD.status = 'draft'), which writes number/snapshots/token in
  -- the same statement — the freeze only engages once the row is already non-draft.
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
  -- actor_id may change. Every other column must be byte-for-byte unchanged.
  if NEW.status is distinct from OLD.status then
    if not (OLD.status = 'issued' and NEW.status = 'void') then
      raise exception 'credit_note_status_transition'
        using errcode = 'P0001';
    end if;
  end if;

  -- Freeze every column except the four that may change during a whitelisted transition
  -- (status, version, updated_at, actor_id). pdf_path is added to this freeze in the base
  -- form and relaxed to a one-time null->value write by the next migration. Any drift
  -- raises immutable.
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
     or NEW.pdf_path is distinct from OLD.pdf_path
     or NEW.created_at is distinct from OLD.created_at
  then
    raise exception 'credit_note_immutable'
      using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

comment on function public.enforce_credit_note_immutability() is
  'Story 12.8 (I7 analog) — credit-note immutability whitelist. Drafts stay '
  'mutable/discardable (and the draft->issued flip is permitted). A non-draft credit '
  'note cannot be deleted; an UPDATE may change ONLY status/version/updated_at/actor_id '
  'and ONLY via issued->void; anything else raises credit_note_immutable / '
  'credit_note_status_transition (P0001). The original invoice is never written (FR88). '
  'The one-time null->value pdf_path relaxation is added by the next migration.';

create trigger enforce_credit_note_immutability
  before update or delete on public.credit_notes
  for each row
  execute function public.enforce_credit_note_immutability();

-- --- Child rows (line items + tax lines) -----------------------------------------

create or replace function public.enforce_credit_note_child_immutability()
  returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  v_credit_note_id uuid;
  v_status         text;
begin
  v_credit_note_id := case
    when TG_OP = 'DELETE' then OLD.credit_note_id
    else NEW.credit_note_id
  end;

  select status into v_status
    from public.credit_notes
    where id = v_credit_note_id;

  -- A missing parent means it was already deleted in this statement (a draft's ON DELETE
  -- CASCADE discard) — allow the child delete. Only a parent that EXISTS and is non-draft
  -- blocks the write.
  if v_status is not null and v_status <> 'draft' then
    raise exception 'credit_note_immutable'
      using errcode = 'P0001';
  end if;

  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

comment on function public.enforce_credit_note_child_immutability() is
  'Story 12.8 (I7 analog) — freeze credit-note line/tax child rows once the parent is '
  'non-draft. Blocks INSERT/UPDATE/DELETE when the parent status is non-draft; allows it '
  'when the parent is a draft or already gone (a draft cascade-delete discard). Raises '
  'credit_note_immutable (P0001).';

create trigger enforce_credit_note_line_items_immutability
  before insert or update or delete on public.credit_note_line_items
  for each row
  execute function public.enforce_credit_note_child_immutability();

create trigger enforce_credit_note_tax_lines_immutability
  before insert or update or delete on public.credit_note_tax_lines
  for each row
  execute function public.enforce_credit_note_child_immutability();
