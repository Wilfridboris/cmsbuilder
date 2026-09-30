-- ===========================================================================
-- Story 12.8 — Credit Note Tax Lines
--
-- The typed tax-line child table for credit notes — IDENTICAL in shape to
-- invoice_tax_lines (20260928120500), parented on credit_notes. For the MVP Ontario
-- path there is at most ONE row per credit note (single HST line), computed once on
-- the subtotal by the SAME canonical computeInvoiceTotals (I3) and stored — never
-- recomputed in SQL, never split into federal/provincial.
--
-- `organization_id` is DENORMALIZED for the tenant-isolation RLS policy; FK ->
-- credit_notes(id) ON DELETE CASCADE; a (credit_note_id, sort_order) index for
-- ordered reads.
-- ===========================================================================

create table public.credit_note_tax_lines (
  id               uuid        primary key default gen_random_uuid(),
  credit_note_id   uuid        not null references public.credit_notes (id) on delete cascade,

  -- Denormalized org id so RLS gates tax rows without a join (kept consistent with
  -- the parent by the mutation layer).
  organization_id  uuid        not null references public.organizations (id) on delete cascade,

  -- Canonical stored label (e.g. 'HST'); the form/PDF translate it for display.
  label            text        not null,
  rate             numeric     not null,
  -- The base the tax was computed on (the credit-note subtotal).
  base             numeric     not null,
  -- round(base × rate, 2), computed by computeInvoiceTotals (I3); stored, never
  -- recomputed in SQL.
  tax_amount       numeric     not null,
  sort_order       integer     not null default 0,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.credit_note_tax_lines is
  'Story 12.8 — credit-note tax lines (typed child of credit_notes; ON DELETE '
  'CASCADE). Identical shape to invoice_tax_lines. organization_id is denormalized '
  'for the tenant-isolation RLS policy. Exactly ONE HST row when tax applies; amounts '
  'are computed by computeInvoiceTotals (I2/I3) and stored — no SQL re-implements tax.';

create index credit_note_tax_lines_cn_sort_idx
  on public.credit_note_tax_lines (credit_note_id, sort_order);

alter table public.credit_note_tax_lines enable row level security;

create policy "credit_note_tax_lines_tenant_isolation" on public.credit_note_tax_lines
  for all
  using      (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));
