-- ===========================================================================
-- Story 12.2 — Draft an Invoice (from a Work Record or Standalone)
--
-- The typed platform `invoices` table: the parent row of an invoice. This is NOT
-- the JSONB records store — invoicing (Epic 12) is the one fixed, compliant
-- module and lives in dedicated typed columns so later stories can compute HST
-- (12.3), freeze snapshots + mint a gap-free number (12.4), and render a PDF
-- (12.5) authoritatively.
--
-- Story 12.2 is DRAFTING ONLY: it writes `status = 'draft'`. The full `status`
-- CHECK vocabulary is defined now so 12.3-12.8 need no ALTER; those later stories
-- add the money totals, supplier/customer snapshots, invoice_number, share_token,
-- and pdf_path columns — NONE of which are created here.
--
-- Isolation mirrors records / org_schemas / business_profiles: RLS enabled with
-- the single static membership policy backed by auth_org_ids(). `version` gives
-- optimistic concurrency; `actor_id` records the writer. A linked customer is a
-- LOOSE reference into records(id) with ON DELETE SET NULL (a soft/hard-deleted
-- record leaves the draft intact; the label resolves at read time, never stored).
-- ===========================================================================

create table public.invoices (
  id                       uuid        primary key default gen_random_uuid(),
  organization_id          uuid        not null references public.organizations (id) on delete cascade,

  -- Loose link to any tenant record (customer). Standalone drafts leave this null.
  -- ON DELETE SET NULL: deleting the linked record never deletes the invoice; the
  -- draft simply loses the reference. No snapshot is stored here (snapshots are 12.4).
  customer_record_id       uuid        references public.records (id) on delete set null,

  -- Place of supply (province) + language. Defaulted by the app from the Business
  -- Profile (12.1) with an ON fallback; both are editable text (never inferred from
  -- a linked record's JSONB).
  place_of_supply_province text,
  language                 text        not null default 'en'
                             check (language in ('en', 'fr')),

  -- Full status vocabulary defined now so 12.3-12.8 need no ALTER. Story 12.2 only
  -- ever writes 'draft'; the mutation layer + issuance gate (12.4) own transitions.
  status                   text        not null default 'draft'
                             check (status in ('draft', 'issued', 'paid', 'overdue', 'void')),

  -- Audit / concurrency.
  version                  integer     not null default 1,
  actor_id                 uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.invoices is
  'Story 12.2 — typed platform invoice parent row (NOT the JSONB records store). '
  'Drafting only here: status is always draft. Totals/snapshots/number/share_token/'
  'pdf_path columns are added by 12.3-12.5. customer_record_id is a LOOSE reference '
  'to records(id) (ON DELETE SET NULL); the customer label resolves at read time.';
comment on column public.invoices.customer_record_id is
  'Optional loose FK to records(id) (ON DELETE SET NULL). Null for a standalone '
  'draft. Stores only the id — never a snapshot (snapshots are Story 12.4).';
comment on column public.invoices.status is
  'Full lifecycle vocabulary defined now (draft|issued|paid|overdue|void); Story '
  '12.2 only ever writes draft. Transitions are owned by 12.4+.';
comment on column public.invoices.version is
  'Optimistic-concurrency version; bumped on every guarded draft save.';

-- The hot access pattern: an org's invoices, newest first (the list view).
create index invoices_org_created_idx
  on public.invoices (organization_id, created_at desc);

-- The single static membership policy — identical shape to records / org_schemas /
-- business_profiles. A member of the org may read + write their own invoices;
-- cross-tenant rows are invisible and unwritable.
alter table public.invoices enable row level security;

create policy "invoices_tenant_isolation" on public.invoices
  for all
  using      (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));
