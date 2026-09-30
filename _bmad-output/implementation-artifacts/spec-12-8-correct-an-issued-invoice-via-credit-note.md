---
title: 'Story 12.8: Correct an Issued Invoice via Credit Note'
type: 'feature'
created: '2026-09-29'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'b155e10239d71abc1522b7b8be75b02594cdc77a'
context:
  - '_bmad-output/implementation-artifacts/epic-12-context.md'
  - '_bmad-output/implementation-artifacts/spec-12-4-issue-an-invoice-validate-number-freeze-identity-lock.md'
  - '_bmad-output/implementation-artifacts/spec-12-5-render-freeze-the-invoice-pdf.md'
  - '_bmad-output/implementation-artifacts/spec-12-7-track-payment-out-of-band-no-processing.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Once an invoice is issued it is immutable (12.4), so an owner who charged the wrong amount has no compliant way to correct it. There is no `credit_notes` table, no credit-note numbering, and no way to render or freeze a correction document. Corrections must never edit the sent invoice (FR88).

**Approach:** Add a credit-note module that mirrors the invoice pipeline: dedicated typed platform tables (`credit_notes` + child line/tax tables + an independent per-org number counter), a guarded draft-save and an `issue_credit_note` RPC that mints a gap-free number in its own namespace inside the status-flip transaction (I1), freezes supplier/customer snapshots (I6), and freezes a PDF rendered through the one shared render path (I8). A credit note links to its original invoice, is itself immutable once issued, and never mutates the original.

## Boundaries & Constraints

**Always:**
- New tables mirror their invoice cousins with the same RLS predicate (`organization_id in (select public.auth_org_ids())`) and a denormalized `organization_id` on every child row: `credit_notes` (adds `invoice_id uuid NOT NULL FK->invoices ON DELETE RESTRICT`, `original_invoice_number bigint` frozen at issue; carries `status` CHECK in `draft`/`issued`/`void`, `version`, `actor_id`, `subtotal`/`tax_total`/`total`, `credit_note_number bigint`, `issue_date`, `supplier_snapshot`/`customer_snapshot` jsonb, `share_token`, `pdf_path`; NO `due_date`), `credit_note_line_items` and `credit_note_tax_lines` (identical shape to the invoice child tables), and `credit_note_number_counters` (`organization_id` PK, `next_number`).
- Numbering (I1): `credit_note_number` is a per-org sequence in a namespace disjoint from invoice numbers, allocated by the locked-row increment pattern (`next_number = next_number + 1 ... returning next_number - 1`) inside the same transaction that flips status to `issued` — never `max()+1`. One documented zero-padded, no-prefix format (reuse `formatInvoiceNumber`). A void leaves a permanent gap.
- Totals (I2/I3): reuse `computeLineAmount`, `computeInvoiceTotals`, and the `isRegistrationEffective` predicate as-is. Credit-note line amounts are entered and stored as POSITIVE values; the document is titled "Credit Note" and represents a reduction. HST is computed once on the subtotal, shown as one line, never split. Stored money columns are written only from the canonical function's output; the issuance gate recomputes and verifies equality.
- Issuance gate: reuse the `assertIssuable` predicates (>=1 line, legal identity present, tax not split, tax only with a valid registration as of the credit note's issue date, totals reconcile). Issuing is deliberate and irreversible; the gate blocks with a plain-language `Invoice.error.*` code.
- Immutability (I7 analog): a status-transition whitelist trigger (`draft->issued`, `issued->void`) freezes every other column of non-draft credit notes and blocks INSERT/UPDATE/DELETE on child line/tax rows of non-draft credit notes, with the same one-time `pdf_path` null->value relaxation. The original invoice is never written by any credit-note path.
- Snapshots (I6): `supplier_snapshot`/`customer_snapshot` and `original_invoice_number` are populated inside the issue transaction (reuse the invoice snapshot builders); after issue the PDF and all rendering read exclusively from snapshots.
- One render path (I8): widen `InvoiceDocumentModel.documentType` to `"invoice" | "creditNote"` and add an optional `creditNoteReference` (original invoice number); `renderInvoicePdf` renders both. `ensureCreditNotePdf` mirrors `ensureInvoicePdf` and freezes the PDF to the existing private `invoice-pdfs` bucket under key `{org}/credit-notes/{creditNoteId}.pdf`.
- The public `/i/[token]` proxy is extended to resolve a credit note when no invoice matches the token and stream its frozen PDF server-side (I5), returning 404 for unknown/no-PDF and 410 once void; filename `credit-note-{number}.pdf`.
- Admin-gated routes nested under the parent invoice reuse the exact `requireUser -> resolveAdminIdentity -> 401/403-before-DB` chain and zod-validated bodies, errors mapped to `AppError` codes with no DB/provider leakage. All writes go through the guarded mutation layer (identity explicit, `actor_id` recorded, never the service-role client).
- Any source invoice status of `issued`, `paid`, or `overdue` may be credited (a correction is valid regardless of payment); `draft` and `void` invoices cannot.
- All new user-facing copy is added to `en.json` + `fr.json` with exact key parity, real French, straight apostrophes, and no em-dashes or en-dashes.

**Never:**
- Never edit, re-number, re-issue, re-render, or otherwise mutate the original invoice or any of its rows; the correction lives only on the credit note.
- Never process, hold, or move money; a credit note is a document, not a refund transaction. No payment/refund recording on credit notes in this story.
- Never email the credit note to the customer in this story (no Resend `/send` route, no delivery island) — email delivery is deferred to a follow-up; in-app View/Download/Copy Link only.
- Never reuse a credit-note number, share an id/counter with the invoice namespace, or allocate via `max()+1`. Never re-mint `share_token` on re-render.
- Never change the invoice immutability triggers, invoice numbering, the invoice issue RPC, or `ensureInvoicePdf`. Never add a second totals or tax implementation.
- Never render a credit note from live `records`/`business_profiles` after issue — snapshots only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create draft, happy | issued source invoice, >=1 credit line | draft `credit_notes` row + children written, linked via `invoice_id`, status `draft` | N/A |
| Source not creditable | source invoice `draft` or `void` | rejected, no draft created | 409 `notIssued` / 422 |
| Issue, happy | draft credit note, current version, gate passes | number allocated in own sequence, snapshots + `original_invoice_number` frozen, status `issued`, share_token minted, PDF frozen | N/A |
| Gap-free numbering | two issues, same org | consecutive credit-note numbers, disjoint from invoice numbers; a voided one leaves a gap | N/A |
| Gate blocks issue | missing legal identity / tax without registration / tax split / totals mismatch | issuance rejected, nothing frozen | 422 `Invoice.error.*` |
| Stale version | `expected_version` != current | rejected, no write | 409 `versionConflict` |
| Edit/delete issued | UPDATE a frozen column or child row of a non-draft credit note | rejected by trigger | `credit_note_immutable` -> surfaced |
| Bad input | empty lines, non-finite/negative amount, amount out of `numeric(15,2)` range | rejected before or at DB | 400 validation |
| Non-admin / cross-org | member non-admin, or slug mismatch | rejected before any DB access | 401 / 403 |
| Public PDF fetch | valid credit-note `share_token` | frozen PDF streamed inline server-side | unknown/no-pdf 404; void 410 |
| Draft prefill | create-credit-note on an issued invoice | draft opens prefilled with the invoice's frozen line items, owner edits/removes before issuing | N/A |

**Resolved decisions (from Open Questions):**
- Composition: the credit-note draft is PREFILLED from the original invoice's frozen `invoice_line_items` (owner then trims/edits before issuing). Chosen over blank-entry because the common correction is re-stating the invoice with one figure fixed; prefill serves both full undo and partial edits. The prefill reads the invoice's frozen children at draft-create time only (copied into the credit note's own child rows); after that the credit note is independent.
- Delivery: IN-APP ONLY this story. Create, issue, freeze the PDF, and offer View + Download PDF + Copy Link via the existing `/i/[token]` proxy. Emailing the credit note to the customer (Resend `/send` route + delivery island) is DEFERRED to a follow-up; the 12.8 ACs do not require delivery.
- Scope: kept as one cross-layer story despite exceeding the 1600-token guideline (single cohesive feature; layer-splitting would produce non-usable pieces).

</frozen-after-approval>

## Code Map

Reuse-as-is (do not modify unless noted):
- `src/lib/invoicing/tax.ts` -- `computeLineAmount`, `computeInvoiceTotals`, `isRegistrationEffective`, `formatInvoiceNumber` (`tax.ts:197`). Reuse verbatim.
- `src/lib/invoicing/validate.ts` -- `assertIssuable` predicates. Add a thin `assertIssuableCreditNote` (or call the shared checks) reusing every predicate; same `Invoice.error.*` codes.
- `src/lib/invoicing/storage.ts` -- `uploadInvoicePdf`/`downloadInvoicePdf`/`invoicePdfObjectKey`. Parameterize the object key OR add `creditNotePdfObjectKey(org,id)=`{org}/credit-notes/{id}.pdf`; reuse the same `invoice-pdfs` bucket + upload/download logic.
- `src/lib/api/route-helpers.ts` (`resolveOrgIdentity`, `handleError`), `src/lib/auth/rbac.ts` (`requireAdmin`), `src/lib/supabase/admin.ts` (`createAdminClient`), `src/types/api.ts` (`AppError`) -- reuse.

MODIFY:
- `src/lib/invoicing/pdf.tsx` -- widen `InvoiceDocumentModel.documentType` to `"invoice" | "creditNote"` (`pdf.tsx:79`); add optional `creditNoteReference?: string`; branch the title/reference line off `documentType` using new `InvoicePdf.*` catalog keys (`resolveInvoicePdfStrings` `pdf.tsx:157`, render `pdf.tsx:333/341`). No line/tax/totals change.
- `src/app/i/[token]/route.ts` -- after the invoice lookup misses, look up `credit_notes` by `share_token`; stream its frozen PDF; 404/410 mirror; filename `credit-note-{number}.pdf`.
- `src/types/db.ts` -- add `CreditNoteRow`, `CreditNoteLineItemRow`, `CreditNoteTaxLineRow`, `CreditNoteStatus` (`draft`/`issued`/`void`) mirroring `InvoiceRow` (254-346); reuse `SupplierSnapshot`/`CustomerSnapshot`.
- `src/components/invoices/IssuedInvoiceView.tsx` -- mount a "Create credit note" action for creditable statuses and render a list of linked credit notes (number, total, View/Download) once any exist.
- `src/app/[slug]/invoices/[id]/page.tsx` -- wire the create-credit-note entry point / linked-list into the issued branch.
- `src/lib/i18n/en.json` + `fr.json` -- add credit-note PDF title/reference keys under `InvoicePdf.*` and credit-note UI/error copy under `Invoices.*` (reuse existing `Invoices.error.*` codes; add new codes only where needed). Exact parity, real French, no em/en-dashes.

NEW (mirror the cited invoice file for each):
- `supabase/migrations/*_credit_notes.sql`, `*_credit_note_line_items.sql`, `*_credit_note_tax_lines.sql`, `*_credit_note_number_counters.sql` -- mirror `20260928120200/120300/120500/120800`.
- `supabase/migrations/*_save_credit_note_draft.sql` -- mirror `save_invoice_draft` (13-arg latest, `20260928121260`), minus `due_date`, plus `p_invoice_id` (source link).
- `supabase/migrations/*_issue_credit_note.sql` -- mirror `issue_invoice` (`20260928120900`): version+`status='draft'` gate raising a stable non-retryable P0001 marker, allocate from `credit_note_number_counters`, freeze snapshots + `original_invoice_number`, flip to `issued`.
- `supabase/migrations/*_credit_note_immutability_triggers.sql` + `*_credit_note_pdf_column_and_immutability.sql` -- mirror `20260928121000`/`121100`: whitelist `draft->issued`,`issued->void`; child freeze; one-time `pdf_path` relaxation.
- `src/lib/data/credit-note-mutate.ts` -- `saveCreditNoteDraft`, `issueCreditNote`, `ensureCreditNotePdf`, `discardCreditNoteDraft` mirroring `invoice-mutate.ts` (`saveInvoiceDraft` 91-198, `issueInvoice` 267-446, `ensureInvoicePdf` 584-713); reuse `InvoiceMutateIdentity`; same error-marker->`AppError` mapping.
- `src/lib/data/credit-notes.ts` -- `listCreditNotesForInvoice`, `getCreditNoteWithLineItems`, `getCreditNoteByShareToken` mirroring `invoices.ts`.
- `src/lib/data/credit-notes-client.ts` -- client fetch wrappers mirroring `invoices-client.ts` (envelope parse -> `InvoiceApiError`).
- `src/app/api/invoices/[id]/credit-notes/route.ts` (POST create, GET list-for-invoice) and `.../[cnId]/route.ts` (GET/PUT/DELETE draft) and `.../[cnId]/issue/route.ts` (POST). Copy the `[id]/issue/route.ts` auth chain verbatim.
- `src/app/api/invoices/schemas.ts` -- add credit-note draft/issue zod schemas + reuse `firstInvoiceErrorKey`.
- `src/app/[slug]/invoices/[id]/credit-notes/new/page.tsx` + `[cnId]/page.tsx` -- draft form + read-only issued view; reuse the `_shared.ts` admin gate/context loader.
- `src/components/invoices/CreditNoteDraftForm.tsx` (prefilled from the invoice's frozen line items, owner-editable) + `IssuedCreditNoteView.tsx` (read-only, with in-app Download PDF + Copy Link via `/i/[token]`) -- built via `/web-uiux-architect` (WCAG AA, `useReducedMotion`, reuse `Button`/`Dialog`/`Input`/`Label`/`ui/table`/`ui/badge` + Lucide). Reuse `PaymentInstructionsBlock` and the `resolveError` prefix-strip pattern.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/*_credit_notes.sql` (+ line_items, tax_lines, number_counters) -- create the four tables with RLS + indexes mirroring the invoice cousins; `invoice_id` NOT NULL FK ON DELETE RESTRICT.
- [x] `supabase/migrations/*_save_credit_note_draft.sql` -- draft upsert RPC (security invoker), version/status gate, replace children, precomputed amounts.
- [x] `supabase/migrations/*_issue_credit_note.sql` -- issue RPC: gap-free own-namespace number, snapshots + `original_invoice_number`, status flip, all in one transaction.
- [x] `supabase/migrations/*_credit_note_immutability_triggers.sql` + `*_credit_note_pdf_column_and_immutability.sql` -- transition whitelist + child freeze + one-time pdf_path relaxation.
- [x] `src/types/db.ts` -- add credit-note row types + `CreditNoteStatus`.
- [x] `src/lib/invoicing/pdf.tsx` -- widen `documentType`, add `creditNoteReference`, branch title/reference.
- [x] `src/lib/invoicing/validate.ts` + `storage.ts` -- credit-note issuance gate reuse + credit-note object key.
- [x] `src/lib/data/credit-note-mutate.ts` -- `saveCreditNoteDraft`, `issueCreditNote`, `ensureCreditNotePdf`, `discardCreditNoteDraft`.
- [x] `src/lib/data/credit-notes.ts` + `credit-notes-client.ts` -- read layer + client wrappers.
- [x] `src/app/api/invoices/[id]/credit-notes/**` + `schemas.ts` -- create/list/get/update/discard/issue routes with the admin auth chain and zod validation.
- [x] `src/app/i/[token]/route.ts` -- extend the public proxy to credit notes.
- [x] `src/app/[slug]/invoices/[id]/credit-notes/{new,[cnId]}/page.tsx` + `IssuedInvoiceView.tsx` + `[id]/page.tsx` -- create entry point, draft form, issued view, linked list.
- [x] `src/components/invoices/CreditNoteDraftForm.tsx` + `IssuedCreditNoteView.tsx` -- built via `/web-uiux-architect`.
- [x] `src/lib/i18n/en.json` + `fr.json` -- add all keys with parity, real French, no em/en-dashes.
- [x] `tests/unit/route-credit-note.test.ts` + `tests/unit/credit-note-pdf.test.ts` -- route auth/validation (200/400/401/403/409/422) and pure credit-note render/strings logic.
- [x] `tests/integration/credit-note-db.test.ts` -- real test project: draft save + version conflict; issue allocates a gap-free own-namespace number and freezes snapshots; child rows and frozen columns are immutable once issued; the original invoice is untouched.

**Acceptance Criteria:**
- Given an issued invoice that needs correcting, when the Admin creates and issues a credit note, then it is stored in `credit_notes` with a credit-note number from its own independent per-org sequence (disjoint from invoice numbers), linked to the original invoice via `invoice_id`, and the original invoice is unchanged (FR88, I1).
- Given a credit note, when its lines are captured, then they use the `credit_note_line_items`/`credit_note_tax_lines` child-table shape and the one shared render path (`renderInvoicePdf`) produces its PDF (I8).
- Given a finalized credit note, when it is issued, then it renders and freezes a PDF to private storage like an invoice and is itself immutable (frozen columns + child rows), while the original issued invoice is never edited (FR88).
- Given a non-Admin or cross-org caller, when they call any credit-note route, then it is rejected (401/403) before any DB access.

## Implementation Notes

- Eight migrations applied to the Supabase test project via MCP. Applied timestamps differ from the repo file names (12.1-12.7 precedent). Local files keep the spec-planned timestamps `20260928121500`-`20260928122200`: `credit_notes`, `credit_note_line_items`, `credit_note_tax_lines`, `credit_note_number_counters`, `save_credit_note_draft`, `issue_credit_note`, `credit_note_immutability_triggers`, `credit_note_pdf_column_and_immutability`. Security advisor after the change shows NO new findings — every new table carries its `*_tenant_isolation` `auth_org_ids()` policy; the four pre-existing advisor items (org_members/pending_claims RLS-no-policy, `auth_org_ids` SECURITY DEFINER x2, leaked-password) are unchanged.
- The `credit_notes` table mirrors `invoices` minus `due_date`, plus `invoice_id` (NOT NULL FK -> invoices ON DELETE RESTRICT) and `original_invoice_number` (frozen at issue). `pdf_path` is on the base table; the immutability trigger is created in the triggers migration (freezing pdf_path) then re-created in the pdf migration with the one-time `null->value` relaxation, exactly mirroring the 12.4/12.5 two-step for invoices. Credit-note status is `draft`/`issued`/`void` (no paid/overdue); the whitelist permits only `draft->issued` and `issued->void`.
- Numbering (I1): `credit_note_number` is allocated from `credit_note_number_counters` (its own per-org counter, disjoint from `invoice_number_counters`) by the locked-row `next_number = next_number + 1 ... returning next_number - 1` pattern inside the `issue_credit_note` transaction — never `max()+1`. The integration test confirms consecutive credit-note numbers and that they are a small independent sequence disjoint from the (larger) invoice numbers.
- Totals/gate (I2/I3): `assertIssuableCreditNote` (`validate.ts`) delegates verbatim to `assertIssuable`, reusing every predicate and `Invoice.error.*` code — no second money-math or registration implementation. Credit-note line amounts are stored POSITIVE (like invoices); the "Credit Note" title + the "Corrects invoice N" reference carry the reduction meaning.
- One render path (I8): `InvoiceDocumentModel.documentType` widened to `"invoice" | "creditNote"` with an optional `creditNoteReference`; `resolveInvoicePdfStrings` branches the title ("Credit Note"/"Note de crédit"), the number label, and the reference line off `documentType`. `renderInvoicePdf` renders both. `ensureCreditNotePdf` mirrors `ensureInvoicePdf` and freezes to the existing private `invoice-pdfs` bucket under `{org}/credit-notes/{id}.pdf` via `uploadCreditNotePdf` (same bucket, `credit-notes/` sub-prefix; org isolation is enforced by `path_tokens[1]` unchanged). Freeze is best-effort/non-fatal and idempotent (one-time `null->value` pdf_path).
- Public proxy: `/i/[token]` now falls back to `getCreditNoteByShareToken` when no invoice matches, streaming the frozen PDF via a shared `streamDocument` helper (same 404/410 gating; filename `credit-note-{number}.pdf`).
- Prefill (resolved decision): the create route (`POST /api/invoices/[id]/credit-notes`) loads the source invoice, verifies it is creditable (issued/paid/overdue, else 409 `notIssued`), and the `new` page prefills `CreditNoteDraftForm` from the source's frozen line items (copied into the credit note's own child rows on save; independent thereafter). Delivery is IN-APP ONLY (Download PDF + Copy Link via `/i/[token]`); no email/Web Share this story.
- Auth: all credit-note routes copy the invoice `requireUser -> resolveAdminIdentity -> 401/403-before-DB` chain verbatim, with zod-validated bodies mapped to `AppError` codes; writes go through the guarded mutation layer under the caller's RLS client (never service-role).
- i18n: added a `CreditNotes.*` namespace (UI + error codes) to both `en.json` and `fr.json`, plus `InvoicePdf.creditNoteTitle`/`creditNoteNumberLabel`/`creditNoteReference`. en/fr key parity is exact (632 keys each, verified programmatically); no em/en-dash in the new copy (the four pre-existing dash offenders are outside these namespaces).
- Verification: `npx tsc --noEmit` clean; `npm run lint` clean; `npm run build` succeeds (all five credit-note routes in the manifest). Full suite green: 848 tests / 79 files (up from 818 — new: `route-credit-note.test.ts` 18 cases, `credit-note-pdf.test.ts` 7 cases including the credit-note title/reference/language branches, and `credit-note-db.test.ts` 5 real-DB cases). NOTE: `next build` uses an incremental `.next/dev/types` cache — a stale cache can surface a spurious pre-existing `claim/route.ts` generated-types error; a clean `rm -rf .next && npm run build` passes (exit 0), verified against the baseline (which shows the same behavior).

- Matrix-audit closure (orchestrator pass, post-implementation): two frozen I/O-matrix rows had no covering automated test. (1) "Public PDF fetch (credit note)" — the `/i/[token]` credit-note fallback (`getCreditNoteByShareToken` -> `streamDocument`) was exercised for invoices only; added two cases to `tests/integration/invoice-share-route-db.test.ts` (a valid credit-note token streams a `%PDF` with a `credit-note-` filename; a voided credit note -> 410) and fixed that test's `afterAll` to delete `credit_notes` before the org cascade (the `credit_notes -> invoices` ON DELETE RESTRICT would otherwise block org teardown) and to sweep the `{org}/credit-notes/` storage objects. (2) "Draft prefill" — added `tests/unit/credit-note-draft-form.test.tsx` (SSR render via `renderToStaticMarkup`, the repo's node-env island-test pattern) asserting create-mode rows prefill from the source invoice's frozen line items and fall back to a single blank row when empty. Re-verified: `tsc --noEmit` clean, `npm run lint` clean, clean `rm -rf .next && npm run build` exit 0, full suite green at 852 tests / 80 files; en/fr i18n parity exact at 632/632 with no new em/en-dash offenders.

## Spec Change Log

## Review Triage Log

Review iteration 1 (blind-hunter, edge-case-hunter, verification-gap). No intent_gap/bad_spec → no loopback. Five patches; the rest rejected (false or low).

**Patched:**
- `patch` · **medium [BH1/BH2]** · The credit-note draft never inherits the source invoice's linked customer: the create route loads the source invoice but passes only line items; `CreditNoteDraftForm` has no customer field. So every credit note is created standalone, freezing `customer_snapshot = null`, and its PDF/issued view show "No linked customer" — undercutting the "re-state the invoice" intent (and the rich-path review rule). Fix: the create route inherits `source.invoice.customer_record_id` when the body supplies none (the snapshot/PDF/view pipeline already handles it). Localized, no new surface → patch.
- `patch` · **low [BH8/ECH5]** · `IssuedCreditNoteView` renders `originalNumberDisplay || t("standaloneCustomer")` for the "Corrects invoice" slot, so an absent original number shows "No linked customer" (nonsensical copy for that field). Near-unreachable (a creditable source always has a number) but a trivial, direct copy fix → patch.
- `patch` · **low [BH5]** · `CreditNotes.linkedSubtitle` is defined in en/fr but never referenced (`createSubtitle` is the one rendered under `linkedHeading`). Dead copy; smallest fix is a direct deletion from both files (keeps parity) → patch.
- `patch` · **verification gap [VG1/BH9]** · The `[cnId]/route.ts` PUT/GET/DELETE handlers (incl. the `version === null → 409 versionConflict` guard and DELETE→`notDraft`) and the create route's `customerRecordInvalid` 400 branch have no route-level test, though the invoice siblings do (`route-invoices.test.ts`). Integration tests bypass the HTTP layer. Fix: add route cases to `route-credit-note.test.ts` mirroring the invoice route tests → patch.
- `patch` · **low [VG-other]** · `credit-note-db.test.ts` `afterAll` never sweeps the `{org}/credit-notes/` storage objects its `issueCreditNote` calls freeze (the sibling share-route test was updated to do so in this same diff). Trivial test-hygiene addition → patch.

**Rejected (false — verified the bad outcome cannot occur):**
- `false` · **[BH3] version accepts 0** · `issueCreditNoteBodySchema` uses `.nonnegative()`, matching the invoice `issueBodySchema` precedent exactly; a `version: 0` merely 409s at the DB gate (a fresh draft is always ≥1). Consistent, no bad outcome.
- `false` · **[BH6] no "issue" affordance in the linked list** · By design — a draft row links to its editor where Issue lives. No defect.
- `false` · **[BH7] `streamDocument.SERVABLE` includes paid/overdue for credit notes** · Credit-note `status` is CHECK-constrained to `draft`/`issued`/`void`, so those states are unreachable; the shared set cannot serve a state a credit note can hold.
- `false` · **[BH10] delivery copy blurs the deferred-email boundary** · `deliverSubtitle` = "Download the PDF or share a private link to it." accurately describes the in-app Download + Copy Link scope; it claims no email/send. Matches the resolved delivery decision.
- `false` · **[BH11] province default-seed inconsistency (create vs edit wrapper)** · Masked: the edit path re-reads the saved draft's province via `getCreditNote`, so the two entry-point defaults never diverge for a persisted draft.
- `false` · **[ECH4] create 400 param check before `requireUser`** · The missing-`[id]` 400 is not DB access; the AC ("401/403 before any DB access") holds, and the ordering matches the invoice routes.

**Rejected (low — negligible harm and/or fix adds undemonstrated surface):**
- `low` · **[BH4] edit-page re-fetches the source invoice for the header number, degrading to "" if RLS-hidden** · Same-org Admin gate makes the source visible; a header degradation is cosmetic and the fix (thread the number through the draft) adds complexity.
- `low` · **[ECH1] issued-view delivery bar shows Download gated on `share_token`, not `pdf_path`** · `ensureCreditNotePdf` is awaited in the issue path so `pdf_path` is set before the view renders; this mirrors the 12.6 invoice delivery bar, and gating it would add a prop for a near-unreachable state (the linked list already gates on `pdf_path`).
- `low` · **[ECH2] no UI to retry a failed best-effort PDF freeze** · The freeze is idempotent/retryable-by-design and identical to the invoice precedent; a retry affordance is undemonstrated new surface.
- `low` · **[ECH3] routes don't verify path `[id]` equals the credit note's `invoice_id`** · Every handler targets the correct `cnId` and RLS blocks cross-org; a mismatched `[id]` is only cosmetic URL context, and a guard defends a state with no data-level bad outcome.

## Design Notes

- Why positive amounts + "Credit Note" title (not stored negatives): reusing `computeInvoiceTotals`/`computeLineAmount` unchanged (I2) requires the same rounding/summing semantics; a negative-amount path would fork the canonical math. The document's title and its reference to the original invoice carry the "reduction" meaning, matching how paper credit notes read.
- Why reuse the `invoice-pdfs` bucket under a `credit-notes/` key prefix rather than a new bucket: the bucket RLS keys off `path_tokens[1]` (the org id), which is unchanged by the sub-prefix, so it stays org-isolated while avoiding a second bucket + four duplicate storage policies.
- Why `original_invoice_number` is frozen on the credit note at issue: the PDF must show which invoice it corrects without a live join into `invoices` after issue (snapshot authority, I6); `invoice_id` remains the navigational FK.

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: no new type errors.
- `npm run lint` -- expected: clean.
- `npm run build` -- expected: succeeds; credit-note routes in the manifest.
- `npm run test -- tests/unit/route-credit-note* tests/unit/credit-note* tests/integration/credit-note-db.test.ts` -- expected: pass; full suite stays green.

**Manual checks:**
- On the authed Admin fixture against the dev app: from an issued invoice, create and issue a credit note; confirm it gets its own gap-free number, freezes a PDF viewable/downloadable, is immutable, and leaves the original invoice unchanged. Toggle `fr` and confirm real French with no em-dashes.
