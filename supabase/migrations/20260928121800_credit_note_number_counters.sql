-- ===========================================================================
-- Story 12.8 — Per-org credit-note number counter (I1)
--
-- Gap-free per-org credit-note numbering is a LOCKED COUNTER ROW, mirroring
-- invoice_number_counters (20260928120800) but in a DISJOINT namespace: credit-note
-- numbers are their own per-org sequence, never sharing an id/counter with the
-- invoice namespace. A sequence is deliberately NOT used (not rollback-safe, not
-- per-org). One row per org holds the NEXT credit-note number to allocate; the
-- issue_credit_note RPC advances it with `update ... returning next_number - 1`
-- inside the same transaction that flips the credit note to `issued`. A concurrent
-- issue serializes on the row lock; the counter only advances on commit. A void
-- leaves a permanent gap.
--
-- Isolation mirrors every other invoicing table: RLS enabled with the single static
-- membership policy backed by auth_org_ids(). Numbers start at 1.
-- ===========================================================================

create table public.credit_note_number_counters (
  organization_id  uuid        primary key references public.organizations (id) on delete cascade,
  -- The NEXT credit-note number to allocate. Allocation reads-then-increments this
  -- atomically under a row lock; the allocated number is (next_number before increment).
  next_number      bigint      not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.credit_note_number_counters is
  'Story 12.8 (I1) — per-org gap-free credit-note number counter, in a namespace '
  'DISJOINT from invoice_number_counters. next_number is the next value to allocate; '
  'issue_credit_note advances it under a row lock inside the issue transaction (never '
  'max()+1). A sequence is deliberately NOT used. Numbers start at 1; a void leaves a gap.';
comment on column public.credit_note_number_counters.next_number is
  'The next credit-note number to allocate for this org. Allocation returns '
  '(next_number - 1) after incrementing, so the first allocation returns 1.';

alter table public.credit_note_number_counters enable row level security;

create policy "credit_note_number_counters_tenant_isolation" on public.credit_note_number_counters
  for all
  using      (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));
