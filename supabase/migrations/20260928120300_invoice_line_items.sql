-- ===========================================================================
-- Story 12.2 — Invoice Line Items
--
-- The typed child table holding an invoice's line items (description, quantity,
-- unit price, computed amount, sort order). One invoice has many line items;
-- FK -> invoices(id) ON DELETE CASCADE so discarding a draft removes its lines.
--
-- `organization_id` is DENORMALIZED onto every line so the tenant-isolation RLS
-- policy can gate line rows with the same auth_org_ids() predicate as the parent
-- (no join to invoices inside the policy). The mutation layer keeps it consistent
-- with the parent invoice's org.
--
-- `amount = round(quantity * unit_price, 2)` is computed SERVER-SIDE by the single
-- canonical helper computeLineAmount (src/lib/invoicing/tax.ts, Invariant I2) and
-- arrives precomputed — this table stores it; no SQL re-implements it. Story 12.3
-- extends that same helper with subtotal/total/HST.
-- ===========================================================================

create table public.invoice_line_items (
  id               uuid        primary key default gen_random_uuid(),
  invoice_id       uuid        not null references public.invoices (id) on delete cascade,

  -- Denormalized org id so RLS gates line rows with the same auth_org_ids()
  -- predicate as the parent (kept consistent with the parent by the mutation layer).
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

comment on table public.invoice_line_items is
  'Story 12.2 — invoice line items (typed child of invoices; ON DELETE CASCADE). '
  'organization_id is denormalized for the tenant-isolation RLS policy. amount is '
  'precomputed by computeLineAmount (Invariant I2); no SQL re-implements line amount.';
comment on column public.invoice_line_items.organization_id is
  'Denormalized from the parent invoice so RLS gates line rows without a join; the '
  'mutation layer keeps it equal to the parent invoice organization_id.';
comment on column public.invoice_line_items.amount is
  'round(quantity * unit_price, 2), computed by computeLineAmount (I2) and stored.';

-- Ordered read of an invoice's lines (the editor + render iterate in sort_order).
create index invoice_line_items_invoice_sort_idx
  on public.invoice_line_items (invoice_id, sort_order);

-- The single static membership policy — identical shape to invoices.
alter table public.invoice_line_items enable row level security;

create policy "invoice_line_items_tenant_isolation" on public.invoice_line_items
  for all
  using      (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));
