---
title: 'Story 12.4: Issue an Invoice — Validate, Number, Freeze Identity, Lock'
type: 'feature'
created: '2026-09-29'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '25128f04d48f74452dd2090e53a87f6a276f7962'
context:
  - '_bmad-output/implementation-artifacts/epic-12-context.md'
  - '_bmad-output/implementation-artifacts/spec-12-3-totals-ontario-hst-place-of-supply.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A draft invoice (Stories 12.2/12.3) can be edited freely and has no number, no frozen identity, and no protection against later change. Issuing must be a deliberate, validated, irreversible step: it must block non-compliant invoices with a plain-language reason, mint a gap-free per-org number, freeze supplier and customer identity onto the row, and make the invoice permanently immutable (correctable only by a future credit note).

**Approach:** Add a synchronous `assertIssuable` gate (`src/lib/invoicing/validate.ts`, mirroring the Schema Validator pattern) that reuses the canonical `computeInvoiceTotals`/`isRegistrationEffective` (I2/I3) to verify compliance before any write. A new `issue_invoice` SECURITY INVOKER RPC then, in one transaction, allocates the next per-org number from a locked counter row (I1), freezes `supplier_snapshot`/`customer_snapshot` and `issue_date`, mints the `share_token` (I4), and flips `status` to `issued`. A Postgres immutability trigger (I7) permits only the whitelisted status transitions thereafter and freezes every other column plus the child line/tax rows. The `POST /api/invoices/[id]/issue` route and an Admin "Issue invoice" action + read-only issued view (per `/web-uiux-architect`) drive it.

## Boundaries & Constraints

**Always:**
- `assertIssuable(...)` is a synchronous `server-only` gate that runs BEFORE the RPC and, on any failure, throws `AppError` with a specific translated `Invoice.error.*` code (a plain-language reason, FR87). It blocks when: (a) no Business Profile or no `legal_name` → `legalIdentityMissing`; (b) a tax line is present but the business lacks a `gst_hst_number` or the registration is not effective as of the issue date (shared `isRegistrationEffective(gst_hst_effective_date, issue_date)`, I3) → `taxWithoutRegistration`; (c) more than one tax line, or a tax line split into components → `taxSplit`; (d) the STORED `subtotal`/`tax_total`/`total` and each line `amount` do not equal a fresh `computeInvoiceTotals`/`computeLineAmount` recomputation against the real `issue_date` (I2) → `totalsMismatch`; (e) zero line items → `lineItemsRequired`. It never rewrites stored figures — it verifies equality and blocks on mismatch. It reports each rejection through the existing observability seam like `validateGeneratedSchema`.
- `issue_date` is server-authoritative: the route computes TODAY (`YYYY-MM-DD`); it is never client-supplied (no back/forward dating). Because a draft's totals were last saved against the same provisional TODAY (12.3), a freshly-saved draft always reconciles; a draft last saved on a prior day across a registration-effective boundary blocks with `totalsMismatch` and the Admin re-saves then re-issues.
- Numbering (I1): a new per-org counter table `invoice_number_counters(organization_id pk, next_number bigint not null default 1, ...)` with the same RLS `..._tenant_isolation` `auth_org_ids()` policy. The `issue_invoice` RPC allocates gap-free INSIDE the issue transaction by ensuring the row exists (`insert ... on conflict do nothing`) then `update ... set next_number = next_number + 1 ... returning next_number - 1` (a row-lock serialization, never a `max()+1`). `invoices.invoice_number` is a stored integer, unique per org (`unique (organization_id, invoice_number)` partial where not null), starting at 1. Display format is one documented helper `formatInvoiceNumber(n)` = 6-digit zero-padded, no prefix (e.g. `000001`); the integer is authoritative, the width is display-only. Numbers are never reused; a later void leaves a permanent gap.
- The `issue_invoice` RPC is SECURITY INVOKER (like `save_invoice_draft`), runs entirely under the caller's RLS, gates on `p_expected_version` AND `status = 'draft'` AND `organization_id = p_org`, and on a 0-row match raises `invoice_issue_conflict` (SQLSTATE `P0001`, matched by message marker → 409 `versionConflict`; never a retryable 40001). In one transaction it sets `status='issued'`, `invoice_number`, `issue_date`, `supplier_snapshot`, `customer_snapshot`, `share_token`, bumps `version`, records `actor_id`. It does NOT touch child line/tax rows (already stored and verified equal).
- Snapshots (I6, frozen in the issue transaction, not at draft creation): `supplier_snapshot` (jsonb) captures the full Business Profile identity + payment instructions (`legal_name`, `operating_name`, `entity_type`, `jurisdiction`, `gst_hst_number`, `gst_hst_effective_date`, `logo_path`, `business_address`, `mailing_address`, `default_payment_terms`, `payment_*`, language). `customer_snapshot` (jsonb, nullable) captures the linked record's `{ record_id, table_key, display_label, data }` when a customer is linked; a standalone invoice (no `customer_record_id`) freezes `null`. After issue, all rendering reads exclusively from the snapshots; `customer_record_id` is a back-reference only.
- `share_token` (I4): a 128-bit base62url token (fixed alphabet + length), minted ONCE in the issue transaction, unique (`unique` partial index), never rotated. Generated server-side and passed to the RPC. No public route or PDF is built here.
- Immutability trigger (I7): `enforce_invoice_immutability` (BEFORE UPDATE OR DELETE on `invoices`) allows all changes and delete while `OLD.status = 'draft'` (drafts stay mutable/discardable, including the draft→issued flip); once `OLD.status` is non-draft it blocks DELETE, permits ONLY the status transitions `issued→paid`, `issued→void`, `issued→overdue`, `paid→overdue` (with `version`/`updated_at`/`actor_id` allowed to change alongside), and raises `invoice_immutable` (P0001) if any other column changes or `invoice_status_transition` on a non-whitelisted status change. `enforce_invoice_child_immutability` (BEFORE INSERT OR UPDATE OR DELETE on `invoice_line_items` and `invoice_tax_lines`) blocks the write when the parent invoice's status is non-draft, allowing it when the parent is draft or already gone (cascade delete of a draft).
- New `invoices` columns are all nullable (existing 12.2/12.3 drafts read null until issued): `invoice_number bigint`, `issue_date date`, `supplier_snapshot jsonb`, `customer_snapshot jsonb`, `share_token text`.
- The issue endpoint reuses the exact auth chain of the existing invoice routes (`requireUser` → `resolveOrgIdentity` → `requireAdmin` + slug match) and the `AppError`/`handleError` envelope. The UI (Issue action, confirm dialog, blocking-reason display, read-only issued view) is built per the `/web-uiux-architect` skill, reusing `src/components/ui` primitives; all copy via next-intl (en + fr, real French, no em-dashes); a11y baseline (labeled, keyboard, ≥48px targets, WCAG AA, reduced-motion).

**Never:**
- Never allocate a number with `max()+1` or read-then-write; never reuse a number or backfill a void's gap; never mint more than one `share_token` or rotate it.
- Never let `assertIssuable` or the RPC rewrite the stored totals/tax lines at issue — it verifies equality (I2) and blocks on mismatch.
- Never render or freeze a PDF, add `pdf_path`, build the public `/i/[token]` route, deliver the invoice, track payments, or create a credit note (Stories 12.5–12.8). Note for 12.5: it will add `pdf_path` and ALTER `enforce_invoice_immutability` to permit a one-time `null→value` write of `pdf_path` on an issued invoice.
- Never use the service-role client for invoice data; never leak raw SQL/stack to the client.
- Never require a customer to issue (standalone invoices are valid, per 12.2); never edit or discard a non-draft invoice.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Issue a valid draft | Draft with lines, registered ON supplier, stored totals reconcile | `assertIssuable` passes; RPC allocates next number, freezes snapshots + `issue_date` + `share_token`, sets `status='issued'`, bumps version | N/A |
| Gap-free numbering | Two drafts issued in the same org | First gets N, second N+1; a later void of N leaves a permanent gap (never reissued) | N/A |
| Missing legal identity | No Business Profile, or `legal_name` blank | Blocked; nothing written | `Invoice.error.legalIdentityMissing` (422) |
| Tax without valid registration | Draft has an HST line but no `gst_hst_number`, or effective date after issue date | Blocked | `Invoice.error.taxWithoutRegistration` (422) |
| Split tax | More than one tax line on the draft | Blocked | `Invoice.error.taxSplit` (422) |
| Totals drifted | Stored subtotal/tax/total ≠ fresh recomputation | Blocked; Admin re-saves and re-issues | `Invoice.error.totalsMismatch` (422) |
| Standalone invoice | Valid draft, no `customer_record_id` | Issues; `customer_snapshot` frozen as null | N/A |
| Stale / non-draft issue | Wrong `version`, or the row is already issued | Rejected; nothing written | `versionConflict` (409) / `notDraft` (409) |
| Mutate issued invoice | Any UPDATE of a frozen column, DELETE, or child row change on a non-draft invoice | Rejected by the trigger | `invoice_immutable` / `invoice_status_transition` (P0001) |
| Whitelisted transition | `issued→paid`, `issued→void`, `issued→overdue`, `paid→overdue` | Allowed (status + version/updated_at/actor_id only) | N/A |
| Non-Admin / no session | Member or anon on `/api/invoices/[id]/issue` | Rejected before access | `forbidden` (403) / `unauthorized` (401) |

</frozen-after-approval>

## Code Map

- `src/lib/invoicing/validate.ts` -- NEW. `server-only`. `assertIssuable(input)` synchronous gate mirroring `src/lib/schema/validator.ts` (throws + reports rejections via the observability seam). Imports `computeInvoiceTotals`, `computeLineAmount`, `isRegistrationEffective` from `tax.ts` (I2/I3 — no second implementation). Also `formatInvoiceNumber(n)` helper (6-digit zero-pad) OR put it in `tax.ts`; keep numbering-format with numbering. Input: the stored invoice row + line items + tax lines + business profile + issue date.
- `src/lib/invoicing/tax.ts` -- REUSE only (`computeInvoiceTotals`, `computeLineAmount`, `isRegistrationEffective`, `normalizeProvince`, `PROVINCE_TAX`). Do not modify.
- `src/lib/schema/validator.ts` -- REFERENCE pattern for `assertIssuable` (synchronous allowlist gate, total rejection, `reportRejection` observability seam).
- `supabase/migrations/20260928120600_save_invoice_draft_totals.sql` -- REFERENCE for the RPC conventions (SECURITY INVOKER, P0001 marker, version/status gate, `returns table`).
- `supabase/migrations/20260928120200_invoices.sql` & `..0300_invoice_line_items.sql` & `..0500_invoice_totals_and_tax_lines.sql` -- REFERENCE for table + RLS `..._tenant_isolation` shape. Latest on-disk timestamp is `20260928120600`; new files follow (`20260928120700+`). Applied timestamps differ from filenames (12.1–12.3 precedent) — apply via Supabase MCP and record applied timestamps in Implementation Notes.
- `src/lib/data/invoice-mutate.ts` -- ADD `issueInvoice(identity, { invoiceId, version })`: load the draft (`getInvoiceWithLineItems`) + `business_profiles` under RLS, compute `issue_date`=today + `taxApplies`, run `assertIssuable`, build snapshots, mint `share_token`, call the `issue_invoice` RPC; map `invoice_issue_conflict`→409, missing→404, non-draft→409. Mirrors `saveInvoiceDraft`'s error handling.
- `src/app/api/invoices/[id]/route.ts` -- REFERENCE for auth chain; the issue endpoint parallels it.
- `src/app/api/invoices/[id]/issue/route.ts` -- NEW. `POST`. Auth chain (`requireUser`→`resolveOrgIdentity`→`requireAdmin`+slug match), parse `{ slug, version }` (new schema), call `issueInvoice`, return `{ id, version, invoice_number }`.
- `src/app/api/invoices/schemas.ts` -- ADD `issueBodySchema` (`slug`, required `version`) + its `toX`/error-key helper.
- `src/lib/data/invoices.ts` -- EXTEND `getInvoiceWithLineItems`/`InvoiceRow` to carry the new columns (`invoice_number`, `issue_date`, `supplier_snapshot`, `customer_snapshot`, `share_token`) so the read layer and issued view can render from snapshots.
- `src/types/db.ts` -- ADD the new columns to `InvoiceRow`; add `SupplierSnapshot`/`CustomerSnapshot` types.
- `src/lib/data/invoices-client.ts` -- ADD `issueInvoice(slug, id, version)` client fetcher (parses the envelope, throws `InvoiceApiError`).
- `src/components/invoices/InvoiceDraftForm.tsx` -- ADD an Admin "Issue invoice" action (edit mode) with a confirm dialog (irreversible, mints a permanent number) reusing the existing `Dialog` pattern; on `AppError`, map the code to a translated inline/dialog message; on success `router.push` to the invoice view. Add issue error codes to `ERROR_KEYS`.
- `src/components/invoices/IssuedInvoiceView.tsx` -- NEW (per `/web-uiux-architect`). Read-only summary of an issued invoice from its snapshots: status badge, `formatInvoiceNumber`, issue date, supplier + customer identity, line items, tax line, totals. Minimal — the branded PDF is 12.5.
- `src/app/[slug]/invoices/[id]/page.tsx` -- BRANCH on status: `draft` → `InvoiceDraftForm` (with Issue action); non-draft → `IssuedInvoiceView`. Load the row server-side to decide.
- `src/components/invoices/InvoicesList.tsx` -- show `formatInvoiceNumber(invoice_number)` (or a dash for drafts) in a Number column.
- `src/lib/i18n/en.json` + `fr.json` -- ADD `Invoices` keys: issue action/confirm/issuing, issued-view labels (invoice number, issue date, supplier heading), and `error.legalIdentityMissing` / `taxWithoutRegistration` / `taxSplit` / `totalsMismatch`. Real French, no em-dashes.
- Next.js 16 App Router, vitest (`tests/unit/`, `tests/integration/`). Verify Next APIs against `node_modules/next/dist/docs/` before coding.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/20260928120700_invoice_issue_columns.sql` -- ALTER `invoices` ADD nullable `invoice_number bigint`, `issue_date date`, `supplier_snapshot jsonb`, `customer_snapshot jsonb`, `share_token text`; add partial unique indexes `(organization_id, invoice_number)` and `(share_token)` where not null. Apply via Supabase MCP.
- [ ] `supabase/migrations/20260928120800_invoice_number_counters.sql` -- CREATE `invoice_number_counters(organization_id uuid pk → organizations on delete cascade, next_number bigint not null default 1, created_at, updated_at)`; enable RLS + `invoice_number_counters_tenant_isolation` `auth_org_ids()` policy. Apply via Supabase MCP.
- [ ] `supabase/migrations/20260928120900_issue_invoice.sql` -- CREATE `issue_invoice(p_org, p_invoice_id, p_expected_version, p_actor, p_issue_date, p_supplier_snapshot, p_customer_snapshot, p_share_token) returns table(id, version, invoice_number)` SECURITY INVOKER: version+status='draft'+org gate (0 rows → raise `invoice_issue_conflict` P0001); allocate the counter (ensure row, then `update ... returning next_number - 1`); set status/number/issue_date/snapshots/share_token, bump version, set actor. Apply via Supabase MCP.
- [ ] `supabase/migrations/20260928121000_invoice_immutability_triggers.sql` -- CREATE `enforce_invoice_immutability` (invoices) + `enforce_invoice_child_immutability` (line items + tax lines) per Boundaries (I7); raise `invoice_immutable` / `invoice_status_transition` (P0001). Apply via Supabase MCP.
- [ ] `src/lib/invoicing/validate.ts` -- NEW `assertIssuable` (server-only, throws `AppError` with the specific codes) + `formatInvoiceNumber`. Reuse `tax.ts`; report rejections via the observability seam.
- [ ] `src/types/db.ts` -- add new `InvoiceRow` columns + `SupplierSnapshot`/`CustomerSnapshot` types.
- [ ] `src/lib/data/invoices.ts` -- surface the new columns in `getInvoiceWithLineItems`/`InvoiceRow`/`listInvoices`.
- [ ] `src/lib/data/invoice-mutate.ts` -- add `issueInvoice(identity, { invoiceId, version })` (load draft + profile, compute issue_date + taxApplies, assertIssuable, build snapshots, mint share_token, call RPC, map errors).
- [ ] `src/app/api/invoices/schemas.ts` -- add `issueBodySchema` + helpers.
- [ ] `src/app/api/invoices/[id]/issue/route.ts` -- NEW POST route (auth chain, calls `issueInvoice`).
- [ ] `src/lib/data/invoices-client.ts` -- add `issueInvoice(slug, id, version)`.
- [ ] `src/components/invoices/InvoiceDraftForm.tsx` -- add the Issue action + confirm dialog + error mapping (per `/web-uiux-architect`).
- [ ] `src/components/invoices/IssuedInvoiceView.tsx` -- NEW read-only issued view from snapshots (per `/web-uiux-architect`).
- [ ] `src/app/[slug]/invoices/[id]/page.tsx` -- branch draft vs issued.
- [ ] `src/components/invoices/InvoicesList.tsx` -- show the formatted number column.
- [ ] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add the issue/issued/error keys; real French, no em-dashes.
- [ ] `tests/unit/invoice-validate.test.ts` -- NEW: `assertIssuable` passes a valid invoice; blocks each of legalIdentityMissing / taxWithoutRegistration / taxSplit / totalsMismatch / lineItemsRequired; `formatInvoiceNumber` zero-pads.
- [ ] `tests/integration/invoice-issue-db.test.ts` -- NEW (real Supabase test project): issuing a valid draft allocates a gap-free number, freezes snapshots + issue_date + share_token, flips status; two issues increment; a stale/non-draft issue raises the conflict; the immutability trigger rejects a frozen-column UPDATE, a DELETE, and a child-row change on an issued invoice, and permits `issued→paid`/`issued→void`/`issued→overdue`/`paid→overdue`; a standalone draft freezes `customer_snapshot` null.

**Acceptance Criteria:**
- Given a draft invoice, when the Admin issues it, then `assertIssuable` runs first and blocks with a specific plain-language reason when legal identity is missing, tax is charged without a valid registration, HST is split, totals do not reconcile, or there are no line items — reusing the same tax function as I2 (FR87).
- Given a validated invoice, when it is issued, then a gap-free `invoice_number` is allocated from the per-org counter inside the same transaction that flips status to `issued`; numbers are never reused and a later void leaves a permanent gap (FR86, I1).
- Given the issue transaction, when it commits, then `supplier_snapshot` and `customer_snapshot` (null for a standalone) and `issue_date` and `share_token` are frozen onto the row, so the finalized document is stable even if the live records later change (FR86, I4, I6).
- Given an issued invoice, when any actor attempts to modify a frozen column, delete it, or change its child line/tax rows, then a Postgres trigger rejects it, permitting only the whitelisted status transitions; corrections are possible only via a future credit note (FR86, FR88, I7).
- Given a non-Admin or unauthenticated caller on `/api/invoices/[id]/issue`, then it returns 403/401 before access; and given the `fr` locale, all new copy is real French with no em-dashes.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

- Why `assertIssuable` verifies-and-blocks rather than recomputes-and-stores: AC1 mandates the gate "reuses the same tax function" to confirm the STORED figures reconcile. Since `issue_date` equals the draft's provisional `referenceDate` (both TODAY), a freshly-saved draft always passes; the only mismatch case is a draft saved on a prior day across a registration boundary — surfacing `totalsMismatch` (fix: re-save) is safer than silently changing money at issue.
- Why `share_token` is minted here (I4 "at issue") but `pdf_path` is deferred to 12.5: the token needs no rendering and must exist before the freeze, so minting it in the issue transaction avoids any trigger exception. `pdf_path` requires the rendered PDF (12.5), so 12.5 owns that column and the single `null→value` relaxation of `enforce_invoice_immutability`.
- Numbering is a locked counter row (`update ... returning next_number - 1`), not a Postgres sequence: a sequence is not transactional-rollback-safe (a rolled-back issue would burn a number, violating gap-free-except-voids) and is not naturally per-org. The counter row serializes concurrent issues and only advances on commit.
- Trigger design: drafts stay fully mutable by keying the freeze on `OLD.status = 'draft'`, so the draft→issued flip (which writes number/snapshots/token) is permitted in the same statement; every later write hits the frozen branch. The child trigger tolerates a missing parent so a draft's cascade delete (discard) still works.

## Verification

**Commands:**
- `npm run test -- tests/unit/invoice-validate.test.ts tests/integration/invoice-issue-db.test.ts` -- expected: all pass; full suite stays green.
- `npx tsc --noEmit` -- expected: no new type errors.
- `npm run lint` -- expected: clean.

**Manual checks:**
- On `/[slug]/invoices/[id]` as an Admin editing a valid registered-Ontario draft: click Issue, confirm, and see the page become the read-only issued view showing a 6-digit number, issue date, frozen supplier/customer identity, line items, HST line, and total. Clear the legal name (or GST/HST registration) and confirm issuing is blocked with the matching plain-language reason. Reload and confirm the issued invoice cannot be edited or discarded. Toggle `fr` and confirm all new copy is real French with no em-dashes.
