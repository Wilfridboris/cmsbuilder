-- ===========================================================================
-- Story 12.3 — Totals & Ontario HST (Place of Supply)
--
-- Adds the authoritative money columns to `invoices` and the typed
-- `invoice_tax_lines` child table. Every draft save writes these columns and
-- tax rows SOLELY from the canonical computeInvoiceTotals output
-- (src/lib/invoicing/tax.ts, Invariants I2/I3) — no SQL re-implements subtotal,
-- tax, or line amount. Later stories (12.4 issue gate, 12.5 PDF) read these
-- stored figures.
--
-- HST is computed ONCE on the subtotal (round(subtotal × rate, 2)) and emitted as
-- exactly ONE invoice_tax_lines row — never per line, never split into
-- federal/provincial (I3, FR84). A tax line exists only when the business is
-- GST/HST-registered (effective as of the reference date) AND the place of supply
-- has an active rate (Ontario in the MVP).
-- ===========================================================================

-- Money columns on the invoice parent. `numeric not null default 0` so existing
-- 12.2 drafts read as 0 until their next save (which recomputes and stores them).
alter table public.invoices
  add column if not exists subtotal  numeric not null default 0,
  add column if not exists tax_total numeric not null default 0,
  add column if not exists total     numeric not null default 0;

comment on column public.invoices.subtotal is
  'Sum of line amounts (Story 12.3). Written only from computeInvoiceTotals (I2).';
comment on column public.invoices.tax_total is
  'Total tax (Story 12.3). Sum of invoice_tax_lines.tax_amount; 0 when no tax applies (FR84).';
comment on column public.invoices.total is
  'subtotal + tax_total (Story 12.3). Written only from computeInvoiceTotals (I2).';

-- The typed tax-line child table. Mirrors invoice_line_items: denormalized
-- organization_id for the RLS policy, FK -> invoices(id) ON DELETE CASCADE, and a
-- (invoice_id, sort_order) index for ordered reads. For the MVP Ontario path there
-- is at most ONE row per invoice (single HST line); the table shape supports more
-- for a future Quebec (GST + QST) path with no re-architecture.
create table public.invoice_tax_lines (
  id               uuid        primary key default gen_random_uuid(),
  invoice_id       uuid        not null references public.invoices (id) on delete cascade,

  -- Denormalized org id so RLS gates tax rows with the same auth_org_ids()
  -- predicate as the parent (kept consistent with the parent by the mutation layer).
  organization_id  uuid        not null references public.organizations (id) on delete cascade,

  -- Canonical stored label (e.g. 'HST'); the form/PDF translate it for display.
  label            text        not null,
  rate             numeric     not null,
  -- The base the tax was computed on (the invoice subtotal).
  base             numeric     not null,
  -- round(base × rate, 2), computed by computeInvoiceTotals (I3); stored, never
  -- recomputed in SQL.
  tax_amount       numeric     not null,
  sort_order       integer     not null default 0,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.invoice_tax_lines is
  'Story 12.3 — invoice tax lines (typed child of invoices; ON DELETE CASCADE). '
  'organization_id is denormalized for the tenant-isolation RLS policy. For the MVP '
  'Ontario path there is exactly ONE HST row when tax applies; amounts are computed '
  'by computeInvoiceTotals (Invariants I2/I3) and stored — no SQL re-implements tax.';
comment on column public.invoice_tax_lines.organization_id is
  'Denormalized from the parent invoice so RLS gates tax rows without a join; the '
  'mutation layer keeps it equal to the parent invoice organization_id.';
comment on column public.invoice_tax_lines.tax_amount is
  'round(base × rate, 2), computed once on the subtotal by computeInvoiceTotals (I3).';

-- Ordered read of an invoice's tax lines (the form/render iterate in sort_order).
create index invoice_tax_lines_invoice_sort_idx
  on public.invoice_tax_lines (invoice_id, sort_order);

-- The single static membership policy — identical shape to invoice_line_items.
alter table public.invoice_tax_lines enable row level security;

create policy "invoice_tax_lines_tenant_isolation" on public.invoice_tax_lines
  for all
  using      (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));
