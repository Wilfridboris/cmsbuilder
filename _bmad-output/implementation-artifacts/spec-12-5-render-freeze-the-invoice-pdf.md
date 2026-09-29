---
title: 'Story 12.5: Render & Freeze the Invoice PDF'
type: 'feature'
created: '2026-09-29'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'd7944917d19f2c89ce112def59e74cc0695bb90f'
context:
  - '_bmad-output/implementation-artifacts/epic-12-context.md'
  - '_bmad-output/implementation-artifacts/spec-12-4-issue-an-invoice-validate-number-freeze-identity-lock.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An issued invoice (Story 12.4) has a frozen number, snapshots, and a `share_token`, but no rendered artifact: there is no PDF, no `pdf_path`, and no storage bucket. The customer-facing document and the legally required six-year retention copy do not yet exist, and delivery (12.6) has nothing to send.

**Approach:** Add `@react-pdf/renderer` and a single in-house render path (`src/lib/invoicing/pdf.tsx`, I8) that produces a branded PDF from an issued invoice's frozen snapshots and stored line/tax/total rows only (I6 — never live records). Immediately after the issue transaction commits, an idempotent `ensureInvoicePdf` freezes a copy to a new private Supabase Storage bucket (`invoice-pdfs`) under the acting user's RLS client and writes the bucket-relative object key into a new `invoices.pdf_path` column (I5). A migration adds `pdf_path` and relaxes the immutability trigger to permit exactly one `null→value` write of that column on a non-draft invoice. The bucket has no expiry, so the immutable invoice rows plus their frozen PDFs satisfy the six-year retention (FR89).

## Boundaries & Constraints

**Always:**
- One shared render path (I8): `renderInvoicePdf(model): Promise<Buffer>` (`server-only`, `@react-pdf/renderer` `renderToBuffer`) built around a neutral `InvoiceDocumentModel` so credit notes (12.8) reuse it. It renders EXCLUSIVELY from `supplier_snapshot` / `customer_snapshot` (or the standalone-null case) plus the stored `invoice_line_items` / `invoice_tax_lines` / totals / `invoice_number` / `issue_date` / `language` (I6) — never from live `records` or `business_profiles`.
- Freeze to a new PRIVATE bucket `invoice-pdfs` (ca-central-1), object key `{organization_id}/{invoice_id}.pdf`, and store that bucket-relative key in `invoices.pdf_path` (I5). Upload and later read use the acting user's RLS-scoped Supabase client (`identity.client`) — NEVER the service-role client (NFR-FC1). Bucket RLS mirrors the existing `business-logos` bucket (org isolation via the object folder's first path segment `= any(auth_org_ids())`).
- `pdf_path` is a new nullable column. The immutability trigger `enforce_invoice_immutability` is altered to permit exactly one `null→value` write of `pdf_path` on a non-draft invoice (and only that column changing, alongside the already-permitted `updated_at`); a `value→value` change or a null overwrite of any other frozen column still raises `invoice_immutable` (I7).
- Freezing runs right after the issue RPC commits, via `ensureInvoicePdf(identity, invoiceId)`: idempotent (no-op when `pdf_path` is already set), it reloads the issued invoice, builds the model from snapshots, renders, uploads, and writes `pdf_path` (`update ... where id = :id and pdf_path is null`). A render/upload/write failure is reported through the same observability seam as `assertIssuable` and is swallowed — it never un-issues, never rolls back, and never fatally fails the already-committed issue request; `pdf_path` simply stays null and the `null→value` write remains available for a later retry.
- `share_token` is already minted once at issue (12.4, I4). 12.5 reuses it and NEVER re-mints or rotates it.
- Money in the PDF is rendered with CAD formatting via a shared client-safe `formatMoney(amount, language)` (`en-CA` `$1,234.56` / `fr-CA` `1 234,56 $`). All PDF copy resolves from `en`/`fr` labels for the invoice's `language`; real French, straight apostrophes, no em-dashes. The PDF carries the supplier legal + operating name and GST/HST number, and the structured Payment Instructions block from the supplier snapshot.
- Six-year retention (FR89) is satisfied structurally: the bucket has no lifecycle/expiry rule and both the invoice rows and their PDF objects are immutable. The offboarding-cascade EXCLUSION is a recorded constraint for the future offboarding work (Epic 8/13); see the resolved decision below.

**Never:**
- Never render from live `records`/`business_profiles` post-issue (snapshots only, I6). Never use the service-role client for invoice PDF read or write. Never overwrite an existing `pdf_path` (one-time `null→value`). Never let a PDF-freeze failure roll back or block issuance.
- Never build the public `/i/[token]` route, redirect to a signed storage URL, deliver the invoice (email / Web Share / SMS), add a Download/Copy-Link UI, track payments, or create credit notes — those are Stories 12.6–12.8. Never re-mint or rotate `share_token`.
- Never build the offboarding hard-delete cascade here (Epic 8/13).

**Resolved decisions (from Open Questions):**
- Offboarding retention exclusion (AC4): **Document + defer** (option A). 12.5 changes no foreign key. It records the exclusion as an explicit `deferred-work.md` constraint (citing this spec and the six-year retention requirement in `epic-12-context.md`) so the future offboarding cascade (Epic 8/13) is written to skip `invoices`/`credit_notes`/`invoice_payments` and their frozen PDFs. The existing `ON DELETE CASCADE` FKs stay as-is; no offboarding path hard-deletes an org row today, and retention becomes enforced once the offboarding cascade is built correctly.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Freeze on issue | A draft issued successfully (12.4) | `ensureInvoicePdf` renders from snapshots, uploads `{org}/{id}.pdf` to `invoice-pdfs`, sets `pdf_path`; the PDF is a valid `%PDF` document | N/A |
| Standalone invoice | Issued invoice with `customer_snapshot` null | PDF renders the "no linked customer" line (localized); freezes normally | N/A |
| French invoice | Issued invoice `language = 'fr'` | PDF labels + CAD amounts render in real French, no em-dashes | N/A |
| Idempotent re-run | `ensureInvoicePdf` on an invoice that already has `pdf_path` | No-op; no re-render, no second write | N/A |
| Freeze failure | Render or storage upload throws | Invoice stays issued; `pdf_path` stays null; failure reported via observability seam; issue request still returns success | logged, non-fatal, retryable |
| Trigger permits pdf_path | `null→value` write of `pdf_path` on an issued invoice | Permitted (once) | N/A |
| Trigger blocks re-write | `value→value` change of `pdf_path`, or any other frozen-column drift, on a non-draft invoice | Rejected by trigger | `invoice_immutable` (P0001) |
| Cross-org read | Member of org B requests org A's PDF object | Denied by bucket RLS | storage 403/empty |

</frozen-after-approval>

## Code Map

- `package.json` -- ADD `@react-pdf/renderer` (absent today; architecture-chosen over Puppeteer; ~React19/Next16-compatible). Next.js is 16.3.6, `@supabase/supabase-js` 2.105.4, `@supabase/ssr` 0.10.3.
- `src/lib/invoicing/pdf.tsx` -- NEW `server-only`. `renderInvoicePdf(model: InvoiceDocumentModel): Promise<Buffer>` via `renderToBuffer`; define `InvoiceDocumentModel` (supplier identity + payment block, optional customer, line items, tax line, totals, number, issue date, language) as the shared shape credit notes reuse (I8). Renders from snapshots only.
- `src/lib/invoicing/storage.ts` -- NEW. `uploadInvoicePdf(client, orgId, invoiceId, bytes)`, `invoicePdfObjectKey(orgId, invoiceId)` = `{orgId}/{invoiceId}.pdf`, bucket `invoice-pdfs`. Mirror `src/lib/storage/logo.ts`.
- `src/lib/storage/logo.ts` -- REFERENCE pattern only (`uploadLogo`, `logoObjectKey`, RLS-scoped client, private bucket). Do not modify.
- `src/lib/invoicing/tax.ts` -- ADD `formatMoney(amount, language)` (client-safe `Intl.NumberFormat` CAD, `en-CA`/`fr-CA`). REUSE `formatInvoiceNumber`; do not change existing money math (`computeInvoiceTotals` etc.).
- `src/lib/data/invoice-mutate.ts` -- ADD `ensureInvoicePdf(identity, invoiceId)` (idempotent: no-op if `pdf_path` set; else reload via `getInvoiceWithLineItems`, build model, render, upload, `update invoices set pdf_path=..., updated_at=now() where id=:id and pdf_path is null`; report failure via the observability seam, never throw to the issue caller). CALL it near the end of `issueInvoice` (after the `issue_invoice` RPC succeeds, ~after line 395, before returning), wrapped so its failure cannot overturn the issue result.
- `src/lib/data/invoices.ts` -- `getInvoiceWithLineItems`/`listInvoices` already `select("*")`; the `InvoiceRow` type change carries `pdf_path`.
- `src/types/db.ts` -- ADD `pdf_path: string | null` to `InvoiceRow` (after `share_token`).
- `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- ADD an `InvoicePdf.*` block: document title, invoice-number/issue-date labels, supplier ("From") + "Billed to" + standalone-customer line, line-item column headers, subtotal / HST / total labels, and payment-instructions labels (e-transfer, cheque payable-to + address, card link). Real French, no em-dashes; keep exact en/fr key parity.
- `supabase/migrations/20260928121100_invoice_pdf_column_and_immutability.sql` -- NEW. `ALTER TABLE invoices ADD COLUMN pdf_path text` (nullable); `CREATE OR REPLACE FUNCTION enforce_invoice_immutability()` to permit a one-time `null→value` write of `pdf_path` on a non-draft invoice (all other freezes intact). Apply via Supabase MCP; record the applied timestamp in Implementation Notes.
- `supabase/migrations/20260928121200_invoice_pdfs_bucket.sql` -- NEW. Create the private `invoice-pdfs` bucket + RLS policies mirroring `20260928120100_business_profile_logos_bucket.sql` (org isolation via first folder segment `= any(auth_org_ids())`), no lifecycle/expiry. Apply via Supabase MCP.
- `supabase/migrations/20260928121000_invoice_immutability_triggers.sql` -- REFERENCE: the `enforce_invoice_immutability()` body to `CREATE OR REPLACE` (frozen-column loop; allows `status`/`version`/`updated_at`/`actor_id`). Do not edit in place.
- Next.js 16 App Router; vitest (`tests/unit/`, `tests/integration/`). Verify the render runs in the Node runtime and confirm `@react-pdf/renderer` server usage against `node_modules/next/dist/docs/` before coding.

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- add `@react-pdf/renderer`; run install so the lockfile updates.
- [x] `supabase/migrations/20260928121100_invoice_pdf_column_and_immutability.sql` -- add `pdf_path`; `CREATE OR REPLACE` the immutability trigger to permit one-time `null→value` on `pdf_path`. Apply via MCP.
- [x] `supabase/migrations/20260928121200_invoice_pdfs_bucket.sql` -- create private `invoice-pdfs` bucket + org-scoped RLS (mirror the logos bucket). Apply via MCP.
- [x] `src/types/db.ts` -- add `pdf_path` to `InvoiceRow`.
- [x] `src/lib/invoicing/tax.ts` -- add `formatMoney(amount, language)`.
- [x] `src/lib/invoicing/pdf.tsx` -- NEW render path + `InvoiceDocumentModel`.
- [x] `src/lib/invoicing/storage.ts` -- NEW upload/object-key helpers for `invoice-pdfs`.
- [x] `src/lib/data/invoice-mutate.ts` -- add idempotent `ensureInvoicePdf`; call it post-issue (non-fatal).
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add the `InvoicePdf.*` keys (real French, no em-dashes, key parity).
- [x] `tests/unit/invoice-pdf.test.ts` -- NEW: `renderInvoicePdf` returns a `%PDF` buffer for en, fr, and a standalone (null customer) model; `formatMoney` formats en-CA and fr-CA correctly.
- [x] `tests/integration/invoice-pdf-freeze-db.test.ts` -- NEW (real Supabase test project): issue a draft then `ensureInvoicePdf` → `pdf_path` set and the object downloads as a `%PDF`; a second `ensureInvoicePdf` is a no-op; the trigger permits the `null→value` write once and rejects a subsequent `value→value` `pdf_path` change on the issued invoice (`invoice_immutable`); a cross-org client cannot read the object.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- confirm the offboarding-retention exclusion constraint entry exists (added at approval), so Epic 8/13 excludes invoices/credit-notes/payments/PDFs from the cascade. No FK change in 12.5.

**Acceptance Criteria:**
- Given an invoice being issued, when the issue transaction commits, then a PDF is rendered in-house with `@react-pdf/renderer` from the invoice's frozen snapshots (one render path shared with future credit notes) and a copy is frozen to the private `invoice-pdfs` bucket with the bucket-relative object key stored in `invoices.pdf_path` (FR89, I5, I8).
- Given an already-issued (immutable) invoice, when `pdf_path` is first written, then the immutability trigger permits that single `null→value` write while still rejecting every other frozen-column change; a PDF-freeze failure leaves the invoice issued with `pdf_path` null and is retryable, never rolling back the issue (I7).
- Given the frozen invoice rows and PDF objects, when retention is considered, then both are immutable and the storage bucket has no expiry, satisfying the six-year retention obligation (FR89); and the offboarding-cascade exclusion is recorded per the resolved Open Question.
- Given a `fr` invoice or a standalone invoice, when the PDF is rendered, then all copy is real French with no em-dashes and CAD amounts, and the missing customer renders as a localized "no linked customer" line — and the render never reads live records/business_profiles (I6).

## Implementation Notes

- `@react-pdf/renderer` added at `4.9.0` (`package.json` `^4.9.0`; lockfile updated, 48 packages). It is on Next.js 16's automatic `serverExternalPackages` opt-out list (verified in `node_modules/next/dist/docs/.../serverExternalPackages.md`), so NO `next.config.ts` change was needed — the render module bundles/externals correctly for the Node runtime and `npm run build` succeeds (exit 0; the only build warning is the pre-existing OpenTelemetry/Prisma "critical dependency" from the Sentry SDK's transitive deps, unrelated to this story).
- Migrations applied to the Supabase test project via MCP. Applied timestamps differ from the repo file names (12.1-12.4 precedent): `invoice_pdf_column_and_immutability` = `20260929151404`, `invoice_pdfs_bucket` = `20260929151412`. Local files keep the spec-planned timestamps (`20260928121100`, `20260928121200`). Security advisor after the change shows NO new findings — the four pre-existing items (org_members/pending_claims RLS-no-policy, `auth_org_ids` SECURITY DEFINER exec, leaked-password) are the same set noted in 12.3/12.4; the new `invoice-pdfs` bucket's org isolation is enforced by the four `storage.objects` policies mirroring `business-logos`.
- `renderInvoicePdf(model)` (`src/lib/invoicing/pdf.tsx`, `server-only`) is the single shared render path (I8) built around a neutral `InvoiceDocumentModel` (document-shaped, `documentType` field so credit notes reuse it). It renders EXCLUSIVELY from the model (I6): supplier/customer snapshot fields + stored line items / tax line / totals / number / issue date / language. Copy resolves from the `InvoicePdf.*` block of the en/fr catalog picked by the model's OWN `language` (imported directly, NOT via the request-cookie locale) so a `fr` invoice always renders French. Uses built-in Helvetica (no external font fetch) for a deterministic Node render. Money renders via the shared client-safe `formatMoney(amount, language)` (`Intl.NumberFormat` CAD, `en-CA` / `fr-CA`) added to `tax.ts`.
- `ensureInvoicePdf(identity, invoiceId)` (`invoice-mutate.ts`) is idempotent and NEVER throws: it reloads the issued invoice under RLS, no-ops when the row is missing / still a draft / already has `pdf_path`, builds the model from frozen snapshots, renders (I8), uploads to `invoice-pdfs` under the acting user's RLS client (`uploadInvoicePdf`, `upsert:false`), and writes `pdf_path` with `update ... where id=:id and pdf_path is null`. Any render/upload/write failure is reported via `reportError` (the same observability module `assertIssuable` uses) and swallowed — `pdf_path` stays null and the one-time `null->value` write remains for a retry. It is `await`ed near the end of `issueInvoice` AFTER the RPC commits (so a fast freeze is visible immediately), wrapped so its failure cannot overturn the already-committed, returned issue result.
- The immutability trigger (`20260928121100_..._immutability.sql`) is the 12.4 `enforce_invoice_immutability` body with a single relaxation: `pdf_path` is removed from the frozen-column drift check and instead allowed to change ONLY as `null->value` on a non-draft invoice. A `value->value` change and a `value->null` overwrite both fall through to `invoice_immutable` (P0001). The child triggers and all other 12.4 freezes are untouched. The bucket migration mirrors `business_profile_logos_bucket.sql` exactly (private bucket, four `path_tokens[1] = any(auth_org_ids())` policies), with NO lifecycle/expiry rule so the immutable rows + frozen PDFs satisfy the six-year retention (FR89).
- i18n: added an `InvoicePdf.*` block (document title, number/date labels, From/Billed-to/standalone-customer, GST/HST label, line-item column headers, subtotal/HST(`taxLineLabel`)/total, and the payment-instructions labels) to both `en.json` and `fr.json` with exact key parity (21 keys each) and no em-dashes; real French (`TVH`, `Numéro de TPS/TVH`, `Virement Interac`, `Chèque à l'ordre de`, straight apostrophes, French `%` spacing in `taxLineLabel`).
- `deferred-work.md` already carries the offboarding-retention exclusion constraint entry for this spec (added at approval): the future Epic 8/13 cascade must skip invoices/credit_notes/invoice_payments and their frozen `invoice-pdfs` (and snapshot-referenced `business-logos`) objects while under statutory retention. No FK change in 12.5.
- Verification: `npx tsc --noEmit` clean; `npm run lint` clean (src); `npm run build` exit 0. Full suite green: 765 tests / 68 files (up from 747 — the new `tests/unit/invoice-pdf.test.ts` (7 cases: en/fr/standalone `%PDF` render + `formatMoney` en-CA/fr-CA/whole/NaN) and `tests/integration/invoice-pdf-freeze-db.test.ts` (4 cases against the real Supabase test project: freeze sets `pdf_path` + object downloads as `%PDF`; second `ensureInvoicePdf` is a no-op; trigger permits the `null->value` write once and rejects `value->value` + `value->null`; a cross-org client cannot read the object). The existing 12.4 `invoice-issue-db.test.ts` still passes with the PDF freeze now wired into `issueInvoice`.
- Matrix-audit fix (added during verification): the "Freeze failure" I/O-matrix row was not covered by the two spec-listed test files, so `tests/unit/invoice-ensure-pdf.test.ts` was added — two cases (render-throws and upload-throws) asserting `ensureInvoicePdf` resolves without throwing, calls `reportError`, and attempts no `pdf_path` write (via `vi.mock`/`vi.hoisted` of the pdf/storage/invoices/observability modules). Full suite now 767 tests / 69 files; `tsc --noEmit` and `lint` remain clean.

## Spec Change Log

## Review Triage Log

Review iteration 1 (blind-hunter, edge-case-hunter, verification-gap). No intent_gap/bad_spec → no loopback. Four patches; the rest rejected (false or low).

**Patched:**
- `low` · **patch** · `ensureInvoicePdf` (`invoice-mutate.ts`) built the model's customer label as `customer_snapshot.display_label ?? customerLabel`, where `customerLabel` comes from the live `getInvoiceWithLineItems`→`resolveCustomerLabel` read — so a later re-freeze could inject a post-issue live-`records` value into the immutable PDF, contradicting the explicit I6 "snapshots only" invariant. Fix: render from `customer_snapshot.display_label` alone and drop the now-unused `customerLabel` destructure. [ECH-1]
- `low` · **patch** · The line-item quantity rendered as a raw `{item.quantity}` (`pdf.tsx`), so a fractional quantity (e.g. 2.5 hours) used a dot decimal even on a `fr` invoice whose CAD money in the same row uses a comma. Fix: added `formatQuantity(quantity, lang)` (`Intl.NumberFormat` `en-CA`/`fr-CA`). [BH-1]
- `low` · **patch** · Two of the three non-catch `reportError` calls in `ensureInvoicePdf` omitted the `stage: "ensureInvoicePdf"` tag the catch-all carries, so a log query filtered by stage would miss the load / missing-supplier / write-error failures — weakening the "reported via the observability seam" contract. Fix: added the `stage` tag to all three. [BH-8]
- `patch` · **verification gap** · The PDF unit tests asserted only the `%PDF-` magic bytes, so a branch-collapse regression (always the `en` catalog, always the standalone-customer line, or a dropped tax label) would still emit a valid `%PDF` and pass every test — leaving AC4's language / standalone-customer / tax-presence behaviors unverified. Fix: extracted the pure `resolveInvoicePdfStrings(model)` from the render tree (exported) and added five deterministic branch assertions (en→`Invoice`/`HST (13%)`, fr→`Facture`/`TVH`, null customer→`No linked customer`/`Aucun client lié`, null tax→empty label, legal+operating supplier heading). [VG-1 / BH-7]

**Rejected (false — verified the bad outcome cannot occur):**
- `false` · `taxLines.length >= 2` dropping the tax row — an issued invoice (the only kind `ensureInvoicePdf` renders) can never have >1 tax line: 12.4's `assertIssuable` blocks `taxSplit` at issue, so `taxLines.length === 1 ? taxLines[0] : null` is correct for the reachable set {0,1}. [ECH-2]
- `false` · Empty line-items rendering a header-only table — not reachable: `assertIssuable` blocks `lineItemsRequired`, so an issued invoice always has ≥1 line item. [ECH-3]
- `false` · No totals-consistency (`subtotal + tax = total`) check in the renderer — redundant: the stored `subtotal`/`tax_total`/`total` were verified equal to a fresh recomputation by `assertIssuable` at issue (I2); the PDF renders already-verified figures. [BH-2]

**Rejected (low — negligible harm and/or fix adds undemonstrated complexity):**
- `low` · Supplier `mailing_address` omitted from the PDF — the story scoped PDF content to legal/operating name + GST/HST + the payment-instructions block (which includes `payment_cheque_address` for mail-cheque needs); a separate mailing address is outside that content spec. [BH-3]
- `low` · `documentType` unused / title hardcoded to the invoice key — a deliberate forward seam for credit notes (12.8); for an invoice the title is correctly `documentTitle`. No harm in 12.5. [BH-4]
- `low` · No PDF filename / `Content-Disposition` — download/serve UX is Story 12.6 (delivery); 12.5 only freezes bytes + the object key. Out of scope by intent. [BH-5]
- `low` · `formatMoney` hardcodes CAD under a generic name; `InvoiceLanguageCode` duplicates `InvoiceLanguage` — MVP is CAD/Ontario-only, and a real language-type divergence would surface as a `tsc` error at the call boundary, not silent drift. [BH-6]
- `low` · Cross-org read integration test accepts an error OR a non-`%PDF` body — RLS is all-or-nothing (deny → error, or empty body); the existing `%PDF-` magic assertion already fails on any real-PDF leak, so a "truncated partial-PDF" leak is not a reachable RLS outcome. Not tightened (an unverifiable-here integration assertion risks flakiness). [BH-9]
- `low` · `afterAll` cleans storage objects only for the primary org — the second org never freezes a PDF in these tests, so no orphaned objects exist; a speculative future-test concern. [BH-10]
- `low` · Migration filename timestamps diverge from the applied timestamps — the established 12.1–12.4 epic convention (local files keep planned timestamps; the test project records applied ones), documented in Implementation Notes; not introduced by this story. [BH-11]
- `low` · `ensureInvoicePdf` is awaited inside `issueInvoice`, adding unbounded latency — a deliberate spec choice (freeze visible immediately); the freeze is best-effort/retryable and a timeout/out-of-band worker is an undemonstrated later-phase seam. [BH-12]
- `low` · The `pdf_path` write-error branch is untested — it only reports and leaves `pdf_path` null (the intended retryable outcome); the swallow-and-never-throw contract is already covered by the two `ensureInvoicePdf` failure-mode unit tests. [VG-note]

## Design Notes

- Why freeze right after issue (not lazily "on send"): the story sequences render/freeze (12.5) BEFORE delivery (12.6), and FR89 makes the frozen PDF the retention record of an already-finalized document. The architecture's looser "on send" phrasing is superseded by this decomposition. Because issuance is irreversible (the number is minted and the row is immutable), the PDF step must live OUTSIDE the DB transaction and be best-effort + retryable — hence the one-time `null→value` `pdf_path` relaxation and the idempotent `ensureInvoicePdf` (which 12.6 delivery can also call before sending, and 12.8 reuses for credit notes).
- Why RLS client, not service-role: uploads and reads are tenant data (NFR-FC1). The acting admin is an org member, so the mirrored `business-logos` RLS (`(storage.foldername(name))[1] = any(auth_org_ids())`) authorizes writes to `{org_id}/...` without the service-role key.
- Why the render reads only snapshots (I6): the PDF must match exactly what was issued even if the live customer/business record later changes; `customer_record_id` is a back-reference only.

## Verification

**Commands:**
- `npm run test -- tests/unit/invoice-pdf.test.ts tests/integration/invoice-pdf-freeze-db.test.ts` -- expected: all pass; full suite stays green.
- `npx tsc --noEmit` -- expected: no new type errors.
- `npm run lint` -- expected: clean.
- `npm run build` -- expected: succeeds (the render module bundles in the Node runtime).

**Manual checks:**
- Issue a valid registered-Ontario draft as an Admin; confirm the issued invoice row gains a `pdf_path` and the object exists in the `invoice-pdfs` bucket at `{org}/{id}.pdf` and opens as a branded PDF showing the supplier legal + operating name, GST/HST number, line items, the single HST line, CAD totals, and the payment-instructions block. Re-run issue flow logic to confirm idempotency. Toggle `fr` and confirm the PDF is real French with no em-dashes.

**Manual review (Playwright, post-commit) — verified.** On the authed Admin fixture `/session-1f4fa453` (GST/HST-registered Ontario Business Profile "Maple Leaf Plumbing Ltd.") against the running dev app on `localhost:3000`: created a standalone draft (one line, quantity **2.5** × 120.00 → 300.00 / HST 39.00 / 339.00 shown live), then **Issue invoice**. The confirm dialog showed the irreversibility warning; confirming flipped to the read-only issued view (**Invoice 000002**, Issued, Sept 29 2026, frozen supplier identity `123456789 RT0001`, "No linked customer"). A Supabase query then confirmed the FREEZE landed end-to-end in the real app: `invoices.pdf_path = 1f4fa453-…/e1da3ff4-….pdf` (the `{org_id}/{invoice_id}.pdf` layout, I5), and the matching `storage.objects` row exists in the private `invoice-pdfs` bucket with `mimetype = application/pdf`, `size = 2830` bytes — i.e. `renderInvoicePdf` → `uploadInvoicePdf` → the one-time `null→value` `pdf_path` write (through the relaxed immutability trigger) all succeeded on a live issue. The `fr` copy, standalone line, quantity comma-decimal, and no-tax branches are covered deterministically by the `resolveInvoicePdfStrings`/`formatQuantity` unit tests rather than re-checked visually (the PDF has no in-app view until delivery, 12.6). Note: issuance is irreversible by design, so this left a permanent issued `000002` in the dev fixture org (cannot be discarded — that is the story's point).
