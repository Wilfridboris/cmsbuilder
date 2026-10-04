-- ===========================================================================
-- Epic 14 — Forms: owner-managed multi-form intake (schema created once here).
--
-- Story 14.1 is the walking skeleton: this migration creates the WHOLE Epic-14
-- `forms` schema in a single pass (every column 14.2-14.6 will need — `published`,
-- `intro_text`, `field_config`), so later stories need no follow-up migration.
-- Story 14.1 wires only `title` / `slug` / `target_table_key`; the later columns
-- simply stay at their defaults (`published=false`, `intro_text=null`,
-- `field_config='[]'`).
--
-- An org-scoped platform table (NOT the JSONB records store): a form is a typed
-- row owned by exactly one org. Isolation mirrors `business_profiles` /
-- `org_schemas`: RLS enabled with the single static membership policy backed by
-- `auth_org_ids()`. Slug is kebab-cased from the title and UNIQUE within the org;
-- the UNIQUE (organization_id, slug) constraint is the authoritative backstop the
-- app's suffixing retries against on a 23505 collision.
-- ===========================================================================

create table public.forms (
  id                uuid        primary key default gen_random_uuid(),
  organization_id   uuid        not null references public.organizations (id) on delete cascade,

  -- Owner-facing name (required; the app also enforces a non-blank title).
  title             text        not null,

  -- Kebab-case, org-unique public URL segment (14.2 serves the per-form route).
  slug              text        not null,

  -- The logical `records` table_key this form collects into. Pre-filled at create
  -- time by the intake-term heuristic (`selectIntakeTable`); nullable because an org
  -- with no visible tables has nothing to collect yet. Authoritative owner
  -- reassignment is Story 14.4; 14.1 shows it read-only.
  target_table_key  text,

  -- Publish state (Story 14.3). Created unpublished; 14.1 never flips it.
  published         boolean     not null default false,

  -- Optional owner intro copy shown above the public form (Story 14.2+).
  intro_text        text,

  -- Per-form field customization (Story 14.4+): an ordered JSONB list. Defaults to
  -- an empty array; 14.1 never populates it.
  field_config      jsonb       not null default '[]'::jsonb,

  -- Audit.
  actor_id          uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Slug is unique PER ORG (two different orgs may each own a `job-request`).
  unique (organization_id, slug)
);

-- Scope-by-org lookups (list a tenant's forms, resolve a form within an org).
create index forms_organization_id_idx on public.forms (organization_id);

comment on table public.forms is
  'Epic 14 — owner-managed intake forms. Org-scoped typed platform table (NOT the '
  'JSONB records store); every row belongs to one org via organization_id. Story 14.1 '
  'wires title/slug/target_table_key; published/intro_text/field_config are created '
  'here for 14.2-14.6 and left at defaults.';
comment on column public.forms.slug is
  'Kebab-case, UNIQUE (organization_id, slug). The DB UNIQUE is the backstop; the app '
  'resolves collisions with a -2/-3 suffix and retries on a 23505 violation.';
comment on column public.forms.target_table_key is
  'The logical records table_key this form collects into; pre-filled by the intake '
  'heuristic at create, null when the org has no visible tables. Reassignment is 14.4.';

-- The single static membership policy — identical shape to business_profiles /
-- org_schemas. A member of the org may read + write their own org's form rows;
-- cross-tenant rows are invisible and unwritable.
alter table public.forms enable row level security;

create policy "forms_tenant_isolation" on public.forms
  for all
  using      (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));
