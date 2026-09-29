---
title: 'Story 12.3: Totals & Ontario HST (Place of Supply)'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'dispatch'
baseline_commit: 'a83513260ff7186dc17894efadd22468d52ef245'
review_loop_iteration: 0
context:
  - '_bmad-output/implementation-artifacts/epic-12-context.md'
  - '_bmad-output/implementation-artifacts/spec-12-2-draft-an-invoice-from-a-work-record-or-standalone.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A draft (Story 12.2) captures line items but computes no money totals and no tax. Every compliant invoice must show a reconciling subtotal/total and, for a GST/HST-registered Ontario supplier, HST as one separate line. Later stories (12.4 issue gate, 12.5 PDF) need these totals stored authoritatively from a single canonical function.

**Approach:** Extend the single canonical `src/lib/invoicing/tax.ts` (which today holds only `computeLineAmount`) with subtotal/tax/total math and the shared registration predicate (Invariants I2, I3). Add typed money columns to `invoices` and a typed `invoice_tax_lines` child table. Each draft save recomputes and stores `subtotal`/`tax_total`/`total` plus its tax line(s) from that one function's output; the draft form shows the subtotal, the HST line, and the total live. Ontario/English (HST 13%) is the only active tax path; the province/language seam is already stored (12.2) so Quebec can be enabled later with no re-architecture.

## Boundaries & Constraints

**Always:**
- `src/lib/invoicing/tax.ts` remains the SINGLE money-math source (I2). Add: `computeSubtotal(lines)` = `Σ computeLineAmount`; `computeInvoiceTotals({ lineItems, province, taxApplies })` returning `{ subtotal, taxLines, taxTotal, total }` where `total = subtotal + taxTotal`; a `PROVINCE_TAX` rate map (`ON` → `{ label: 'HST', rate: 0.13 }`, other provinces including `QC` absent = no active tax line in MVP); `normalizeProvince(p)` (trim + uppercase); and the shared predicate `isRegistrationEffective(effectiveDate, referenceDate)` (`effective <= reference`, false when `effectiveDate` is null). The module stays pure and dependency-free — the caller supplies `referenceDate`; never call `Date` inside `tax.ts`.
- HST is computed ONCE on the subtotal: `round(subtotal × rate, 2)`, emitted as exactly ONE `invoice_tax_lines` row (`label`, `rate`, `base = subtotal`, `tax_amount`) — never per line, never split into federal/provincial (I3, FR84).
- A tax line is emitted only when `taxApplies` AND `PROVINCE_TAX[normalizeProvince(province)]` exists. `taxApplies` = the business has a `gst_hst_number` AND `isRegistrationEffective(gst_hst_effective_date, referenceDate)`. Otherwise no tax is labelled or calculated (`tax_total = 0`, no tax-line rows) (FR84).
- Decision (draft reference date): a draft has no `issue_date` (that is set at issue, 12.4), so a draft evaluates the predicate against TODAY as a provisional reference (`referenceDate` = the current date, `YYYY-MM-DD`, supplied by the route/mutation). Story 12.4 recomputes authoritatively against the real `issue_date` and the gate asserts equality via the same function (I2). A future-dated registration therefore shows no tax on today's draft.
- The stored `invoices.subtotal`/`tax_total`/`total` and every `invoice_tax_lines` row are written ONLY from `computeInvoiceTotals` output, on every draft save, through the existing `save_invoice_draft` RPC (extended) under the caller's RLS client (I2). Line `amount` continues to be computed by `computeLineAmount` and passed precomputed; the RPC never re-implements any amount.
- `invoice_tax_lines`: `id`, `invoice_id` (FK → `invoices.id` `ON DELETE CASCADE`), denormalized `organization_id`, `label` (text), `rate` (numeric), `base` (numeric), `tax_amount` (numeric), `sort_order` (int), `created_at`, `updated_at`; `enable row level security` + one `invoice_tax_lines_tenant_isolation` policy `organization_id in (select public.auth_org_ids())` for `all`, mirroring `invoice_line_items`.
- New `invoices` money columns are `numeric not null default 0` (existing 12.2 drafts read as 0 until their next save).
- The predicate `isRegistrationEffective` is exported from `tax.ts` so Story 12.4's `validate.ts` imports the SAME helper (I3) — no second implementation anywhere.
- The draft form shows subtotal, the HST line (translated tax name + rate, e.g. `HST (13%)`), and total, recomputed live from `computeInvoiceTotals` as line items / province change; it degrades to subtotal-only when no tax applies. Built per the `/web-uiux-architect` skill, reusing `src/components/ui` primitives; all copy via next-intl (en + fr, real French, no em-dashes), a11y baseline (labeled, keyboard, ≥48px targets, WCAG AA, reduced-motion).

**Never:**
- Never compute HST per line, split it into components, or emit more than one tax line for the MVP Ontario path.
- Never write totals/tax from anywhere but `computeInvoiceTotals` output; never re-implement subtotal/tax/line-amount in SQL, the route, or the client.
- Never issue, mint a number, freeze a snapshot, run `assertIssuable`, render a PDF, or transition status (those are 12.4-12.5). Totals are stored on `draft` rows only here.
- Never activate a Quebec (GST + QST) tax path now; store the seam only.
- Never use the service-role client for this data; never leak raw SQL/stack to the client.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Registered ON draft | Business has GST/HST number, effective ≤ reference date, province ON, lines present | One HST line `round(subtotal×0.13,2)`; `tax_total` = that; `total = subtotal + tax_total`; all stored | N/A |
| Unregistered draft | No `gst_hst_number` | No tax line; `tax_total = 0`; `total = subtotal` | N/A |
| Future registration | `gst_hst_effective_date` > reference date | No tax line; `tax_total = 0`; `total = subtotal` | N/A |
| Non-Ontario province | Registered but province `QC` (or other) | No active tax line (MVP); `tax_total = 0`; seam stored | N/A |
| Subtotal reconciles | Multiple lines | `subtotal = Σ round(qty×unit,2)`; `total` reconciles exactly | N/A |
| Totals persisted | Save then reload a draft | Stored `subtotal`/`tax_total`/`total` + tax line(s) load back and match | N/A |
| Live preview | Admin edits lines / switches province in the form | Subtotal, HST line, and total update live from `computeInvoiceTotals` | N/A |
| Zero-line guard | (unchanged from 12.2) | ≥1 line still required before save | `Invoice.error.lineItemsRequired` (400) |
| Stale/non-draft save | Wrong `version` or non-draft row | Rejected; no totals/tax written | `Invoice.error.versionConflict` (409) |
| Non-Admin / no session | Member, anon on any `/api/invoices*` route | Rejected before access | `forbidden` (403) / `unauthorized` (401) |

</frozen-after-approval>

## Code Map

- `src/lib/invoicing/tax.ts` -- EXTEND (do not rewrite `computeLineAmount`/`roundMoney`). Add `computeSubtotal`, `computeInvoiceTotals`, `PROVINCE_TAX`, `normalizeProvince`, `isRegistrationEffective`, and `TaxLine`/`InvoiceTotals` types. Pure; caller supplies `referenceDate`.
- `supabase/migrations/20260928120200_invoices.sql` -- reference for the invoices table shape (no money columns yet). Latest migration timestamp on disk is `20260928120400`; new files follow it. Applied timestamps differ from filenames (12.1/12.2 precedent) — apply via Supabase MCP (test project) and record the applied timestamp in Implementation Notes.
- `supabase/migrations/20260928120300_invoice_line_items.sql` -- MIRROR for the new `invoice_tax_lines` table (denormalized `organization_id`, FK CASCADE, `(invoice_id, sort_order)` index, RLS + `..._tenant_isolation` `auth_org_ids()` policy).
- `supabase/migrations/20260928120400_save_invoice_draft.sql` -- the RPC to extend: add `p_subtotal`/`p_tax_total`/`p_total` numeric + `p_tax_lines` jsonb; write the money columns on insert and update; after the line-item replace, delete + re-insert `invoice_tax_lines` from `p_tax_lines`. Signature changes → `drop function` the old 8-arg overload first, then create the new one (avoid an ambiguous overload). Keep the `P0001` `invoice_draft_conflict` marker.
- `src/lib/data/invoice-mutate.ts` -- `saveInvoiceDraft`: after computing line amounts, load the org's `business_profiles` (`gst_hst_number`, `gst_hst_effective_date`) under the RLS client, compute `taxApplies = number present && isRegistrationEffective(effectiveDate, referenceDate)`, call `computeInvoiceTotals`, and pass totals + tax lines to the RPC. Accept `referenceDate` in the input (route supplies today).
- `src/app/api/invoices/route.ts` + `[id]/route.ts` -- POST/PUT: compute `referenceDate` (today, `YYYY-MM-DD`) once and pass into `saveInvoiceDraft`. No new auth surface.
- `src/lib/data/invoices.ts` -- `getInvoiceWithLineItems`: also load ordered `invoice_tax_lines`; extend `InvoiceWithLineItems` with `taxLines`. `InvoiceRow` now carries the money columns.
- `src/types/db.ts` -- add `subtotal`/`tax_total`/`total` (`number | string`, PostgREST numeric boundary) to `InvoiceRow`; add `InvoiceTaxLineRow`.
- `src/app/[slug]/invoices/_shared.ts` -- also read `gst_hst_number`/`gst_hst_effective_date`; compute `taxRegistered` (present && effective as-of-today) and add it to `InvoicePageContext`, passed to the form.
- `src/components/invoices/InvoiceDraftForm.tsx` -- take a `taxRegistered` prop; replace the subtotal-only footer with subtotal + HST line + total via `computeInvoiceTotals({ lineItems, province, taxApplies: taxRegistered })`; the tax name/rate are translated. Per `/web-uiux-architect`.
- `src/app/[slug]/invoices/new/page.tsx` + `[id]/page.tsx` -- pass the new `taxRegistered` context prop to the form.
- `src/lib/i18n/en.json` + `fr.json` -- add `Invoices` keys: `totalLabel`, `taxHst` (`HST`/`TVH`), tax-line/total hints; update `subtotalHint` + `draftSubtitle` (tax is now shown, not "calculated later"). Real French, no em-dashes.
- Next.js 16 App Router, vitest (`tests/unit/`, `tests/integration/`). Verify Next APIs against `node_modules/next/dist/docs/` before coding.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20260928120500_invoice_totals_and_tax_lines.sql` -- ALTER `invoices` ADD `subtotal`/`tax_total`/`total` (`numeric not null default 0`); CREATE `invoice_tax_lines` (columns per Boundaries) + `(invoice_id, sort_order)` index; enable RLS; add `invoice_tax_lines_tenant_isolation` `auth_org_ids()` policy. Apply via Supabase MCP.
- [x] `supabase/migrations/20260928120600_save_invoice_draft_totals.sql` -- `drop function public.save_invoice_draft(...)` (old 8-arg) then `create` the extended version with `p_subtotal`/`p_tax_total`/`p_total`/`p_tax_lines`; store money columns (insert + update); replace `invoice_tax_lines` from `p_tax_lines`. Preserve the version/status gate + `P0001` conflict marker. Apply via Supabase MCP.
- [x] `src/lib/invoicing/tax.ts` -- add `computeSubtotal`, `computeInvoiceTotals`, `PROVINCE_TAX`, `normalizeProvince`, `isRegistrationEffective`, `TaxLine`/`InvoiceTotals` types. Reuse `roundMoney`/`computeLineAmount`; stay pure.
- [x] `src/types/db.ts` -- add money columns to `InvoiceRow`; add `InvoiceTaxLineRow`.
- [x] `src/lib/data/invoice-mutate.ts` -- load registration, compute `taxApplies` + totals, pass them and the new RPC params; thread `referenceDate` through the input.
- [x] `src/app/api/invoices/route.ts` + `src/app/api/invoices/[id]/route.ts` -- compute today's `referenceDate` and pass into `saveInvoiceDraft` (POST + PUT).
- [x] `src/lib/data/invoices.ts` -- load ordered tax lines in `getInvoiceWithLineItems`; extend `InvoiceWithLineItems` with `taxLines`.
- [x] `src/app/[slug]/invoices/_shared.ts` -- compute + expose `taxRegistered` in `InvoicePageContext`.
- [x] `src/components/invoices/InvoiceDraftForm.tsx` -- live subtotal + HST line + total from `computeInvoiceTotals`; translated tax name/rate; `taxRegistered` prop.
- [x] `src/app/[slug]/invoices/new/page.tsx` + `src/app/[slug]/invoices/[id]/page.tsx` -- pass `taxRegistered`.
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add/adjust the `Invoices` keys above; real French, no em-dashes.
- [x] `tests/unit/invoice-tax.test.ts` -- EXTEND: `computeSubtotal` sum + rounding; HST `round(subtotal×0.13,2)` once; not-registered → no tax; future effective date → no tax; non-ON province → no tax; `total` reconciliation; `isRegistrationEffective` boundary (equal date true, null false).
- [x] `tests/integration/invoice-draft-db.test.ts` -- EXTEND: a registered-ON draft stores one tax line + `tax_total`/`total`; an unregistered/future/non-ON draft stores no tax line and `tax_total = 0`; reload matches.

**Acceptance Criteria:**
- Given a draft with line items for a GST/HST-registered Ontario supplier whose registration is effective, when it is saved, then exactly one HST line (`round(subtotal×0.13,2)`) is stored in `invoice_tax_lines`, and `invoices.subtotal`/`tax_total`/`total` are written solely from `computeInvoiceTotals` output with `total = subtotal + tax_total` (I2, I3, FR84).
- Given a supplier that is not GST/HST-registered, or whose `gst_hst_effective_date` is after the reference date, when a draft is prepared, then no tax line is created and `tax_total = 0`, using the shared `isRegistrationEffective` predicate exported from `tax.ts` (FR84, I3).
- Given the province/language seam, when a non-Ontario province is set, then no active tax is calculated in MVP while province + language remain stored so Quebec can be enabled later with no re-architecture (FR95).
- Given the draft form, when line items or province change, then subtotal, the HST line, and total update live from the same canonical function, and reload shows the persisted values.
- Given a non-Admin or unauthenticated caller on any `/api/invoices*` route, then it returns `403`/`401` before access; and given the `fr` locale, all new copy is real French with no em-dashes.

## Implementation Notes

- Migrations applied to the Supabase test project via MCP: `invoice_totals_and_tax_lines` (applied timestamp `20260929115448`) and `save_invoice_draft_totals` (applied timestamp `20260929115505`). Local files keep the spec-planned timestamps (`20260928120500` / `20260928120600`), mirroring the 12.1/12.2 precedent where the repo file name and the applied migration timestamp differ. The old 8-arg `save_invoice_draft` overload was dropped before creating the 12-arg version; `pg_proc` confirms a single overload remains (no ambiguity). Security advisor shows no new findings — `invoice_tax_lines` carries its `invoice_tax_lines_tenant_isolation` `auth_org_ids()` policy; the remaining advisor items (org_members/pending_claims RLS-no-policy, `auth_org_ids` SECURITY DEFINER, leaked-password) are all pre-existing and unrelated.
- `tax.ts` extended (not rewritten): added `computeSubtotal`, `computeInvoiceTotals`, `PROVINCE_TAX` (`ON` → HST 13% only; `QC`/others deliberately absent = no active tax line), `normalizeProvince`, the shared `isRegistrationEffective` predicate, and `TaxLine`/`InvoiceTotals`/`TotalsLineItem` types. All reuse `roundMoney`/`computeLineAmount`; the module stays pure and never calls `Date` (the caller supplies `referenceDate`). `isRegistrationEffective` is `effective <= reference` (lexicographic on zero-padded ISO), false when the effective date is null — Story 12.4's `validate.ts` imports THIS same helper (I3).
- `computeInvoiceTotals` emits exactly ONE tax line, computed once on the subtotal (`round(subtotal × rate, 2)`), only when `taxApplies && PROVINCE_TAX[normalizeProvince(province)]` exists — never per line, never split (I3, FR84). A unit test asserts the once-on-subtotal divergence (two 0.10 lines → HST 0.03 on the 0.20 subtotal, not 0.01 + 0.01 per line).
- `invoice-mutate.ts` loads the org's `business_profiles` (`gst_hst_number`, `gst_hst_effective_date`) under the caller's RLS client, computes `taxApplies = number present && isRegistrationEffective(effective, referenceDate)`, calls `computeInvoiceTotals`, and passes `p_subtotal`/`p_tax_total`/`p_total`/`p_tax_lines` to the extended RPC. `referenceDate` is threaded through the input; both routes (POST + PUT) compute it as today's `YYYY-MM-DD`. A missing profile / read error degrades to `taxApplies = false` (no tax line), never a crash.
- The draft form takes a `taxRegistered` prop (computed once in `_shared.ts` via the SAME shared predicate against today, so the live preview matches the server's provisional reference date) and renders subtotal + a translated `HST (13%)` line + total live from `computeInvoiceTotals`; it degrades to subtotal-only when `taxRegistered` is false or the province is off `ON`. The stored tax-line `label` is the canonical `HST`; the form displays `t("taxHst")` (`HST`/`TVH`) with the rate interpolated via `taxLineLabel`.
- i18n: added `totalLabel`, `taxHst` (`HST`/`TVH`), `taxLineLabel` (`{tax} ({rate}%)` / `{tax} ({rate} %)`), `totalsHint`; updated `subtotalHint` + `draftSubtitle` (tax is now shown live, not "calculated later"). Real French, no em-dashes (verified programmatically over all new/updated keys).
- Tests: `tests/unit/invoice-tax.test.ts` extended to 22 cases (subtotal sum + rounding, HST once, not-registered/future/non-ON → no tax, total reconciliation, `isRegistrationEffective` equal-date-true/null-false boundary, `normalizeProvince`, `PROVINCE_TAX` shape). `tests/integration/invoice-draft-db.test.ts` extended with a `totals & Ontario HST` block (registered-ON stores one HST line + subtotal/tax_total/total; unregistered/future/non-ON store no tax line and tax_total = 0; a re-save replaces the tax line away when registration is cleared) — all against the real Supabase test project. The integration `draft()` helper now supplies `referenceDate` and an optional `province`.

## Spec Change Log

## Review Triage Log

Review iteration 1 (blind-hunter, edge-case-hunter, verification-gap). No intent_gap/bad_spec → no loopback. One patch, one defer; the rest rejected.

**Patched:**
- `low` · **patch** · `invoice-mutate.ts` (`saveInvoiceDraft`) reads `business_profiles` with `const { data: profile } = ...` — it never inspects `error`. A genuine RLS/DB read error (not the no-row case, which `maybeSingle` returns as `error=null`) silently degrades to `taxApplies=false`, so a registered org's draft is stored with `tax_total=0` (understated) with nothing surfaced. Bounded (draft, provisional, self-corrected at 12.4 issue) but a swallowed error in the compliance/money path, and inconsistent with the RPC-error handling immediately below that throws `writeFailed`. Flagged by edge-case-hunter + verification-gap. Fix: guard the profile read `error` and throw `writeFailed` — fires only on a true read failure, never on a legitimately absent profile. [ECH, VG]

**Deferred:**
- `low` · **defer** · `loadInvoicePageContext` (`_shared.ts`) computes `taxRegistered` (the `hasNumber && isRegistrationEffective(...)` composite against today) with zero test coverage — no test references `_shared.ts`/`InvoicePageContext`. If a future refactor mis-wires it, the form's live preview would show/hide HST wrongly. Preview-only: the server recomputes authoritatively on save (that path IS integration-tested), so a wrong preview is cosmetic, not a data-integrity defect. Would be closed by a small unit test mocking the RLS client (as `invoices-read.test.ts` does) asserting the four `taxRegistered` cases. [VG-primary, filed defer]

**Rejected:**
- `false` · The "P0001 vs 40001" comment (`invoice-mutate.ts` error block) is not a contradiction — it deliberately explains why the RPC raises the non-retryable P0001 and NOT the auto-retried 40001; the docstring and migration agree on P0001. No stale wording remains. [BH]
- `false` · French `taxLineLabel` `"{tax} ({rate} %)"` vs English `"{tax} ({rate}%)"` — the space before `%` is correct French typography, not a divergence bug. [BH]
- `false` · Page-load-vs-save midnight date skew making the preview `taxRegistered` diverge from stored totals is inherent to a provisional preview the spec explicitly treats as non-authoritative (server recomputes on save; 12.4 is the authority). No defect. [ECH]
- `low` · Loaded `taxLines` are returned by `getInvoiceWithLineItems`/GET but the form recomputes live rather than displaying them — by design (spec: totals shown live from `computeInvoiceTotals`; preview is non-authoritative). The read-layer completeness is legitimate for the 12.5 PDF/render path. No user-visible bad outcome; fix would be a comment reword only. [BH]
- `low` · No equal-date (`effective == referenceDate == today`) boundary test through the real save path — the boundary IS unit-tested in `isRegistrationEffective`, and the end-to-end registered path (YESTERDAY) exercises the identical `<=` branch. Negligible added value. [BH]
- `low` · No edit/PUT integration test that recomputes a NON-zero tax with changed amounts while staying registered — the UPDATE branch's money-column persistence is covered by the registered→unregistered re-save (asserts the row's `tax_total`/`total` after an update), and the computation is exhaustively unit-tested. Negligible gap. [BH]
- `low` · The `business_profiles` "both present or both null" registration-pair CHECK is not re-asserted by the readers — a half-populated row would compute `taxApplies=false` (safe). No bad outcome; a fix adds an assertion/complexity. [BH]
- `low` · A registered ON draft with a zero subtotal stores/preview-renders a `HST (13%) 0.00` line — spec-consistent (a tax line is emitted when `taxApplies && province has a rate`, not gated on subtotal>0) and asserted by a unit test. Cosmetic; suppressing it adds a branch and contradicts the canonical computation. [BH, ECH]
- `low` · `taxLineLabel` uses `Math.round(line.rate * 100)`, which would misstate a future non-integer QST rate (e.g. 9.975% → "10%"). Out of scope by intent: the MVP is Ontario-only (13%, integer, renders correctly); the Quebec/QST path is an explicit future seam, not built here. No current bad outcome. [BH]
- `low` · The `hasNumber && isRegistrationEffective(...)` composite is duplicated across `_shared.ts` (preview) and `invoice-mutate.ts` (authoritative). Invariant I3's single shared predicate (`isRegistrationEffective`) IS honored by both; only the thin wrapper is duplicated. Divergence needs a future careless edit and would only affect the cosmetic preview; extracting a helper adds a public surface. [BH, VG-secondary]

## Design Notes

- Why totals live on the draft: AC1 mandates the stored columns come only from `computeInvoiceTotals`, and this story shows HST at the prepare stage — so every draft save recomputes and stores them. Story 12.4 recomputes at issue with the real `issue_date` and the gate asserts equality against this same function (I2), so a draft's provisional total can never diverge from what is issued.
- Why `taxApplies` is passed as a boolean into `computeInvoiceTotals` (rather than the raw effective date): keeps `tax.ts` pure and lets the client preview reuse it with a server-evaluated `taxRegistered` flag, while the date predicate `isRegistrationEffective` stays the single shared helper 12.4 imports.
- The stored tax-line `label` is the canonical `HST`; the form displays a locale-translated name (`taxHst`). Localized labels on the rendered PDF are Story 12.5.

## Verification

**Commands:**
- `npm run test -- tests/unit/invoice-tax.test.ts tests/integration/invoice-draft-db.test.ts` -- expected: all pass; full suite stays green.
- `npx tsc --noEmit` -- expected: no new type errors.
- `npm run lint` -- expected: clean.

**Manual checks:**
- On `/[slug]/invoices/new` as an Admin with a registered Ontario Business Profile: add line items and confirm the subtotal, an `HST (13%)` line, and a reconciling total update live; save and reload and confirm the stored totals + tax line match. Clear the GST/HST registration (or set a future effective date) in the Business Profile and confirm a new draft shows no tax. Switch the province off `ON` and confirm the tax line disappears. Toggle locale to `fr` and confirm all totals/tax copy is real French with no em-dashes.
