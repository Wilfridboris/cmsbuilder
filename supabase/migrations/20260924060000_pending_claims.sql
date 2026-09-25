-- ===========================================================================
-- Story 2.1 — Claim App via Magic Link ("Make it Real")
--
-- pending_claims carries the durable, device-independent finalize data for a
-- passwordless magic-link claim. The claim POST (pre-auth) persists the
-- visitor's overridden schema straight into org_schemas.definition and inserts
-- a pending_claims row keyed by a random token. That token is embedded in the
-- magic link's emailRedirectTo. On callback, finalize resolves the row by token
-- alone (no session cookie / React state required), then promotes the session
-- org in place: adds an admin membership, sets a real slug, and clears the
-- synthetic demo records.
--
-- RLS is enabled with NO policy: this table is reached ONLY by the service-role
-- admin client during the narrow claim-time bootstrap (deny-all to anon /
-- authenticated), matching the organizations / org_members deny-all pattern in
-- 20260924055022_platform_schema.sql.
-- ===========================================================================

create table public.pending_claims (
  id                    uuid        primary key default gen_random_uuid(),
  token                 text        not null unique,
  email                 text        not null,
  session_org_id        uuid        not null references public.organizations (id) on delete cascade,
  consent_accepted_at   timestamptz not null,
  policy_version        text        not null,
  -- Auto-derived base slug (trade + city) captured at claim time; uniqueness is
  -- resolved against organizations.slug at finalize, keeping the org's slug
  -- untouched until the user authenticates.
  slug_base             text        not null,
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  -- Null until finalize consumes the token; set on first (idempotent) finalize
  -- so a second callback with the same token is a no-op rather than a
  -- double-bootstrap.
  consumed_at           timestamptz
);

comment on table public.pending_claims is
  'Durable, device-independent finalize data for a magic-link claim (Story 2.1). '
  'Resolved by token on the auth callback. Service-role only (RLS deny-all).';
comment on column public.pending_claims.token is
  'Random opaque token embedded in the magic link''s emailRedirectTo; resolves the claim on callback.';
comment on column public.pending_claims.consumed_at is
  'Set on the first finalize so re-entry with the same token is an idempotent no-op.';

-- Token is the sole lookup key on the callback path.
create index pending_claims_token_idx on public.pending_claims (token);

-- Deny-all: reached only via the service-role admin client (bypasses RLS).
alter table public.pending_claims enable row level security;
