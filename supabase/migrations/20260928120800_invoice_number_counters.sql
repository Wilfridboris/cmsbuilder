-- ===========================================================================
-- Story 12.4 — Per-org invoice number counter (I1)
--
-- Gap-free per-org invoice numbering is a LOCKED COUNTER ROW, not a Postgres
-- sequence: a sequence is not transactional-rollback-safe (a rolled-back issue
-- would burn a number, violating gap-free-except-voids) and is not naturally
-- per-org. One row per org holds the NEXT number to allocate; the issue_invoice
-- RPC advances it with `update ... returning next_number - 1` inside the same
-- transaction that flips the invoice to `issued`. A concurrent issue serializes on
-- the row lock; the counter only advances on commit.
--
-- Isolation mirrors every other invoicing table: RLS enabled with the single
-- static membership policy backed by auth_org_ids(). Numbers start at 1.
-- ===========================================================================

create table public.invoice_number_counters (
  organization_id  uuid        primary key references public.organizations (id) on delete cascade,
  -- The NEXT number to allocate. Allocation reads-then-increments this atomically
  -- under a row lock; the allocated number is (next_number before the increment).
  next_number      bigint      not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.invoice_number_counters is
  'Story 12.4 (I1) — per-org gap-free invoice number counter. next_number is the next '
  'value to allocate; issue_invoice advances it under a row lock inside the issue '
  'transaction (never max()+1). A sequence is deliberately NOT used (not rollback-safe, '
  'not per-org). Numbers start at 1; a void leaves a permanent gap.';
comment on column public.invoice_number_counters.next_number is
  'The next invoice number to allocate for this org. Allocation returns '
  '(next_number - 1) after incrementing, so the first allocation returns 1.';

-- The single static membership policy — identical shape to invoices.
alter table public.invoice_number_counters enable row level security;

create policy "invoice_number_counters_tenant_isolation" on public.invoice_number_counters
  for all
  using      (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));
