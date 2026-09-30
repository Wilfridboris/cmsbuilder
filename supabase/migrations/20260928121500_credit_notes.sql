-- ===========================================================================
-- Story 12.8 — Credit Notes: correct an issued invoice via a linked credit note
--
-- The typed platform `credit_notes` table: the parent row of a credit note. It
-- MIRRORS `invoices` (20260928120200) column-for-column, minus `due_date` (a credit
-- note has no due date) and plus two credit-note-specific columns:
--   * invoice_id — a NOT NULL FK to the invoice being corrected (ON DELETE RESTRICT
--     so the source invoice cannot be deleted while a credit note references it —
--     invoices are immutable/retained anyway, but this makes the link permanent);
--   * original_invoice_number — the source invoice's frozen number, captured at issue
--     so the PDF shows which invoice it corrects without a live join into invoices
--     after issue (snapshot authority, I6). invoice_id remains the navigational FK.
--
-- Numbering (I1): credit_note_number is a per-org sequence in a namespace DISJOINT
-- from invoice numbers, allocated by the locked-row increment pattern inside the
-- issue transaction (issue_credit_note). Never max()+1; a void leaves a permanent gap.
--
-- Isolation mirrors every invoicing table: RLS enabled with the single static
-- membership policy backed by auth_org_ids(). Story 12.8 writes 'draft' on create;
-- issue_credit_note flips it to 'issued' and freezes number/snapshots/token/pdf_path.
-- A credit note is itself immutable once issued (immutability triggers, I7 analog).
-- The original invoice is NEVER written by any credit-note path (FR88).
-- ===========================================================================

create table public.credit_notes (
  id                       uuid        primary key default gen_random_uuid(),
  organization_id          uuid        not null references public.organizations (id) on delete cascade,

  -- The invoice this credit note corrects. NOT NULL (a credit note always references
  -- a source invoice) with ON DELETE RESTRICT so the source cannot be removed while
  -- referenced. This is the navigational FK; original_invoice_number (frozen at issue)
  -- is the render source (I6).
  invoice_id               uuid        not null references public.invoices (id) on delete restrict,

  -- The source invoice's number, frozen onto the credit note at issue so the PDF and
  -- all rendering read it without a live join into invoices after issue (I6). Null on
  -- a draft; set in the issue transaction.
  original_invoice_number  bigint,

  -- Loose link to the same tenant record (customer) the source invoice referenced.
  -- Copied from the source at draft-create; ON DELETE SET NULL like invoices.
  customer_record_id       uuid        references public.records (id) on delete set null,

  -- Place of supply (province) + language, mirroring invoices.
  place_of_supply_province text,
  language                 text        not null default 'en'
                             check (language in ('en', 'fr')),

  -- Full status vocabulary. A credit note is draft|issued|void (no paid/overdue — it
  -- is a correction document, not a receivable). Story 12.8 writes 'draft' on create;
  -- issue_credit_note flips it to 'issued'; a void leaves a permanent number gap.
  status                   text        not null default 'draft'
                             check (status in ('draft', 'issued', 'void')),

  -- Money totals (mirrors invoices, I2). Line amounts are entered/stored as POSITIVE
  -- values; the document title ("Credit Note") + its reference to the original invoice
  -- carry the "reduction" meaning. Written ONLY from computeInvoiceTotals output.
  subtotal                 numeric     not null default 0,
  tax_total                numeric     not null default 0,
  total                    numeric     not null default 0,

  -- Issue-time frozen columns (mirrors invoices, I1/I4/I6). All null until issued.
  credit_note_number       bigint,
  issue_date               date,
  supplier_snapshot        jsonb,
  customer_snapshot        jsonb,
  share_token              text,
  -- The bucket-relative object key of the frozen credit-note PDF in the private
  -- invoice-pdfs bucket ({org}/credit-notes/{id}.pdf, I8). Null until the post-issue
  -- freeze commits; the immutability trigger permits one null->value write.
  pdf_path                 text,

  -- Audit / concurrency.
  version                  integer     not null default 1,
  actor_id                 uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.credit_notes is
  'Story 12.8 — typed platform credit-note parent row (NOT the JSONB records store). '
  'Mirrors invoices minus due_date, plus invoice_id (NOT NULL FK -> invoices ON DELETE '
  'RESTRICT) and original_invoice_number (frozen at issue). credit_note_number is a '
  'per-org sequence in a namespace disjoint from invoice numbers (I1). Immutable once '
  'issued; the original invoice is never written by any credit-note path (FR88).';
comment on column public.credit_notes.invoice_id is
  'The source invoice this credit note corrects. NOT NULL FK -> invoices(id) ON DELETE '
  'RESTRICT (navigational). original_invoice_number is the frozen render source (I6).';
comment on column public.credit_notes.credit_note_number is
  'Gap-free per-org credit-note number (I1), disjoint from invoice numbers. Allocated '
  'from credit_note_number_counters inside the issue transaction (never max()+1).';

-- The hot access patterns: an org's credit notes newest first, and a source
-- invoice's linked credit notes.
create index credit_notes_org_created_idx
  on public.credit_notes (organization_id, created_at desc);
create index credit_notes_invoice_idx
  on public.credit_notes (invoice_id);

-- A credit-note number is unique per org (partial: only issued rows carry one).
create unique index credit_notes_org_number_uidx
  on public.credit_notes (organization_id, credit_note_number)
  where credit_note_number is not null;

-- The share token is globally unique when present (partial), mirroring invoices.
create unique index credit_notes_share_token_uidx
  on public.credit_notes (share_token)
  where share_token is not null;

-- The single static membership policy — identical shape to invoices_tenant_isolation.
alter table public.credit_notes enable row level security;

create policy "credit_notes_tenant_isolation" on public.credit_notes
  for all
  using      (organization_id in (select public.auth_org_ids()))
  with check (organization_id in (select public.auth_org_ids()));
