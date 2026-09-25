-- ===========================================================================
-- Story 1.2 — Platform Data Model & Tenant Isolation (Walking Skeleton)
--
-- Fixed platform schema for Scheza's shared-JSONB multi-tenant record store.
-- There is NO per-tenant physical table and NO runtime DDL: provisioning a
-- tenant "app" is a metadata insert (org_schemas) plus row inserts (records).
--
-- Isolation is a single static, membership-based RLS policy on the tenant-data
-- tables, backed by a SECURITY DEFINER `auth_org_ids()` resolver that reads
-- `org_members` by `auth.uid()`. `organization_id` is always a real FK to
-- `organizations.id` — never a user UID.
-- ===========================================================================

-- Required for gen_random_uuid().
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- organizations — the tenant identity every tenant row FKs to.
-- ---------------------------------------------------------------------------
create table public.organizations (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  slug        text        not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.organizations is
  'Tenant identity. Every tenant row references organizations.id (never a user UID).';

-- ---------------------------------------------------------------------------
-- org_members — membership rows resolving a principal (auth.uid()) to an org.
-- principal_type is the Phase-3 seam: a human today, a scoped agent identity
-- later. auth_org_ids() is principal-agnostic and reads this table.
-- ---------------------------------------------------------------------------
create table public.org_members (
  id               uuid        primary key default gen_random_uuid(),
  organization_id  uuid        not null references public.organizations (id) on delete cascade,
  user_id          uuid        not null,
  principal_type   text        not null default 'human'
                     check (principal_type in ('human', 'agent')),
  role             text        not null default 'member'
                     check (role in ('admin', 'member')),
  created_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);

comment on table public.org_members is
  'Resolves an authenticated principal (auth.uid()) to an organization. '
  'principal_type (human|agent) keeps the actor model principal-agnostic for Phase 3.';

create index org_members_user_id_idx on public.org_members (user_id);

-- ---------------------------------------------------------------------------
-- records — every tenant row across every logical table. A "table" is logical:
-- table_key + a field-definition row in org_schemas. `data` holds the row per
-- those definitions. Soft-delete via `deleted_at`; `version` gives optimistic
-- concurrency; `actor_id` records the last writer (human today, agent later).
-- ---------------------------------------------------------------------------
create table public.records (
  id               uuid        primary key default gen_random_uuid(),
  organization_id  uuid        not null references public.organizations (id) on delete cascade,
  table_key        text        not null,
  data             jsonb       not null default '{}'::jsonb,
  actor_id         uuid,
  idempotency_key  text,
  version          integer     not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

comment on table public.records is
  'Shared-JSONB tenant record store. One row per tenant record across all logical '
  'tables. NO per-tenant physical tables, NO runtime DDL.';
comment on column public.records.version is
  'Optimistic-concurrency version; incremented on every guarded update/delete.';
comment on column public.records.deleted_at is
  'Soft-delete marker. Non-null rows are retained but excluded from reads and the '
  'active-record billable count.';

-- GIN index over the JSONB payload for filter/sort (FR10) at scale.
create index records_data_gin_idx on public.records using gin (data);

-- Partial btree over the hot access pattern: an org's live rows for a table_key.
create index records_org_table_live_idx
  on public.records (organization_id, table_key)
  where deleted_at is null;

-- Idempotency: a given (org, table_key, idempotency_key) de-dupes an insert.
-- Partial unique so rows without a key are unconstrained.
create unique index records_idempotency_key_idx
  on public.records (organization_id, table_key, idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- org_schemas — authoritative logical schema per org: tables, fields, types,
-- per-table/field `reason` (FR46), and `hidden`/`sensitive` flags. The UI
-- renders from this. A field add/rename/hide is a metadata edit — no migration.
-- ---------------------------------------------------------------------------
create table public.org_schemas (
  organization_id  uuid        primary key references public.organizations (id) on delete cascade,
  definition       jsonb       not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.org_schemas is
  'Authoritative logical schema (tables/fields/types/reasons/flags) per org. '
  'Provisioning = insert here + seed records; never DDL.';

-- ---------------------------------------------------------------------------
-- auth_org_ids() — membership resolver. SECURITY DEFINER so it bypasses RLS on
-- org_members (no policy recursion) and is not re-evaluated per row as a
-- correlated subquery. STABLE for query-plan caching within a statement.
-- ---------------------------------------------------------------------------
create function public.auth_org_ids()
  returns setof uuid
  language sql
  security definer
  stable
  set search_path = public
as $$
  select organization_id from public.org_members where user_id = auth.uid()
$$;

comment on function public.auth_org_ids() is
  'Returns the org ids the current auth.uid() is a member of. SECURITY DEFINER so '
  'the membership read bypasses RLS (no recursion); principal-agnostic (Phase 3).';

-- ---------------------------------------------------------------------------
-- Row Level Security.
--
-- records + org_schemas: the single static membership policy (read + write).
-- organizations + org_members: RLS enabled with NO permissive policy —
--   deny-all to anon/authenticated. Reached only via the SECURITY DEFINER
--   resolver (definer rights bypass RLS) and the service_role admin client
--   (bypasses RLS). Per-user read policies are deferred to Epic 2 (auth).
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.org_members   enable row level security;
alter table public.records        enable row level security;
alter table public.org_schemas    enable row level security;

create policy "records_tenant_isolation" on public.records
  for all
  using      (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));

create policy "org_schemas_tenant_isolation" on public.org_schemas
  for all
  using      (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));

-- ---------------------------------------------------------------------------
-- Active-record billable unit (metering seam — baked in now, no later migration).
-- The billable unit is a non-deleted row, counted per org.
-- ---------------------------------------------------------------------------
create view public.org_active_record_counts as
  select
    organization_id,
    count(*)::bigint as active_record_count
  from public.records
  where deleted_at is null
  group by organization_id;

comment on view public.org_active_record_counts is
  'Billable unit: the count of non-deleted (active) records per organization. '
  'The metered usage source; defined in the model now so metering needs no migration.';
