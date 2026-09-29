-- ===========================================================================
-- Story 12.5 — Private Storage bucket for frozen invoice PDFs (I5, FR89)
--
-- The rendered invoice PDF is frozen to this PRIVATE bucket right after the invoice
-- is issued. The bucket is private: objects are never served from a public URL; a
-- later story (12.6) proxies bytes server-side under RLS. Object keys are laid out
-- as `<organization_id>/<invoice_id>.pdf` so path_tokens[1] (the first path segment;
-- Postgres arrays are 1-indexed) is the owning org id.
--
-- The storage.objects RLS policies mirror the business-logos bucket
-- (20260928120100_business_profile_logos_bucket.sql): a member may read/write/replace/
-- delete objects only under their own org's prefix via auth_org_ids(). Uploads and
-- reads run under the ACTING user's RLS-scoped client (never the service-role key,
-- NFR-FC1); these policies are the DB backstop that also blocks cross-tenant reads.
--
-- Retention (FR89): the bucket has NO lifecycle/expiry rule, so the immutable invoice
-- rows plus their frozen PDFs satisfy the six-year statutory retention obligation.
-- (The offboarding hard-delete cascade must EXCLUDE these — recorded in deferred-work.)
-- ===========================================================================

-- Create the private bucket (idempotent). public = false → no public URLs.
insert into storage.buckets (id, name, public)
values ('invoice-pdfs', 'invoice-pdfs', false)
on conflict (id) do nothing;

-- SELECT: a member may read objects under their own org's prefix.
create policy "invoice_pdfs_member_read"
  on storage.objects
  for select
  using (
    bucket_id = 'invoice-pdfs'
    and (path_tokens[1])::uuid in (select public.auth_org_ids())
  );

-- INSERT: a member may upload objects under their own org's prefix.
create policy "invoice_pdfs_member_insert"
  on storage.objects
  for insert
  with check (
    bucket_id = 'invoice-pdfs'
    and (path_tokens[1])::uuid in (select public.auth_org_ids())
  );

-- UPDATE: a member may replace objects under their own org's prefix. (The app never
-- overwrites a frozen PDF — the immutability contract is enforced app-side — but the
-- policy mirrors the logos bucket for parity.)
create policy "invoice_pdfs_member_update"
  on storage.objects
  for update
  using (
    bucket_id = 'invoice-pdfs'
    and (path_tokens[1])::uuid in (select public.auth_org_ids())
  )
  with check (
    bucket_id = 'invoice-pdfs'
    and (path_tokens[1])::uuid in (select public.auth_org_ids())
  );

-- DELETE: a member may remove objects under their own org's prefix.
create policy "invoice_pdfs_member_delete"
  on storage.objects
  for delete
  using (
    bucket_id = 'invoice-pdfs'
    and (path_tokens[1])::uuid in (select public.auth_org_ids())
  );
