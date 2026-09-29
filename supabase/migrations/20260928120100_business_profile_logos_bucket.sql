-- ===========================================================================
-- Story 12.1 — Private Storage bucket for Business Profile logos
--
-- Introduces Storage to the platform (reused by 12.5's PDF freeze later). The
-- bucket is PRIVATE: objects are never served from a public URL. The server
-- reads them back via a short-lived signed URL minted under the caller's
-- RLS-scoped client.
--
-- Object keys are laid out as `<organization_id>/<file>` so path_tokens[1] (the
-- first path segment; Postgres arrays are 1-indexed) is the owning org id. The
-- storage.objects RLS policies mirror the auth_org_ids() tenant pattern used by
-- records / org_schemas / business_profiles: a member may read/write/replace/
-- delete objects only under their own org's prefix. Uploads are performed by the
-- Admin-only logo route (content-type + size validated server-side before the
-- write); these policies are the DB backstop that also blocks cross-tenant reads.
-- ===========================================================================

-- Create the private bucket (idempotent). public = false → no public URLs.
insert into storage.buckets (id, name, public)
values ('business-logos', 'business-logos', false)
on conflict (id) do nothing;

-- SELECT: a member may read objects under their own org's prefix.
create policy "business_logos_member_read"
  on storage.objects
  for select
  using (
    bucket_id = 'business-logos'
    and (path_tokens[1])::uuid in (select public.auth_org_ids())
  );

-- INSERT: a member may upload objects under their own org's prefix.
create policy "business_logos_member_insert"
  on storage.objects
  for insert
  with check (
    bucket_id = 'business-logos'
    and (path_tokens[1])::uuid in (select public.auth_org_ids())
  );

-- UPDATE: a member may replace (upsert) objects under their own org's prefix.
create policy "business_logos_member_update"
  on storage.objects
  for update
  using (
    bucket_id = 'business-logos'
    and (path_tokens[1])::uuid in (select public.auth_org_ids())
  )
  with check (
    bucket_id = 'business-logos'
    and (path_tokens[1])::uuid in (select public.auth_org_ids())
  );

-- DELETE: a member may remove objects under their own org's prefix.
create policy "business_logos_member_delete"
  on storage.objects
  for delete
  using (
    bucket_id = 'business-logos'
    and (path_tokens[1])::uuid in (select public.auth_org_ids())
  );
