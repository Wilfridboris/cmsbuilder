# Epic 12 Context: Invoicing, Payments & Delivery

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Turn finished work into money. Invoicing is the one fixed, compliant module in an otherwise AI-generated product: it lives in dedicated typed platform tables (not the JSONB record store) so it can guarantee correct Ontario HST, mandatory legal identity, gap-free per-org numbering, and true immutability. An owner captures a Business Profile once, drafts an invoice from a work record or standalone, computes HST as a separate line, issues it through a validation gate that mints a gap-free number and freezes an in-house-rendered PDF to private storage, delivers it PDF-first from the owner's own phone or inbox, tracks payment out-of-band, and corrects only via credit notes. This is the product's revenue heart. It depends only on Epics 1-3 (the records/org_schemas model, the guarded mutation layer, real claimed accounts) plus Resend, and is sequenced in build order right after Epic 4 despite its number.

## Stories

- Story 12.1: Business Profile — Capture Company Identity Once
- Story 12.2: Draft an Invoice (from a Work Record or Standalone)
- Story 12.3: Totals & Ontario HST (Place of Supply)
- Story 12.4: Issue an Invoice — Validate, Number, Freeze Identity, Lock
- Story 12.5: Render & Freeze the Invoice PDF
- Story 12.6: Deliver the Invoice (Owner's Own Channels)
- Story 12.7: Track Payment Out-of-Band (No Processing)
- Story 12.8: Correct an Issued Invoice via Credit Note

## Requirements & Constraints

- Every invoice that charges tax must show the supplier's legal name together with the operating name and the GST/HST registration number.
- HST applies only when the business is GST/HST-registered and the registration effective date is on or before the invoice issue date; otherwise no tax is labelled or calculated.
- Issuing is a deliberate, validated, irreversible step. A compliance gate blocks issuance with a plain-language reason when legal identity is missing, tax is charged without a valid registration, HST is split into components, or totals do not reconcile.
- Once issued, an invoice is immutable and can be corrected only via a linked credit note. Payment is tracked out-of-band; Scheza never processes or holds money.
- Structured invoice data and every rendered PDF must be retained for at least six years. This statutory retention overrides the 30-day PIPEDA offboarding cascade: invoices, credit notes, payments, and their frozen PDFs are excluded from the offboarding hard-delete while under legal retention.
- All invoice emails must be strictly transactional (CASL) with no marketing content on the send path.
- Hard release gate: an Ontario lawyer and a CPA must review invoice templates, HST logic, and terms before invoicing is enabled in production. Product copy must never claim every invoice is legally compliant, only that it carries the configured compliance information.
- Non-functional: guarded writes only, TLS plus at-rest encryption on the public PDF surface, and an accessible invoice UI.

## Technical Decisions

Dedicated typed platform tables (not the JSONB records store), all with RLS via the same membership resolver as `records` and all writes through the guarded `mutate.ts` layer (identity passed explicitly, `actor_id` recorded):

- `business_profiles` (keyed by `organization_id`): legal/operating name, entity type, jurisdiction, GST/HST number and effective date, logo, addresses, payment terms, default language, and a structured `payment_instructions` block (e-transfer email, cheque payable-to + mailing address, optional owner card link). Identity capture only — one clean template renders from it, not a template designer.
- `invoices`: status (`draft`/`issued`/`paid`/`overdue`/`void`), nullable loose `customer_record_id` FK into `records`, `supplier_snapshot`/`customer_snapshot` (jsonb), `place_of_supply_province`, language, money columns, `pdf_path`, `share_token`, timestamps.
- `invoice_line_items` (description, quantity, unit_price, amount, sort_order), `invoice_tax_lines` (label, rate, base, tax amount).
- `credit_notes` + `credit_note_line_items` + `credit_note_tax_lines` (same child-table shape as invoices).
- `invoice_payments` (method, paid_date, amount, reference) — freely mutable even though the parent invoice is immutable.

Binding consistency invariants (fixed contracts so independently-built units cannot diverge):

- I1 Numbering: `invoice_number` and `credit_note_number` are each a per-org sequence allocated inside the same transaction that flips status to `issued` — never a read-then-write `max()+1`. Two independent per-org namespaces. One documented zero-padded, no-prefix format. Numbers are never reused; a void leaves a permanent gap (an audit property).
- I2 Totals computed once, then stored: `lib/invoicing/tax.ts` owns the single canonical computation — line `amount = round(quantity × unit_price, 2)`, `subtotal = Σ amounts`, `total = subtotal + tax_total`. The stored columns are written only from that function's output, and the issuance gate calls the same function to verify equality — never a second implementation.
- I3 HST + registration date: HST = `round(subtotal × rate, 2)`, computed once on the subtotal (not per line), shown as one separate line, never split into federal/provincial. Registration validity is the single predicate `gst_hst_effective_date <= issue_date` in one shared helper imported by both `tax.ts` and `validate.ts`.
- I4 share_token: 128-bit base62url, fixed alphabet/length, minted once at issue and never rotated on re-send. `GET /i/[token]` returns 404/410 once the invoice is void.
- I5 Storage: one private Supabase Storage bucket; `pdf_path` holds the bucket-relative object key. `/i/[token]` is a server proxy that reads bytes server-side and streams them — never a redirect to a signed storage URL (so revocation-on-void and non-enumerability are actually enforced).
- I6 Snapshot authority: after issue, the PDF and all rendering read exclusively from `supplier_snapshot`/`customer_snapshot`; `customer_record_id` is a navigation back-reference only, never a render source. Snapshots are populated in the issue transaction, not at draft creation.
- I7 Immutability trigger is a status-transition whitelist (not a blanket freeze): permits only `issued→paid`, `issued→void`, `issued/paid→overdue`, freezing every other column of issued/paid/void invoices and blocking INSERT/UPDATE/DELETE on line/tax child rows of such invoices. `invoice_payments` stays freely mutable.
- I8 One render path: `lib/invoicing/pdf.tsx` renders invoices and credit notes from one structure (credit notes reuse the invoice child-table shape).

Other conventions: build in-house (not Stripe Invoicing/Tax) — the supplier must be the owner's legal identity, not Scheza's account, and MVP payments are out-of-band. Code lives under `src/lib/invoicing/` (`tax.ts`, `validate.ts` with `assertIssuable`, numbering, `pdf.tsx`, storage), `src/app/api/invoices/`, `src/app/api/business-profile/`, `src/app/i/[token]/`, `src/app/invoices/`, and `src/components/invoices/`. `assertIssuable` is a synchronous mutation-layer gate mirroring the existing Schema Validator pattern. The public `/i/[token]` route parallels the existing public intake-form path — the second and last unauthenticated surface, deliberately narrow.

## UX & Interaction Patterns

- Delivery is PDF-first from the owner's own channels. On mobile, the native Web Share sheet sends the frozen PDF through the owner's own WhatsApp / Messages / email — no WhatsApp Business API, no cost, no customer login. SMS cannot attach a PDF, so it carries the unguessable `/i/[token]` link to the same PDF.
- On desktop, Scheza emails the invoice with the PDF attached via Resend with reply-to the owner's address, and also offers Download PDF and Copy Link.
- The Invoices tab defaults to an Unpaid / Overdue view derived from `status` + `due_date`, working uniformly across every tenant regardless of generated schema.
- Every viewed or delivered invoice carries the structured Payment Instructions block (e-transfer, cheque, optional owner card link).

## Cross-Story Dependencies

- Depends only on Epics 1-3 (records/org_schemas model, guarded `mutate.ts`, claimed accounts) and the Resend integration — never on Epics 5-11.
- Within the epic: 12.1 (Business Profile) feeds identity/payment data into drafting (12.2), tax registration into HST (12.3), the issuance gate (12.4), and payment instructions (12.7). Drafting (12.2) → totals/HST (12.3) → issue/number/snapshot/lock (12.4) → PDF render/freeze (12.5) → delivery (12.6) form the core pipeline. 12.5's PDF render path and share_token underpin delivery (12.6). Credit notes (12.8) reuse 12.5's single render path (I8) and 12.4's numbering pattern (I1).
- The province/language seam is stored now (Ontario/English is the only active path in MVP) so a Quebec invoice can be enabled later with no re-architecture.
- Payment processing (Stripe Connect), Interac auto-reconcile, WhatsApp Business API, and owner-inbox integration are explicitly Phase 3 and out of scope here.
