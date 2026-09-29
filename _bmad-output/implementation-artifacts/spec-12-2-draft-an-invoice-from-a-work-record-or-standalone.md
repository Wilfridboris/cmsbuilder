---
title: 'Story 12.2: Draft an Invoice (from a Work Record or Standalone)'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'dispatch'
baseline_commit: '958d0a1be2de0d925c3de9f5382088bf0a0ee946'
review_loop_iteration: 0
context:
  - '_bmad-output/implementation-artifacts/epic-12-context.md'
  - '_bmad-output/implementation-artifacts/spec-12-1-business-profile-capture-company-identity-once.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 12 turns finished work into money, but there is no way yet to start an invoice. An Admin needs to draft a billable invoice — either from an existing work/customer record or from scratch — capturing line items now, so that later stories (12.3 totals/HST, 12.4 issue/number/lock, 12.5 PDF) have a draft to compute on, freeze, and render.

**Approach:** Introduce two dedicated typed platform tables, `invoices` and `invoice_line_items` (not the JSONB records store), with tenant isolation via the same `auth_org_ids()` resolver as `records`. Add an Admin-only Invoices area under the tenant workspace to create a draft (optionally linked to any record via a loose `customer_record_id`), edit its line items, and save. Drafting only: it stores `status = 'draft'`; it never computes HST, freezes snapshots, mints a number, renders a PDF, or issues.

## Boundaries & Constraints

**Always:**
- Two typed tables. `invoices`: `id`, `organization_id`, nullable loose `customer_record_id` (FK -> `records.id` `ON DELETE SET NULL`), `place_of_supply_province` (text), `language` (text `CHECK IN ('en','fr')`), `status` (text `CHECK IN ('draft','issued','paid','overdue','void')`), `version` (int, optimistic concurrency), `actor_id`, `created_at`, `updated_at`. `invoice_line_items`: `id`, `invoice_id` (FK -> `invoices.id` `ON DELETE CASCADE`), denormalized `organization_id`, `description` (text), `quantity` (numeric), `unit_price` (numeric), `amount` (numeric), `sort_order` (int), `created_at`, `updated_at`. Both: `enable row level security` + one `..._tenant_isolation` policy `organization_id in (select public.auth_org_ids())` for `all`, mirroring `20260928120000_business_profiles.sql`.
- Define the full `status` CHECK set now so 12.3–12.8 need no ALTER; Story 12.2 only ever writes `status = 'draft'`. Invoice-level money totals (`subtotal`/`tax_total`/`total`) and `supplier_snapshot`/`customer_snapshot`/`invoice_number`/`share_token`/`pdf_path` are added by later stories, not here.
- Line `amount = round(quantity × unit_price, 2)` is computed server-side by a single new canonical helper `computeLineAmount` in `src/lib/invoicing/tax.ts` and stored; it is the ONLY line-amount implementation (Invariant I2). Story 12.3 extends this same `tax.ts` with subtotal/total/HST — it must not re-implement line amount. A draft may show a client-side running subtotal for display, but no invoice-level total column is written in 12.2.
- Parent invoice and its full line-item set are written atomically. A single `security invoker` Postgres function `save_invoice_draft(...)` upserts the invoice row and replaces its line items in one transaction under the caller's RLS; `invoice-mutate.ts` invokes it via the RLS-scoped client, never the service-role client, passing explicit `{ client, actorId, orgId }` and recording `actor_id`.
- Updates are gated on `version` (expected version mismatch or a non-`draft` row -> `409` `Invoice.error.versionConflict`), mirroring the `records` `mutate.ts` optimistic-concurrency pattern.
- Standalone drafts have `customer_record_id = null`. When a record is linked, the draft stores only the id (no snapshot — Invariant I6; snapshots are 12.4). The linked customer's display label is resolved for display via `getSchema` + `resolvedDisplayFieldKey` at read time; it is never stored as a render source. Linking works for any tenant table regardless of how the workspace schema was generated (FR82).
- Decision (province): a new draft's `place_of_supply_province` defaults to the Business Profile's `jurisdiction` (Story 12.1), falling back to `ON` when unset, and is rendered as an editable field. It is never inferred from a linked record's JSONB fields.
- Decision (pre-fill): linking a record pre-fills only the loose `customer_record_id` and the record's resolved display label shown as the customer; line items always start empty for the Admin to add. No line item is seeded from record data and there is no field-mapping UI.
- Admin-only: both the Invoices pages and every `/api/invoices*` route enforce `getCurrentUser` -> `resolveOrgIdentity` -> `requireAdmin` (+ slug/membership match) before any DB access; non-Admin `403`, unauthenticated `401`. Use the `{ data, error }` envelope where `error` is a translation KEY, never raw copy/stack/SQL.
- All strings via next-intl (`Invoices` namespace, en + fr, real French, no em-dashes, no hardcoded copy). UI meets the platform a11y baseline (labeled inputs, keyboard operable, >=48px targets, WCAG AA, reduced-motion) and is built following the `/web-uiux-architect` skill, reusing `src/components/ui` primitives.

**Never:**
- Never write to `records`, `org_schemas`, or any tenant JSONB table; never store invoice data in the records store.
- Never compute HST/tax, write invoice-level totals, freeze a supplier/customer snapshot, mint an `invoice_number` or `share_token`, render a PDF, implement `assertIssuable`, or transition a draft to `issued`/`paid`/`void` (those are 12.3–12.8). No tax/number/snapshot/PDF columns are populated here.
- Never use the service-role client for this data; never expose raw errors or SQL to the client.
- Never attempt to auto-detect a "province" or "line items" field inside an arbitrary tenant record's JSONB — the schema carries no semantic field tagging.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List, none | Admin opens Invoices, no rows | `GET /api/invoices` returns `{ data: [] }`; empty-state renders | N/A |
| List, existing | Admin opens, drafts exist | Returns the org's invoices (newest first); list renders | N/A |
| Create standalone | Admin saves a valid draft, no link | Invoice inserted `status='draft'`, `customer_record_id=null`, `version=1`; line items inserted with computed `amount`; created invoice returned | N/A |
| Create from record | Admin links a record then saves | Same, with `customer_record_id` set to the chosen record's id | N/A |
| Edit draft | Admin re-saves with changed lines + correct `version` | Same row updated (`version` bumped), line items fully replaced atomically | N/A |
| Stale/locked edit | Save with wrong `version`, or row not `draft` | Rejected, nothing written | `Invoice.error.versionConflict` (409) |
| Empty line item | Save a line with blank description | Rejected, field error, no write | `Invoice.error.descriptionRequired` (400) |
| Bad quantity/price | Non-numeric or negative quantity/unit_price | Rejected, field error, no write | `Invoice.error.amountInvalid` (400) |
| No line items | Save a draft with zero line items | Rejected (a draft needs >=1 line) | `Invoice.error.lineItemsRequired` (400) |
| Linked record missing | Linked record was soft-deleted | Draft still loads; label shows a translated "unavailable" note; no crash | N/A |
| Cross-org link | `customer_record_id` not in caller's org | Rejected before write (RLS + membership) | `Invoice.error.customerRecordInvalid` (400) |
| Discard draft | Admin discards a `draft` | Row hard-deleted (cascade removes line items) | N/A |
| Discard non-draft | Discard requested on a non-`draft` row | Rejected (immutability is 12.4; drafts only here) | `Invoice.error.notDraft` (409) |
| Non-Admin / no session | Member, anon, or missing session on any route | Rejected before any access | `forbidden` (403) / `unauthorized` (401) |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20260928120000_business_profiles.sql` -- MIRROR the CREATE TABLE + `enable row level security` + single `..._tenant_isolation` `auth_org_ids()` policy + header-comment convention. Latest existing timestamp is `20260928120100`; new files follow it. Apply via Supabase MCP (test project).
- `supabase/migrations/20260924055022_platform_schema.sql` -- `records` (`id`, `organization_id`, `table_key`, `data` jsonb, `version`, soft-delete `deleted_at`) and `org_schemas` (`definition` jsonb); `customer_record_id` FKs into `records.id`. Reference only; do NOT modify.
- `src/lib/data/business-profile-mutate.ts` -- EXEMPLAR to mirror: `{ client, actorId, orgId }` identity, RLS-scoped client, `ApiResponse<T>` return, never service-role. New `invoice-mutate.ts` follows it.
- `src/lib/data/mutate.ts` -- `records` optimistic-concurrency exemplar: `expectedVersion` -> `409 versionConflict` on 0 rows, bump `version`. Mirror the version semantics.
- `src/lib/data/records.ts` -- REUSE `getSchema(client, orgId)`, `resolveRecordLabels(client, orgId, targetTableKey, displayFieldKey, ids)`, `searchRelationRecords(client, orgId, targetTableKey, displayFieldKey, query, limit)` for the linked-record picker + label resolution.
- `src/lib/schema/relations.ts` -- REUSE `resolvedDisplayFieldKey(table)` to pick a record's display label.
- `src/lib/api/route-helpers.ts` -- REUSE `resolveOrgIdentity(slug, actorId)`, `json`, `handleError`, `AppError`, `{ data, error }` envelope.
- `src/lib/auth/{session,rbac,org}.ts` -- REUSE `getCurrentUser()`, `requireAdmin(user, adminClient)`; same gate as Business Profile + Invite.
- `src/app/api/business-profile/{route.ts,schemas.ts}` -- ROUTE + Zod exemplar: named exports, `export const dynamic="force-dynamic"`, auth-before-body-validation ordering, slug in query (GET/DELETE) / body (POST/PUT), Zod refinement messages carry `Invoice.error.*` KEYs (never leak Zod defaults -> map unknown to `genericError`).
- `src/lib/data/business-profile-client.ts` -- CLIENT-helper exemplar: `InvoiceApiError extends Error { code }`, `parseEnvelope<T>`, typed fetch wrappers. New `invoices-client.ts` mirrors it.
- `src/types/db.ts` -- ADD `InvoiceRow`, `InvoiceLineItemRow`, `InvoiceStatus`; follow the hand-written snake_case row-type + enum-union convention (see `BusinessProfileRow`, line 178). `BusinessProfileRow.jurisdiction` + `default_language` are the province/language defaults.
- `src/components/settings/{BusinessProfileForm,InviteForm}.tsx` -- FORM exemplar: `useState` flow, GET-load then save, `useId`, `role="alert"` errors, translation-key error mapping, `AnimatePresence` motion success, `useReducedMotion`, `useTranslations`.
- `src/components/dashboard/RecordsView.tsx` + `src/components/ui/{table,input,label,select,textarea,button,card,dialog,badge,skeleton}.tsx` -- REUSE table/card/dialog primitives for the line-items editor and invoices list. No new design system.
- `src/components/layout/DashboardNav.tsx` -- ADD an Admin-gated Invoices link (lucide `FileText`), `t("invoices")`, mirroring the existing role-gated links.
- `src/app/[slug]/{settings,import}/page.tsx` + `layout.tsx` -- PAGE convention for a new Admin-gated tenant area.
- `src/lib/i18n/{en.json,fr.json}` -- ADD `Invoices` namespace (labels/hints/placeholders, list + empty-state, line-item add/remove, save/saving/loading, `savedTitle`/`savedBody`, full `error.*`). Real French, no em-dashes.
- Next.js 16 App Router, vitest (`tests/unit/`). Verify Next APIs against `node_modules/next/dist/docs/` before coding.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20260928120200_invoices.sql` -- create typed `invoices` (columns per Boundaries), full `status` CHECK, `version` default 1, FK `customer_record_id -> records(id) ON DELETE SET NULL`; enable RLS; add `invoices_tenant_isolation` `auth_org_ids()` policy. Apply via Supabase MCP.
- [x] `supabase/migrations/20260928120300_invoice_line_items.sql` -- create typed `invoice_line_items` (columns per Boundaries) with denormalized `organization_id`, FK `invoice_id -> invoices(id) ON DELETE CASCADE`, index on `(invoice_id, sort_order)`; enable RLS; add `invoice_line_items_tenant_isolation` `auth_org_ids()` policy. Apply via Supabase MCP.
- [x] `supabase/migrations/20260928120400_save_invoice_draft.sql` -- `security invoker` function `save_invoice_draft(p_org uuid, p_invoice_id uuid, p_expected_version int, p_customer_record_id uuid, p_province text, p_language text, p_actor uuid, p_line_items jsonb)`: insert new invoice when `p_invoice_id` is null (else update where `id=p_invoice_id and version=p_expected_version and status='draft'`, raising a distinguishable error on 0 rows), bump `version`, delete + re-insert its line items from `p_line_items`, return the invoice id + version. Amounts arrive precomputed (no SQL re-implementation of line amount). Apply via Supabase MCP.
- [x] `src/types/db.ts` -- add `InvoiceStatus`, `InvoiceRow`, `InvoiceLineItemRow` mirroring every column.
- [x] `src/lib/invoicing/tax.ts` -- add `computeLineAmount(quantity, unitPrice): number` (round to 2 decimals); the sole canonical line-amount computation (I2), which 12.3 extends.
- [x] `src/lib/data/invoice-mutate.ts` -- `saveInvoiceDraft(identity, input)` (create/update via the RPC, computing each line `amount` with `computeLineAmount`, mapping the 0-row/non-draft error to `versionConflict`/`notDraft`) and `discardInvoiceDraft(identity, invoiceId)` (hard-delete only when `status='draft'`, else `notDraft`). RLS-scoped client only; record `actor_id`. Mirror `business-profile-mutate.ts`.
- [x] `src/lib/data/invoices.ts` -- read helpers: `listInvoices(client, orgId)` (newest first) and `getInvoiceWithLineItems(client, orgId, invoiceId)` returning the invoice, ordered line items, and the resolved customer display label (via `getSchema` + `resolvedDisplayFieldKey`; graceful when the record is missing/soft-deleted).
- [x] `src/app/api/invoices/schemas.ts` -- Zod: draft body (optional `customerRecordId` uuid, optional `province`, `language` enum, `version` for updates, `lineItems[]` each with non-empty `description`, numeric non-negative `quantity`/`unitPrice`, >=1 line required); failures carry `Invoice.error.*` KEYs; `toWritable`-style transform to snake_case.
- [x] `src/app/api/invoices/route.ts` -- `GET` (slug in query) lists the org's invoices; `POST` (slug in body) creates a draft. Both: `getCurrentUser` -> `resolveOrgIdentity` -> `requireAdmin` (+ slug/membership) before any DB access; validate body after auth; verify any `customerRecordId` belongs to the org (else `customerRecordInvalid`); map failures to matrix KEYs. `export const dynamic="force-dynamic"`.
- [x] `src/app/api/invoices/[id]/route.ts` -- `GET` (returns invoice + line items + customer label), `PUT` (update draft via `saveInvoiceDraft`, version-gated), `DELETE` (discard draft). Same auth gate + KEY mapping; slug in query (GET/DELETE) / body (PUT).
- [x] `src/lib/data/invoices-client.ts` -- `InvoiceApiError`, `parseEnvelope`, and `listInvoices`/`getInvoice`/`createInvoice`/`updateInvoice`/`discardInvoice` client helpers returning typed data or throwing the error KEY. Mirror `business-profile-client.ts`.
- [x] `src/components/invoices/LinkedRecordPicker.tsx` -- accessible picker: choose a table from the org schema, then typeahead-search records (`searchRelationRecords`) by display label; emits the chosen record id + label. Schema-agnostic (FR82).
- [x] `src/components/invoices/InvoiceDraftForm.tsx` -- Admin-only client form (create + edit) with an editable line-items table (description/quantity/unit_price, add/remove rows, per-row and client-side subtotal display), the linked-record picker, editable province + language; loads via GET when editing, saves via POST/PUT; labeled/keyboard-accessible, translated inline errors (`role="alert"`) + motion success; built per `/web-uiux-architect`.
- [x] `src/components/invoices/InvoicesList.tsx` -- Admin-only list of the org's invoices with an empty state and a "New invoice" action; reuses `ui/table`/`card`.
- [x] `src/app/[slug]/invoices/page.tsx` (list), `src/app/[slug]/invoices/new/page.tsx` + `src/app/[slug]/invoices/[id]/page.tsx` (render `InvoiceDraftForm`) -- Admin-gated tenant pages following the settings/import convention.
- [x] `src/components/layout/DashboardNav.tsx` -- add the Admin-gated Invoices link.
- [x] `src/lib/i18n/en.json` + `fr.json` -- add the `Invoices` namespace and `DashboardNav.invoices`; real French, no em-dashes.
- [x] `tests/unit/invoice-tax.test.ts` -- `computeLineAmount` rounding (e.g. `3 × 1.005`, negatives rejected upstream, zero).
- [x] `tests/unit/invoices-schema.test.ts` -- every schema matrix row: description required, amount invalid, >=1 line required, language enum, customerRecordId shape.
- [x] `tests/unit/route-invoices.test.ts` -- route gates (401/403 before access, cross-org `customerRecordInvalid`), list empty vs populated, create standalone vs linked, PUT version-conflict + non-draft, discard draft vs non-draft.

**Acceptance Criteria:**
- Given an Admin, when they create a draft standalone and (separately) from a linked record, then both persist as `status='draft'` with their line items (each carrying description/quantity/unit_price and a stored computed `amount`), the linked draft records `customer_record_id` while the standalone leaves it null, and nothing is written to `records`/`org_schemas`.
- Given a draft, when it is re-saved with a stale or non-`draft` `version`, then the write is rejected with `409 versionConflict` and no partial line-item state is left behind (atomicity).
- Given a linked record in a workspace whose generated schema differs from another tenant's, when the Admin drafts against it, then creation still works and the customer display label resolves via the schema's display field (FR82).
- Given a non-Admin or unauthenticated caller, when they hit any `/api/invoices*` route, then it returns `403`/`401` before any access.
- Given the `fr` locale, when the Invoices screens render, then all copy is real French via next-intl with no em-dashes and no hardcoded strings.

## Implementation Notes

- Migrations applied to the Supabase test project via MCP: `invoices` (20260929023726), `invoice_line_items` (20260929023735), `save_invoice_draft` (20260929023748). Local files keep the spec-planned timestamps (`20260928120200/120300/120400`), mirroring the 12.1 precedent where the repo file name and the applied migration timestamp differ. Security advisor shows no new findings for the two new tables (both carry their `..._tenant_isolation` policy); remaining advisor items are pre-existing and unrelated.
- `save_invoice_draft` was validated end-to-end against a real org via a sequential `do` block: create (version 1, 2 line items) → update with correct version (version 2, replace-all down to 1 line) → stale-version save raises `invoice_draft_conflict` (SQLSTATE 40001) → cascade delete of the invoice removes its line items. The conflict is surfaced by the mutation layer as `409 versionConflict`; a non-draft discard is `409 notDraft`.
- Line `amount` is computed in `invoice-mutate.ts` with `computeLineAmount` (I2) and passed precomputed into the RPC's `p_line_items` JSONB; no SQL re-implements the line amount. `computeLineAmount` uses an epsilon-nudged half-away-from-zero round so `3 × 1.005 = 3.02` (not 3.01) despite float drift.
- The `/api/invoices` route family follows the 12.1 auth-before-body-validation ordering: authenticate, extract slug, resolve org under RLS + `requireAdmin` + slug-match, THEN full-body Zod validation, THEN (for a linked draft) verify `customerRecordId` belongs to the org under RLS before any write. A `customerRecordId` uuid that fails the org-ownership check → `Invoice.error.customerRecordInvalid` (400). A PUT that omits `version` is rejected as `409 versionConflict` (never an accidental create).
- The linked-record label resolves at read time in `invoices.ts` via `getSchema` + `resolvedDisplayFieldKey` (schema-agnostic, FR82); a soft-deleted/missing linked record degrades to a null label and the form shows the translated `customerUnavailable` note. The picker searches ANY tenant table via the existing `/api/records/search` endpoint (Story 3.7) — no new search surface.
- `LinkedRecordPicker` renders its search body as a child mounted only while the dialog is open, so state starts fresh each open and all `setState` happens inside the debounced async timeout — satisfying the `react-hooks/set-state-in-effect` lint rule (no synchronous setState in an effect body).
- French copy uses straight apostrophes to match the existing catalog convention; no em-dashes in any new EN/FR string (verified programmatically).
- Matrix Test Audit (step-03): added `tests/unit/invoices-read.test.ts` to cover the "Linked record missing" matrix row, whose behavior lives in `invoices.ts` `getInvoiceWithLineItems`/`resolveCustomerLabel` and was otherwise unexercised (the route test mocks the whole `@/lib/data/invoices` module). It asserts the resolved-label happy path, null-label degradation for a missing/soft-deleted or standalone record, and null data for an RLS-hidden invoice.
- Review patches (step-04): (1) **RPC conflict errcode** — the real-DB integration test surfaced that `save_invoice_draft` raised `40001` (auto-retried by PostgREST/pooler), stalling every conflict; switched to non-retryable `P0001` (message-marker matched) and re-applied to the test project. (2) Added `tests/integration/invoice-draft-db.test.ts` exercising create/update/version-conflict/non-draft/discard against the real RPC. (3) `InvoicesList` now guards the server error code against a known-key set before translating (was interpolating raw codes with a dead `?? genericError`). (4) `listInvoices` now orders by `updated_at desc` to match its "Last updated" column. (5) Removed four dead `Invoices` i18n keys (`navLabel`, `colCustomer`, `standaloneCustomer`, `pickerSelect`) from en+fr.

## Spec Change Log

## Review Triage Log

Review iteration 1 (blind-hunter, edge-case-hunter, verification-gap). No intent_gap/bad_spec → no loopback; survivors routed to patch.

**Patched:**
- `high` · **patch** · The guarded mutation layer (`invoice-mutate.ts` `saveInvoiceDraft`/`discardInvoiceDraft`) and the `save_invoice_draft` RPC had zero automated coverage of their real behavior — `route-invoices.test.ts` mocks `@/lib/data/invoice-mutate`, so the RPC's conflict mapping and the `discardInvoiceDraft` non-draft → `notDraft` mapping ran unverified (only manually validated via a direct-SQL MCP `do` block, which bypasses PostgREST). Added `tests/integration/invoice-draft-db.test.ts` (seed-org + RLS client, skip-when-env-absent, mirroring `import-commit-db.test.ts`). **The new test immediately caught a real shipped defect:** the RPC raised its conflict with `errcode = '40001'` (`serialization_failure`), which PostgREST + the Supavisor pooler AUTO-RETRY as transient — so every version-conflict / non-draft save *stalled* (5s+ test timeout) instead of returning a fast 409, and in production would surface as a hang → gateway timeout, never the intended `versionConflict`. Fixed the RPC to raise with the non-retryable default `P0001` (matched by the message marker, not the SQLSTATE) and re-applied it to the test project; conflict tests now return in ~2.5s. The direct-SQL manual validation never hit this because it did not go through PostgREST's retry layer. [VG, BH]
- `low` · **patch** · `InvoicesList.tsx` load-error handler does `setError(t(\`error.${short}\`) ?? t("error.genericError"))`; next-intl `t()` never returns null so the `??` fallback is dead, and an unknown server code would render a raw translation key — diverging from the `ERROR_KEYS`-guarded siblings (`InvoiceDraftForm`, `LinkedRecordPicker`). Reachable codes today are all in the catalog, but the guard is the established pattern. Fix: guard the code against a known-key set before translating. [ECH, VG]
- `low` · **patch** · `listInvoices` orders `created_at desc` but the list renders an `updated_at`-based "Last updated" column — sort key and displayed date disagree (an edited old draft sorts low yet shows a recent date). Fix: order by `updated_at desc` to match the column. [BH]
- `low` · **patch** · Four `Invoices` i18n keys are never referenced in any component (`navLabel`, `colCustomer`, `standaloneCustomer`, `pickerSelect`) — dead copy in en+fr (verified by grep: only in the JSON). Fix: remove all four from both locales. [BH]

**Rejected:**
- `low` · `InvoiceLineItemRow.quantity/unit_price/amount` typed `number | string` with no `Number()` normalization at the read boundary — no current bad outcome: 12.2's form stringifies on load and recomputes amounts client-side via `computeLineAmount`. A forward concern for 12.3's subtotal/tax, not a 12.2 defect; fix adds a normalization util. Noted for 12.3. [BH]
- `low` · A linked customer record soft-deleted between load and save makes the PUT fail `customerRecordInvalid` rather than degrading to standalone — but the flow is coherent and guided (the translated error says "Choose another"; "Remove link" then saves). Fix adds branching logic; unlikely in everyday use. [BH]
- `false` · "No post-save refresh leaves stale derived data" — the PUT response refreshes `version` (the only server-derived value the next save needs); the form displays no other server-derived field, so nothing user-visible is stale. [BH]
- `low` · A `customer_record_id` whose table was hidden after linking cannot be re-found in the picker (filters to `visibleTables`) — extreme edge; the existing link still shows with its label and "Remove link" works. Fix adds complexity. [BH]
- `low` · `save_invoice_draft` does not re-validate `p_customer_record_id ∈ p_org` (relies on the route precheck); a direct RPC caller could store a foreign record id. Inert: RLS still scopes reads, so the foreign id resolves to null ("unavailable"), no snapshot until 12.4, no data leak. Route guards the normal path; fix adds a DB-layer guard. Noted as defense-in-depth for 12.4's issue path. [BH]
- `low` · `amountInvalid` copy vs sub-cent unit prices (e.g. `0.001` → amount `0.00`) — money rounds to cents by design; showing `0.00` is expected. Fix adds a precision hint. [BH]
- `low` · `computeLineAmount` guards its inputs but not a product that overflows to `Infinity` (→ silently `0`) — requires values > ~1e154, unreachable for an invoicing app; fix adds a product guard. [ECH]

## Design Notes

- Why an RPC: line items live in a child table (epic mandate), so a draft save touches two tables. supabase-js has no client-side transaction; a `security invoker` function is the only way to make "upsert invoice + replace line items" atomic while keeping `auth_org_ids()` RLS in force. This mirrors the codebase's "guarded write, explicit identity, RLS-scoped" contract at the DB layer for the one fixed compliant module.
- Why `tax.ts` now: Invariant I2 forbids a second line-amount implementation. Seeding `tax.ts` with only `computeLineAmount` gives 12.3 a single file to extend (subtotal/total/HST) rather than reconcile two.
- Line-items replace-all (delete + re-insert) over per-row diffing: drafts are small and edited wholesale; replace-all is simpler and race-safe under the version gate.

## Verification

**Commands:**
- `npm run test -- tests/unit/invoice-tax.test.ts tests/unit/invoices-schema.test.ts tests/unit/route-invoices.test.ts tests/unit/invoices-read.test.ts tests/integration/invoice-draft-db.test.ts` -- expected: all pass; full suite stays green. **Result (post-review): 51 passed (tax + schema + route + read-layer + real-DB mutation/RPC). Full suite: 702 passed (64 files).**
- `npx tsc --noEmit` -- expected: no new type errors. **Result: exit 0.**
- `npm run lint` -- expected: clean. **Result: exit 0.**

**Manual checks:**
- On `/[slug]/invoices` as an Admin: create a standalone draft with two line items, reload, confirm it persists; create one from a linked record and confirm the customer label shows; edit and re-save; confirm a blank description and a zero-line draft are rejected with translated errors; discard a draft; sign in as a Member and confirm the area is unreachable; toggle locale to `fr` and confirm copy is real French.
