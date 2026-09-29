-- ===========================================================================
-- Story 12.4 — Issue an Invoice: new frozen-identity columns on `invoices`
--
-- Issuing an invoice (12.4) mints a gap-free per-org number, freezes the supplier
-- and customer identity onto the row, records the server-authoritative issue date,
-- and mints a one-time share token. This migration adds the columns those artifacts
-- live in. All are NULLABLE so existing 12.2/12.3 drafts read null until issued —
-- they are populated only inside the `issue_invoice` transaction (12.4).
--
-- I1 (numbering): `invoice_number` is a stored per-org integer, unique per org while
-- not null. It is allocated from a locked counter row (see the counters migration),
-- never max()+1; a later void leaves a permanent gap. Display width is a helper
-- concern (formatInvoiceNumber, 6-digit zero-pad) — the integer is authoritative.
--
-- I4 (share_token): a 128-bit base62url token minted ONCE at issue, unique while not
-- null, never rotated. No public route or PDF is built here (12.5/12.6).
--
-- I6 (snapshots): `supplier_snapshot`/`customer_snapshot` (jsonb) freeze the full
-- Business Profile identity + the linked customer record at issue; after issue all
-- rendering reads from the snapshots, never the live records.
--
-- Note for 12.5: it will ADD `pdf_path` and relax the immutability trigger to permit
-- a one-time null→value write of `pdf_path` on an issued invoice. This story does not
-- add `pdf_path`.
-- ===========================================================================

alter table public.invoices
  add column if not exists invoice_number   bigint,
  add column if not exists issue_date       date,
  add column if not exists supplier_snapshot jsonb,
  add column if not exists customer_snapshot jsonb,
  add column if not exists share_token      text;

comment on column public.invoices.invoice_number is
  'Story 12.4 — gap-free per-org invoice number (I1), allocated from '
  'invoice_number_counters inside the issue transaction (never max()+1). Null until '
  'issued; unique per org while not null. Display width is formatInvoiceNumber only.';
comment on column public.invoices.issue_date is
  'Story 12.4 — server-authoritative issue date (TODAY at issue, never client-supplied). '
  'Null until issued.';
comment on column public.invoices.supplier_snapshot is
  'Story 12.4 (I6) — frozen Business Profile identity + payment instructions at issue. '
  'After issue all rendering reads from here, not the live business_profiles row.';
comment on column public.invoices.customer_snapshot is
  'Story 12.4 (I6) — frozen linked-customer record { record_id, table_key, '
  'display_label, data } at issue, or null for a standalone invoice. '
  'customer_record_id is a back-reference only after issue.';
comment on column public.invoices.share_token is
  'Story 12.4 (I4) — 128-bit base62url token minted once at issue, never rotated. '
  'Null until issued; unique while not null. No public route/PDF built here.';

-- Gap-free per-org numbering: unique per org while assigned. A void leaves the row's
-- number in place (a permanent gap), so the partial-unique index never blocks reuse
-- because numbers are never reused.
create unique index if not exists invoices_org_number_unique
  on public.invoices (organization_id, invoice_number)
  where invoice_number is not null;

-- The share token is globally unique + non-enumerable (I4). Partial so the many
-- null-token drafts do not collide.
create unique index if not exists invoices_share_token_unique
  on public.invoices (share_token)
  where share_token is not null;
