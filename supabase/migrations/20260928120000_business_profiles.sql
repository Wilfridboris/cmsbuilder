-- ===========================================================================
-- Story 12.1 — Business Profile: Capture Company Identity Once
--
-- A typed, singleton-per-org platform table holding the owner's legal identity,
-- tax registration, addresses, default terms/language, and a structured payment
-- instructions block. This is NOT the JSONB records store: invoicing (Epic 12)
-- is the one fixed, compliant module and lives in dedicated typed columns so a
-- later taxed-invoice render (12.5) can snapshot legal name + operating name +
-- the GST/HST number authoritatively.
--
-- Identity capture only: this table stores what later stories render and
-- snapshot; it does not issue, number, render, compute HST, or validate an
-- invoice (those are 12.2-12.8). No invoice tables are created here.
--
-- Isolation mirrors records / org_schemas: RLS enabled with the single static
-- membership policy backed by auth_org_ids(). One row per org (UNIQUE on the
-- organization_id primary key); save is an upsert (last-write-wins). Constrained
-- fields use text + CHECK (never Postgres enums) so a new entity type / language
-- is a data change, not a migration.
-- ===========================================================================

create table public.business_profiles (
  organization_id           uuid        primary key references public.organizations (id) on delete cascade,

  -- Identity (legal name is the only required field; the app enforces it too).
  legal_name                text        not null,
  operating_name            text,
  entity_type               text
                              check (entity_type is null or entity_type in
                                ('sole_proprietor', 'partnership', 'corporation', 'nonprofit', 'other')),
  jurisdiction              text,

  -- GST/HST registration. Number and effective date are a pair: both present
  -- (registered) or both null (unregistered). The app enforces the pairing
  -- (BusinessProfile.error.registrationPairRequired); this CHECK is the DB backstop.
  gst_hst_number            text,
  gst_hst_effective_date    date,
  constraint business_profiles_registration_pair
    check ((gst_hst_number is null) = (gst_hst_effective_date is null)),

  -- Logo: bucket-relative object key in the private logos bucket, or null.
  logo_path                 text,

  -- Business + mailing addresses (single free-text blocks; the render decides layout).
  business_address          text,
  mailing_address           text,

  -- Defaults carried onto invoices later.
  default_payment_terms     text,
  default_language          text        not null default 'en'
                              check (default_language in ('en', 'fr')),

  -- Structured Payment Instructions block (shown on every viewed/delivered invoice).
  payment_etransfer_email   text,
  payment_cheque_payable_to text,
  payment_cheque_address    text,
  payment_card_link         text,

  -- Audit / concurrency.
  actor_id                  uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.business_profiles is
  'Story 12.1 — singleton-per-org company identity + payment details for invoicing. '
  'Typed platform table (NOT the JSONB records store); one row per org keyed by '
  'organization_id. Identity capture only — does not issue/render/validate invoices.';
comment on column public.business_profiles.logo_path is
  'Bucket-relative object key in the private business-logos bucket; read back via a '
  'short-lived signed URL. Null when no logo uploaded.';
comment on column public.business_profiles.gst_hst_number is
  'Paired with gst_hst_effective_date: both present (registered) or both null.';

-- The single static membership policy — identical shape to records / org_schemas.
-- A member of the org may read + upsert their own row; cross-tenant rows are
-- invisible and unwritable.
alter table public.business_profiles enable row level security;

create policy "business_profiles_tenant_isolation" on public.business_profiles
  for all
  using      (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));
