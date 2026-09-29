---
title: 'Story 12.7: Track Payment Out-of-Band (No Processing)'
type: 'feature'
created: '2026-09-29'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '655a1678887d8f007fe108b4e843bfd3339bae0f'
context:
  - '_bmad-output/implementation-artifacts/epic-12-context.md'
  - '_bmad-output/implementation-artifacts/spec-12-4-issue-an-invoice-validate-number-freeze-identity-lock.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An issued invoice can now be delivered (12.6), but the owner cannot see who owes them or mark an invoice paid. There is no payment record at all: the `invoice_payments` table does not exist, invoices carry no due date to derive an overdue state from, and the Invoices list shows every invoice in one undifferentiated table.

**Approach:** Add the `invoice_payments` table (deliberately outside the immutability triggers so it stays freely mutable, I7) and a guarded `recordPayment` mutation that, in one RPC transaction, records a single out-of-band payment and flips the whitelisted `issued→paid` transition. Add a nullable `due_date` on invoices, frozen at issue, and default the Invoices list to an Unpaid / Overdue receivables view derived at read time from `status` + `due_date`. Scheza never processes, holds, or moves money.

## Boundaries & Constraints

**Always:**
- New `invoice_payments` table: `id`, `invoice_id` FK→`invoices`, `organization_id` FK→`organizations`, `method` (`text` CHECK in `etransfer`/`cheque`/`card`/`other`), `paid_date date`, `amount numeric(15,2)`, `reference text` nullable, `actor_id`, `created_at`. RLS policy mirrors `invoices_tenant_isolation` (`organization_id in (select public.auth_org_ids())`). `UNIQUE(invoice_id)` and an index on `invoice_id`. The immutability triggers are NOT extended to this table — it stays mutable while its parent invoice is frozen (I7).
- Marking paid is a guarded mutation `recordPayment(identity, …)` in `invoice-mutate.ts` calling a new `record_invoice_payment` RPC (`security invoker`, runs under RLS) that in ONE transaction: version-gates, requires current `status = 'issued'`, inserts exactly one `invoice_payments` row, and updates `invoices` `status → 'paid'` with `version`, `updated_at`, `actor_id`. Identity passed explicitly; `actor_id` recorded. Never the service-role client (NFR-FC1).
- Exposed via Admin-gated `POST /api/invoices/[id]/pay`, mirroring the `/issue` + `/send` auth chain (`requireUser` → `resolveAdminIdentity` → 401/403 before any DB access), zod-validated body, errors mapped to `AppError` codes and never leaking provider/DB detail. Client fn `recordPayment(slug, id, input)` added to `invoices-client.ts`.
- Mark-paid UI is a client island `InvoicePaymentActions` mounted on the issued view for `status = 'issued'` ONLY (hidden for draft/paid/void). Built via the `/web-uiux-architect` skill: WCAG AA, `useReducedMotion` respected, reuse `Button`/`Dialog`/`Input`/`Label` + Lucide. Method select; paid date defaults to today; amount defaults to the invoice total and is editable; optional reference.
- The Invoices list defaults to an Unpaid / Overdue receivables view derived AT READ TIME from `status` + `due_date`, uniform across every tenant regardless of generated schema: Unpaid = `status = 'issued'`; Overdue = an issued invoice whose `due_date` is before today (a derived label only). An "All" toggle shows every invoice. `overdue` is never written to `invoices.status`.
- invoices gain a nullable `due_date date` that the owner sets via an optional Due date field on the invoice draft form; it is stored on the draft (`save_invoice_draft`) and frozen by the immutability trigger after issue (it is not in the mutable whitelist). A blank due date means the invoice shows as Unpaid but never Overdue.
- All new user-facing copy added to `en.json` + `fr.json` with exact key parity, real French, straight apostrophes, no em-dashes.

**Never:**
- Never process, hold, move, or reconcile money; never integrate a payment processor (Stripe Connect / Interac) — out-of-band recording only (Phase 3 excluded).
- Never revert a paid invoice to issued (`paid→issued` is not whitelisted); corrections are via credit note (12.8). Never recompute totals or tax, mutate any frozen invoice column, or read live `records`/`business_profiles` on payment (I2/I3/I6 untouched).
- Never support partial or multiple payments in this story — exactly one payment row per invoice (`UNIQUE(invoice_id)`); partial/multiple payments are deferred.
- Never store an `overdue` status, add a cron/scheduler, or change the immutability triggers, numbering, the issue RPC's snapshot/token logic, or `ensureInvoicePdf`.

**Resolved decisions (from Open Questions):**
- due_date source: the owner enters an optional Due date on the invoice draft form (a date input). It is stored on the draft via `save_invoice_draft` and frozen at issue like every other invoice column. A blank due date is valid — that invoice is Unpaid but never Overdue. Chosen over auto-computing from `default_payment_terms` because that field is free-form text ("Net 30"); an explicit date respects owner intent without fragile parsing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mark paid, happy | issued invoice, valid method/paid_date/amount, current version | one `invoice_payments` row inserted; `status → paid`; version bumped; 200 | N/A |
| Already paid | `status = paid` | rejected, no insert | 409 `alreadyPaid` |
| Not issued | `status` draft/void | rejected, no insert | 409 `notIssued` |
| Stale version | `expected_version` ≠ current | rejected, no write | 409 `versionConflict` |
| Bad input | amount negative/non-finite, or paid_date not `YYYY-MM-DD` | rejected before DB | 400 validation |
| Non-admin / cross-org | member non-admin, or slug mismatch | rejected before DB | 401 / 403 |
| Receivables default | list loads | shows only `status = issued`, split Unpaid vs Overdue by `due_date < today`; "All" reveals every invoice | N/A |
| Overdue label | issued, `due_date` in the past | row flagged Overdue; DB `status` remains `issued` | N/A |
| No due date | issued, `due_date` null | shown as Unpaid, never Overdue | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20260928121300_invoice_payments.sql` -- NEW. Create `invoice_payments` (columns above), RLS `invoice_payments_tenant_isolation` mirroring `20260928120200_invoices.sql:73-76`, `UNIQUE(invoice_id)`, index on `invoice_id`. Do NOT reference it in `20260928121000_invoice_immutability_triggers.sql`.
- `supabase/migrations/20260928121400_record_invoice_payment.sql` -- NEW RPC `record_invoice_payment(p_org, p_invoice_id, p_expected_version, p_actor, p_method, p_paid_date, p_amount, p_reference)` (`security invoker`): version + `status='issued'` gate (raise a stable conflict marker), insert the payment, update status→paid. Mirror `20260928120900_issue_invoice.sql`.
- `supabase/migrations/20260928121250_invoice_due_date.sql` -- NEW. Add `due_date date` (nullable) to `invoices`.
- `src/types/db.ts` -- ADD `InvoicePaymentRow` and a `PaymentMethod` union; ADD `due_date: string | null` to `InvoiceRow` (254-294).
- `src/lib/data/invoice-mutate.ts` -- ADD `recordPayment(identity, {...})` + `RecordPaymentResult`, mirroring `issueInvoice` (265-444) and its error-marker→`AppError` mapping (174-176). Do NOT alter `InvoiceMutateIdentity` (56-63).
- `src/lib/data/invoices.ts` -- `listInvoices` (45-60) already `select("*")`; ensure `due_date` flows through (no signature change needed; derivation is at read time).
- `src/app/api/invoices/schemas.ts` -- ADD `recordPaymentSchema` (slug, version, method enum, paid_date `YYYY-MM-DD`, amount, reference?) + first-error-key helper, mirroring `sendBodySchema` (93-101).
- `src/app/api/invoices/[id]/pay/route.ts` -- NEW `POST`; copy the `[id]/issue/route.ts` auth chain and `[id]/send/route.ts` error handling verbatim.
- `src/lib/data/invoices-client.ts` -- ADD `recordPayment(slug, id, input)` (mirror `sendInvoice` 43-144) + export its payload type.
- `src/components/invoices/InvoicePaymentActions.tsx` -- NEW client island (mirror `InvoiceDeliveryActions.tsx`): dialog + form, `recordPayment` call, error→`t("error.{code}")`. Build via `/web-uiux-architect`.
- `src/components/invoices/InvoicesList.tsx` -- ADD an Unpaid / Overdue / All toggle (button-group; no Tabs primitive exists), derive Overdue from `due_date`, default to the receivables view. Reuse `ui/table`, `ui/badge`, `STATUS_VARIANT` (50-59).
- `src/app/[slug]/invoices/[id]/page.tsx` -- mount `InvoicePaymentActions` when `status === 'issued'` (near the existing `InvoiceDeliveryActions` mount).
- `src/components/invoices/InvoiceDraftForm.tsx` -- ADD an optional Due date input (WCAG AA, reuse existing form primitives); include it in the draft payload. Frozen at issue via the existing trigger — no issue-path change needed.
- `supabase/migrations/*_save_invoice_draft*.sql` (`20260928120400`, `20260928120600`) -- extend `save_invoice_draft` to persist `due_date` on the draft row. Mirror the existing param handling; add via a NEW migration, do not edit the applied files if the repo forbids it (follow the sequence convention).
- `src/lib/data/invoice-mutate.ts` (`saveInvoiceDraft`) + `src/app/api/invoices/schemas.ts` (draft schema) -- thread the nullable `due_date` (`YYYY-MM-DD` or null) through the draft save path.
- `src/lib/i18n/en.json` + `fr.json` -- ADD `Invoices.*` (mark-paid dialog/labels, payment-method options, receivables-tab labels, due-date column) + `Invoice.error.{alreadyPaid,notIssued}`. Exact key parity, real French, no em-dashes.
- Reference-only, do not modify: `20260928121000_invoice_immutability_triggers.sql`, the issue RPC's snapshot/token logic, `ensureInvoicePdf`, `resolveAdminIdentity`. Confirm the Supabase RPC + Next route-handler shape against `node_modules/next/dist/docs/` before coding.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20260928121250_invoice_due_date.sql` -- add nullable `due_date` to invoices.
- [x] `supabase/migrations/20260928121300_invoice_payments.sql` -- create `invoice_payments` + RLS + `UNIQUE(invoice_id)` + index.
- [x] `supabase/migrations/20260928121400_record_invoice_payment.sql` -- RPC that version/status-gates, inserts the payment, flips status→paid in one transaction.
- [x] `src/types/db.ts` -- add `InvoicePaymentRow`, `PaymentMethod`, and `due_date` on `InvoiceRow`.
- [x] `src/lib/data/invoice-mutate.ts` -- add `recordPayment` + result type.
- [x] `src/app/api/invoices/schemas.ts` + `src/app/api/invoices/[id]/pay/route.ts` -- NEW admin-gated pay route (validate body, call `recordPayment`).
- [x] `src/lib/data/invoices-client.ts` -- add `recordPayment` client fn.
- [x] `src/components/invoices/InvoicePaymentActions.tsx` -- NEW mark-paid island (via `/web-uiux-architect`).
- [x] `src/app/[slug]/invoices/[id]/page.tsx` -- mount it for `issued` only.
- [x] `src/components/invoices/InvoicesList.tsx` -- Unpaid/Overdue/All toggle defaulting to receivables; derive Overdue from `due_date`.
- [x] `src/components/invoices/InvoiceDraftForm.tsx` + `save_invoice_draft` RPC + draft schema/`saveInvoiceDraft` -- add the optional Due date input and persist `due_date` on the draft (frozen at issue).
- [x] `src/lib/i18n/en.json` + `fr.json` -- add all new keys with parity, real French, no em-dashes.
- [x] `tests/unit/route-invoice-pay.test.ts` -- NEW: happy 200, already-paid 409, not-issued 409, version-conflict 409, bad input 400, 401/403 gating (mirror `route-invoice-send.test.ts`).
- [x] `tests/integration/invoice-payment-db.test.ts` -- NEW (real test project): recording a payment inserts one row and flips status→paid; a second attempt is rejected; a stale version 409s; a payment row is still editable after the invoice is frozen (I7).

**Acceptance Criteria:**
- Given an issued invoice, when the Admin records a payment (method, date, amount, reference), then one `invoice_payments` row is written, `status` becomes `paid`, no money is processed, and the payment row remains mutable while the invoice itself stays immutable (I7 / FR91).
- Given the Invoices tab, when it loads, then it defaults to an Unpaid / Overdue view derived from `status` + `due_date` that works uniformly for every tenant regardless of generated schema, with an "All" view available (FR92).
- Given a non-Admin or a cross-org caller, when they call the pay route, then it is rejected (401/403) before any DB access, and the mark-paid control never appears for non-issued invoices.

## Implementation Notes

- Migrations applied to the Supabase test project via MCP. Applied timestamps differ from the repo file names (12.1-12.6 precedent): `invoice_due_date` = `20260929193345`, `save_invoice_draft_due_date` = `20260929193404`, `invoice_payments` = `20260929193416`, `record_invoice_payment` = `20260929193431`. Local files keep the spec-planned timestamps (`20260928121250`, `20260928121260`, `20260928121300`, `20260928121400`). Security advisor shows NO new findings — `invoice_payments` carries its `invoice_payments_tenant_isolation` `auth_org_ids()` policy; the remaining advisor items (org_members/pending_claims RLS-no-policy, `auth_org_ids` SECURITY DEFINER, leaked-password) are all pre-existing and unrelated (same set noted in 12.3-12.6).
- A NEW `save_invoice_draft` overload migration (`20260928121260`) was added to persist `due_date`, following the 12.3 precedent (drop the prior 12-arg overload, create a 13-arg one with `p_due_date date`) — the applied files were not edited. `invoice-mutate.ts`'s `saveInvoiceDraft` now passes `p_due_date: input.dueDate ?? null`.
- `due_date` is frozen at issue by EXTENDING `enforce_invoice_immutability` (in the `invoice_due_date` migration) to add `NEW.due_date is distinct from OLD.due_date` to the frozen-column drift check. It is NOT in the mutable whitelist, so once the invoice is non-draft any change to it raises `invoice_immutable`. The 12.5 one-time `null->value` `pdf_path` relaxation is preserved verbatim.
- `record_invoice_payment` (SECURITY INVOKER, `20260928121400`) mirrors `issue_invoice`: a version+status='issued'+org gate (0 rows -> `invoice_payment_conflict` P0001, NOT a retryable 40001), inserts exactly one `invoice_payments` row, then flips `issued->paid` (bumping version, recording actor) — all in one transaction. `UNIQUE(invoice_id)` turns a concurrent double-mark into a 23505, which `recordPayment` maps to 409 `alreadyPaid`. The precise `alreadyPaid` / `notIssued` reasons are surfaced by `recordPayment` from the loaded status BEFORE the RPC (the RPC's gate is the backstop). `invoice_payments` is deliberately OUTSIDE the immutability triggers (I7) — verified by the integration test that edits + deletes a payment row after the parent invoice is `paid`.
- The pay route (`/api/invoices/[id]/pay`) copies the `/send` auth chain verbatim (`requireUser` -> `resolveAdminIdentity` -> 401/403 before any DB access) and the zod-validated-body + `firstInvoiceErrorKey` -> `AppError` handling. Body: `slug`, required `version`, `method` enum, `paidDate` (`YYYY-MM-DD` with a real-calendar-date refine, shared with the draft `dueDate`), `amount` (finite positive), optional `reference`.
- The Invoices list defaults to the receivables view via a three-button group (`Unpaid` / `Overdue` / `All`; no Tabs primitive exists). `Unpaid` shows all `status='issued'` rows (each badged Unpaid or, when `due_date < today`, the derived `Overdue` label — computed at read time from the browser's local day, never a stored `overdue` status); `Overdue` narrows to only past-due issued rows; `All` shows every invoice. A new Due date column renders the stored `due_date` (or a placeholder). `InvoicesList` now imports `Button` alongside `buttonVariants`.
- `InvoicePaymentActions` (client island, built per `/web-uiux-architect`) mounts on the issued view for `status === 'issued'` ONLY (a dedicated branch in `page.tsx`, separate from the `DELIVERABLE_STATUSES` delivery-bar branch which also covers paid/overdue). Dialog + method `Select` + date (defaults to today) + amount (defaults to the invoice total, editable) + optional reference; WCAG AA, `useReducedMotion`-gated feedback; on success `router.refresh()` so the now-`paid` row re-renders without the control.
- i18n: added `Invoices.*` keys (due-date column/label/hint, receivables filter labels, mark-paid dialog/labels, the four `paymentMethod_*` options) + `Invoices.error.{methodInvalid,alreadyPaid,notIssued,dateInvalid}` to both `en.json` and `fr.json`. Note: the spec Code Map wrote `Invoice.error.{alreadyPaid,notIssued}`, but every existing invoice error code lives under the `Invoices.error.*` namespace (the top-level `Invoice` namespace is empty) — the new codes were added there for consistency with 12.4-12.6. en/fr key parity is exact (557 keys each) and neither has any em/en-dash in the new copy (verified programmatically; the four pre-existing dash offenders are outside the Invoices namespace and untouched).
- Verification: `npx tsc --noEmit` clean; `npm run lint` clean; `npm run build` succeeds (`/api/invoices/[id]/pay` in the route manifest). Full suite green: 810 tests / 75 files. The new unit route test (`route-invoice-pay.test.ts`, 10 cases) and the new real-DB integration test (`invoice-payment-db.test.ts`, 5 cases) both pass against the Supabase test project. The existing draft/issue/pdf integration fixtures were unaffected because `WritableDraft.dueDate` is OPTIONAL (defaulting to null in the mutation); only the `invoice-ensure-pdf.test.ts` `InvoiceRow` fixture needed a `due_date: null`.

- Matrix-audit closure (orchestrator pass, post-implementation): the three Invoices-list matrix rows (Receivables default / Overdue label / No due date) had no automated test — the derivation lived un-exported inside `InvoicesList.tsx`. Extracted the pure read-time logic to `src/lib/invoicing/receivables.ts` (`isInvoiceOverdue`, `filterInvoicesByView`, `ReceivablesView`) with `today` injected (clock-free), refactored `InvoicesList` to consume it, and added `tests/unit/invoice-receivables.test.ts` (8 cases covering all three rows: `unpaid` = issued-only, `overdue` = issued past due only, `all` = every status, and a null-due-date invoice Unpaid-but-never-Overdue). Re-verified: `tsc --noEmit` clean, `npm run lint` clean, full suite green at 818 tests / 76 files.

## Spec Change Log

## Review Triage Log

Review iteration 1 (blind-hunter, edge-case-hunter, verification-gap). No intent_gap/bad_spec → no loopback. Three patches (two verification-gap tests + one trivial input bound); the rest rejected (false or low).

**Patched:**
- `patch` · **verification gap [VG1]** · The owner-set `due_date` persistence has no end-to-end test: no test drives a non-null `dueDate` through `saveInvoiceDraft`, and `invoice-draft-db.test.ts`'s `invoiceRow` reader doesn't even select `due_date`. If the RPC dropped `due_date` the whole Overdue feature (FR92) would be dead with a green suite. Fix: save a draft with a non-null `dueDate`, read `invoices.due_date` back, assert it round-trips (and updates on re-save).
- `patch` · **verification gap [VG2]** · The `due_date` freeze-at-issue is untested: `invoice-issue-db.test.ts` asserts a frozen-column UPDATE (`total`) and DELETE are rejected but never a post-issue `due_date` UPDATE. Dropping the `NEW.due_date is distinct from OLD.due_date` clause would make an issued invoice's due date mutable undetected. Fix: assert an `update({ due_date })` on an issued invoice raises `invoice_immutable`.
- `patch` · **low but trivial, in-scope [ECH1]** · `recordPaymentSchema.amount` is validated finite/positive but not bounded to `numeric(15,2)`, so an out-of-range amount (e.g. 1e14) raises Postgres 22003 → the mutation's generic 500 `writeFailed` instead of the "bad input → 400" the matrix promises. Fix is a trivial `.max(9_999_999_999_999.99, "Invoice.error.amountInvalid")` on the existing validator (no new surface), so not auto-rejected as low.

**Rejected (false — verified the bad outcome cannot occur):**
- `false` · **i18n namespace split [BH4]** · zod emits `Invoice.error.*` (singular) while translations live under `Invoices.error.*` (plural). This is the EXISTING house pattern (the draft/send schemas already emit `Invoice.error.*` and `resolveError` strips the prefix before looking up `Invoices.error.*`); the client consumer handles it and the route unit test passes. Works and is consistent — not a new defect.
- `false` · **immutability-trigger boundary tension** · The spec's frozen "Always" clause requires `due_date` to be "frozen by the immutability trigger," which is only achievable by adding it to `enforce_invoice_immutability`'s frozen-column check; the frozen "Never change the immutability triggers" clause is about the transition whitelist, which is preserved byte-for-byte (issued→paid|void|overdue, paid→overdue; pdf_path one-time null→value intact). The code is the only coherent reading of the two frozen clauses; no bad outcome, and any "fix" would edit this build's frozen spec (barred).
- `false` · **round-trip untested for all methods [BH10b]** · Partly false: the happy integration case DOES assert `method`, `amount`, `reference`, and `actor_id` round-trip (`invoice-payment-db.test.ts`). Only the per-method fan-out is absent, which is low value (the method is a closed enum written verbatim).

**Rejected (low — negligible harm and/or fix adds undemonstrated surface):**
- `low` · **dead error branch + envelope type [BH1/BH2]** · `recordPayment` always throws on error and returns `{data, error:null}` on success, so the route's `if (result.error || !result.data)` never fires on the error path and the `Promise<ApiResponse<…>>` type implies an envelope it never returns. Works (thrown `AppError`s are caught by `handleError`); a developer-only inconsistency with no runtime harm, and aligning the type/behavior changes the signature.
- `low` · **duplicated `todayIso()` [BH3]** · The local-zone `YYYY-MM-DD` helper is duplicated in `InvoicePaymentActions` and `InvoicesList`. Both are identical and trivial; drift is unlikely and extracting adds a shared export.
- `low` · **no amount/total reconciliation [BH5]** · Recording any positive amount flips to `paid` regardless of the total. This is the frozen intent (amount defaults to total but is editable; single-payment-marks-paid; partial payments deferred) — excluded by the intent, not a defect.
- `low` · **future `paid_date` accepted [BH6]** · A calendar-valid future date passes. The matrix requires only `YYYY-MM-DD` validation; a bound is an undemonstrated guard the owner controls (they record what they received).
- `low` · **no inline error text for empty amount/date [BH7]** · The confirm button disables with `aria-invalid` on the amount field but shows no explanatory message. Baseline is reasonable (disabled + aria-invalid); a fix adds i18n + `aria-describedby` markup for a rare state.
- `low` · **draft-oriented `versionConflict` copy [BH8]** · The reused message says "This draft changed…" when paying an issued invoice. Reachable only via a rare version race (e.g. a concurrent PDF freeze); a payment-specific message adds an i18n key. Rare + fix adds surface.
- `low` · **cross-org/RLS-hidden id `notFound` untested [BH9]** · `recordPayment`'s `!loaded.data → 404` branch has no test. Cross-org is already covered at the route (403 slug mismatch); this is simple defensive degradation with no matrix row.
- `low` · **no DB `amount > 0` CHECK [BH10a]** · All writes go through the zod-validated route + RPC; the DB trusting the app layer is the codebase convention. A CHECK is an undemonstrated hardening.
- `low` · **`setTimeout` without cleanup [BH11]** · The 900 ms success timer isn't cleared on unmount. React 19 no-ops a setState after unmount and the normal path closes→refreshes; adding a mounted-ref/cleanup is complexity for no demonstrated harm.
- `low` · **`min={0}` vs strictly-positive [BH12]** · The number input advertises `0` while `amountValid` requires `>0` (submit disabled at 0). No functional bug; cosmetic native-control mismatch.
- `low` · **`invoiceTotalString` untested [VG-other]** · A server-component prefill formatter; its output is an editable default the server re-validates. Cosmetic, and page components aren't unit-tested in this repo.

## Design Notes

- Why `overdue` is derived, not stored: the AC frames the view as "derived from `status` + `due_date`", and MVP has no scheduler. Deriving the label at read time keeps `invoices.status` a clean `issued`/`paid` for the pay gate and avoids a cron that would otherwise be the only writer of an `overdue` row.
- Why one payment per invoice (`UNIQUE(invoice_id)`): the story is "mark invoices paid", out-of-band, no processing. A single full payment flipping to `paid` covers the intent; partial/multiple payments add reconciliation surface without a demonstrated MVP need and are deferred.

## Verification

**Commands:**
- `npm run test -- tests/unit/route-invoice-pay.test.ts tests/integration/invoice-payment-db.test.ts` -- expected: pass; full suite stays green.
- `npx tsc --noEmit` -- expected: no new type errors.
- `npm run lint` -- expected: clean.
- `npm run build` -- expected: succeeds (`/api/invoices/[id]/pay` in the route manifest).

**Manual checks:**
- On the authed Admin fixture against the dev app: issue an invoice, mark it paid, confirm status flips to Paid, the mark-paid control disappears, and one payment row exists. Confirm the Invoices tab defaults to Unpaid/Overdue and that an invoice past its `due_date` shows Overdue while its stored status stays `issued`. Toggle `fr` and confirm real French with no em-dashes.

**Manual review (Playwright, post-commit) — verified.** On the authed Admin fixture `/session-1f4fa453` (registered-Ontario Business Profile "Maple Leaf Plumbing Ltd.") against the running dev app on `localhost:3000`, exercising the rich path:
- The invoice draft form now carries the optional **Due date** field. Drafted a NEW invoice linked to **Bytown Electrical** with a due date of `2026-09-01`; the value persisted through save (and its frozen copy renders in the list). Issued it as **000007** (subtotal 200.00, HST 26.00, total 226.00).
- The issued view rendered the **Record a payment / Mark paid** section for the `issued` status (alongside the frozen Payment Instructions block and the delivery bar). The mark-paid dialog defaulted method **E-transfer**, date **today**, and amount **226.00** (the invoice total, editable). Recording it with reference `CONF-7788` flipped the status to **Paid**, the mark-paid control disappeared, and 000007 dropped out of the Unpaid view (it shows **Paid** with due date **Sep 1, 2026** under **All**). The atomic RPC's status flip is the proof the single `invoice_payments` row was written.
- Receivables view: defaults to **Unpaid** (only issued rows), with **Overdue** and **All** toggles; the Overdue view shows the empty state when nothing is past due. Issued a second standalone invoice **000008** with a past due date (`2026-08-15`); it renders the derived **Overdue** badge in the Unpaid view (its stored status stays `issued`) and is the sole row under the **Overdue** filter. Note: issuance is irreversible by design, so this left a permanent paid **000007** and overdue **000008** in the dev fixture org.
