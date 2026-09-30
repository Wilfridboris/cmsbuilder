-- ===========================================================================
-- Story 12.8 — Credit Note Line Items
--
-- The typed child table holding a credit note's line items — IDENTICAL in shape to
-- invoice_line_items (20260928120300), just parented on credit_notes. One credit
-- note has many line items; FK -> credit_notes(id) ON DELETE CASCADE so discarding a
-- draft removes its lines.
--
-- `organization_id` is DENORMALIZED onto every line so the tenant-isolation RLS
-- policy gates line rows with the same auth_org_ids() predicate as the parent (no
-- join). Line amounts are entered and stored as POSITIVE values (I2); the document's
-- "Credit Note" title carries the reduction meaning. `amount = round(quantity *
-- unit_price, 2)` is computed server-side by the SAME canonical computeLineAmount
-- (src/lib/invoicing/tax.ts) and arrives precomputed — no SQL re-implements it.
-- ===========================================================================

create table public.credit_note_line_items (
  id               uuid        primary key default gen_random_uuid(),
  credit_note_id   uuid        not null references public.credit_notes (id) on delete cascade,

  -- Denormalized org id so RLS gates line rows without a join (kept consistent with
  -- the parent by the mutation layer).
  organization_id  uuid        not null references public.organizations (id) on delete cascade,

  description      text        not null,
  quantity         numeric     not null,
  unit_price       numeric     not null,
  -- Precomputed by computeLineAmount (I2); stored, never recomputed in SQL.
  amount           numeric     not null,
  sort_order       integer     not null default 0,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.credit_note_line_items is
  'Story 12.8 — credit-note line items (typed child of credit_notes; ON DELETE '
  'CASCADE). Identical shape to invoice_line_items. organization_id is denormalized '
  'for the tenant-isolation RLS policy. Amounts are POSITIVE (I2); the Credit Note '
  'title carries the reduction meaning. amount is precomputed by computeLineAmount.';

create index credit_note_line_items_cn_sort_idx
  on public.credit_note_line_items (credit_note_id, sort_order);

alter table public.credit_note_line_items enable row level security;

create policy "credit_note_line_items_tenant_isolation" on public.credit_note_line_items
  for all
  using      (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));
