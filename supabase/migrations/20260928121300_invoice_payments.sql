-- ===========================================================================
-- Story 12.7 — invoice_payments: track a single out-of-band payment (no processing)
--
-- Scheza never processes, holds, moves, or reconciles money (Phase 3 excluded). This
-- table records exactly ONE out-of-band payment per invoice — the owner marks an issued
-- invoice paid with a method, date, amount, and optional reference. Recording a payment
-- and flipping the whitelisted issued->paid transition happen together in the
-- record_invoice_payment RPC (next migration).
--
-- I7 — this table is DELIBERATELY OUTSIDE the immutability triggers: it stays freely
-- mutable while its parent invoice is frozen. It is NOT referenced by
-- 20260928121000_invoice_immutability_triggers.sql (or the 12.5/12.7 re-creations of
-- enforce_invoice_immutability). A recorded payment can be corrected/deleted even though
-- the invoice itself is a finalized legal document.
--
-- Isolation mirrors invoices: RLS enabled with the single static membership policy
-- backed by auth_org_ids(). UNIQUE(invoice_id) enforces exactly one payment per invoice
-- (partial/multiple payments are deferred). An index on invoice_id supports the lookup.
-- ===========================================================================

create table public.invoice_payments (
  id               uuid        primary key default gen_random_uuid(),
  invoice_id       uuid        not null references public.invoices (id) on delete cascade,
  organization_id  uuid        not null references public.organizations (id) on delete cascade,

  -- The out-of-band method the owner received the money through. A closed vocabulary
  -- (etransfer/cheque/card/other) — Scheza does not process any of them.
  method           text        not null
                     check (method in ('etransfer', 'cheque', 'card', 'other')),

  -- The owner-supplied payment date and amount, and an optional free-text reference
  -- (a cheque number, an e-transfer confirmation code, etc.).
  paid_date        date        not null,
  amount           numeric(15,2) not null,
  reference        text,

  -- Audit.
  actor_id         uuid,
  created_at       timestamptz not null default now(),

  -- Exactly one payment per invoice (I7 rationale in the spec design notes).
  constraint invoice_payments_one_per_invoice unique (invoice_id)
);

comment on table public.invoice_payments is
  'Story 12.7 — a single out-of-band payment record per invoice (no processing). '
  'DELIBERATELY outside the immutability triggers (I7): freely mutable while the parent '
  'invoice is frozen. UNIQUE(invoice_id): exactly one payment per invoice; partial/'
  'multiple payments are deferred. Recording a payment + the issued->paid flip run '
  'together in record_invoice_payment.';
comment on column public.invoice_payments.method is
  'Out-of-band method (etransfer|cheque|card|other). Scheza never processes money.';
comment on column public.invoice_payments.reference is
  'Optional free-text reference (cheque number, e-transfer confirmation, etc.).';

-- The lookup access pattern (a payment by its invoice). Distinct from the unique
-- constraint's index only in intent; kept explicit per the spec.
create index invoice_payments_invoice_idx
  on public.invoice_payments (invoice_id);

-- The single static membership policy — identical shape to invoices_tenant_isolation
-- (20260928120200_invoices.sql). A member of the org may read + write their own
-- payments; cross-tenant rows are invisible and unwritable.
alter table public.invoice_payments enable row level security;

create policy "invoice_payments_tenant_isolation" on public.invoice_payments
  for all
  using      (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));
