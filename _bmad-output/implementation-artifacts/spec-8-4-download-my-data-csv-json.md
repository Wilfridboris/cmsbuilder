---
title: 'Download My Data (CSV / JSON)'
type: 'feature'
created: '2026-10-05'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'bf1abb91f5ff77eb3dcbbdf5899da6f8375b7f60'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An Admin owns their organization's data but has no way to take it with them. FR37 / PIPEDA data-portability requires a self-serve "Download My Data" export covering every logical table, in both CSV and JSON, scoped strictly to the caller's org. Nothing in the app exposes this today, and the Epic 8.5 grace period depends on it being prominently available before deletion.

**Approach:** A new admin-gated GET export endpoint reads the org's schema and every logical table's records under the caller's RLS-scoped client, serializes them to JSON (faithful, complete) plus one CSV per table (human-readable), and returns a single downloadable bundle. A "Download My Data" card is added to the admin settings page with a button that fetches the bundle and triggers the browser download, with pending and error feedback.

## Boundaries & Constraints

**Always:**
- Export reads ONLY through the caller's RLS-scoped server client (`resolveOrgIdentity`/`resolveAdminIdentity`), never the service-role admin client. Every record is scoped by `organization_id` under RLS; no other org's data can ever appear.
- Admin-only. A non-admin member gets `403 forbidden`; an unauthenticated request gets `401 unauthorized`; both before any data work.
- The export is a READ: it MUST remain available to a `read_only` org (Epic 8.5 grace period surfaces it). Use `resolveAdminIdentity` (admin gate, reads never writable-gated) — never `resolveWritableAdminIdentity`.
- Include EVERY logical table in the schema, including tables and fields flagged `hidden` (the user owns all of it), and ALL live (non-soft-deleted) records per table — even beyond the backend's default page cap. The read path MUST paginate to completeness; a table with more than the default 1000 rows must export in full, never silently truncated.
- JSON is the complete, faithful representation: field `key`s preserved, values exactly as stored in `data` (relation values stay as the stored target id — raw, not resolved). CSV columns are ordered by the schema's `FieldDefinition` order with an `id` column first; CSV header uses field `label`.
- All UI copy comes from a next-intl `DataExport` namespace present in both `en.json` and `fr.json` (no hardcoded strings). File-internal names (filenames, JSON keys, CSV headers derived from schema) are data, not localized UI copy.
- The bundle is a SINGLE ZIP `scheza-{slug}-{date}.zip` built with `fflate`, containing one `tables/<table_key>.csv` per logical table plus one `export.json` at the archive root with the complete dataset. One download satisfies "both CSV and JSON." (Decision: packaging/dependency resolved to single-ZIP-via-fflate.)
- WCAG AA: the trigger is a real labelled `Button` (not icon-only without a label), `focus-visible` ring, decorative icon `aria-hidden`, mobile touch target toward 44px; the pending state is announced (disabled + visible spinner + status text). No em-dashes in copy (house style).

**Never:**
- Never change the data model, `records`/`org_schemas` tables, RLS policies, `getSchema`, or the existing `listRecords` (its page-1 behavior serves the UI; add a sibling paginating reader rather than altering it).
- Never use the service-role client for the export read path. Never trust a client-supplied org id — resolve org from `slug` under RLS.
- Never gate the export behind writability, and never block it during the grace period.
- Never mutate anything; this is read-only. No new DB migration.
- Never resolve/transform relation values into display labels in this story (faithful raw export); display-field resolution is a future enhancement, not in scope.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin export | Authenticated admin, valid `slug` | `200`, downloadable bundle containing all tables' records as CSV + a complete JSON | N/A |
| Non-admin member | Authenticated member | No data read; `403` `{ error: "forbidden" }` | Button shows `error.forbidden` |
| Unauthenticated | No session | No data read; `401` `{ error: "unauthorized" }` | Button shows `error.unauthorized` |
| Cross-org slug | Admin of org A requests org B's slug | RLS hides org B → `403 forbidden` | Button shows `error.forbidden` |
| Read-only / grace org | Admin, `read_only` subscription | Export succeeds (`200`) | N/A |
| Large table | A table with > default page cap rows | All rows exported (paginated to completeness) | N/A |
| Empty org | Zero tables or zero records | Valid bundle: JSON with empty/zeroed tables, no spurious CSVs | N/A |
| Server failure | Read/serialize throws | `5xx` `{ error: "genericError" }`, logged; no partial file | Button shows `error.genericError` |

</frozen-after-approval>

## Code Map

- `src/app/api/export/route.ts` -- NEW. GET handler. Pattern mirrors `src/app/api/records/route.ts:37-67`: `requireUser()` → zod-validate `slug` query param → `resolveAdminIdentity(slug, user)` (admin + RLS + cross-org gate) → build bundle → return it. Wrap in try/catch → `handleError(err, "/api/export")`.
- `src/lib/api/route-helpers.ts` -- REUSE. `requireUser` (120-126), `resolveAdminIdentity` (134-144, admin gate; NOT the writable variant), `handleError` (collapses to `{data:null,error:code}`), `json`. Do not modify.
- `src/lib/data/records.ts` -- REUSE `getSchema` (95-118) for the table list; ADD a sibling `listAllRecords(client, orgId, tableKey)` that pages via `.range()` until exhausted (same filters/order as `listRecords` 46-84: `organization_id`, normalized `table_key`, `deleted_at is null`, `created_at asc`). Do NOT alter `listRecords`.
- `src/lib/export/build-export.ts` -- NEW, pure/server-safe. `buildExport({ slug, exportedAt, tables, recordsByTable })` → `{ jsonText: string, csvs: { name, content }[] }`. CSV via `Papa.unparse` (papaparse already a dep, used in `src/lib/import/parse.ts:1,130`); columns in `FieldDefinition` order, `id` first, header = field `label`. JSON = `{ organizationSlug, exportedAt, tables: [{ key, label, fields, records: [{ id, data }] }] }`. Pure → node-unit-testable.
- `src/lib/export/zip.ts` -- NEW. `zipBundle(files: {name,content}[]) → Uint8Array` wrapping `fflate`'s `zipSync` (text encoded to bytes). Thin.
- `src/components/settings/DownloadMyDataButton.tsx` -- NEW `'use client'`. `{ slug }` prop. Mirrors existing settings components (`InviteForm.tsx`, `BusinessProfileForm.tsx`): `useTranslations("DataExport")`, shadcn `Button`, lucide `Download`/`Loader2`. On click: `fetch('/api/export?slug='+slug)`; `res.ok` → blob → object-URL → temp `<a download>` click → revoke; else `res.json()` → show `t('error.'+code)`. Pending → disabled + spinner + status text.
- `src/app/[slug]/settings/page.tsx` -- EDIT. Add a new `<hr/>` + `<section>` after `HiddenTablesRestoreSection` (line 189, before `</main>`), matching the section idiom (142-152: `<section className="flex flex-col gap-8">` → `<header>` with `<h2>` + subtitle → component). Pass `slug`. Page is already admin-gated (56-70).
- `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- ADD `DataExport` namespace to both (keys: `title`, `subtitle`, `button`, `preparing`, `error.unauthorized`, `error.forbidden`, `error.genericError`). Mirror an existing settings namespace block (e.g. `Billing`/`BusinessProfile`).
- `src/components/ui/button.tsx`, `src/lib/utils.ts` (`cn`) -- REUSE.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/data/records.ts` -- ADD `listAllRecords`: page through `.range()` (e.g. 1000/page) accumulating until a short page, returning the full `RecordData[]`. Same scope/filters/order as `listRecords`; server-only; leave `listRecords` untouched.
- [x] `src/lib/export/build-export.ts` -- NEW pure serializer (JSON text + per-table CSV via `Papa.unparse`), per the Code Map shape. Handle zero tables and zero-record tables cleanly.
- [x] `package.json` -- ADD `fflate` as a dependency (small zero-dep archive lib for the ZIP encoder).
- [x] `src/lib/export/zip.ts` -- NEW `zipBundle` wrapping fflate `zipSync` (archive layout: `export.json` at root + `tables/<table_key>.csv` per table).
- [x] `src/app/api/export/route.ts` -- NEW GET: auth → admin/RLS gate → `getSchema` → for each table `listAllRecords` → `buildExport` → `zipBundle` → return `new NextResponse(zip, { headers: { "Content-Type": "application/zip", "Content-Disposition": attachment with `scheza-{slug}-{date}.zip` } })`; errors via `handleError`.
- [x] `src/components/settings/DownloadMyDataButton.tsx` -- NEW client component (fetch + blob download + pending/error states), WCAG AA per Boundaries.
- [x] `src/app/[slug]/settings/page.tsx` -- EDIT: add the "Download My Data" section after `HiddenTablesRestoreSection`.
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- ADD the `DataExport` namespace in both.
- [x] `tests/unit/build-export.test.ts` -- NEW. Cover the I/O matrix's serialization rows: multiple tables each produce a CSV with `id`-first, label-headed, field-ordered columns; JSON contains all tables/records faithfully; empty org yields a valid empty bundle; a table's records all appear (no truncation in the pure layer).
- [x] `tests/unit/route-export.test.ts` -- NEW. Mock `getCurrentUser`/`requireAdmin`/`getSchema`/`listAllRecords`: assert `401` with no session and `403` for a non-admin BEFORE any read, and that a valid admin reads every schema table. (Also covers cross-org 403, read-only/grace 200, and server-failure 500.)
- [x] `tests/unit/data-export-catalog.test.ts` -- NEW. Assert every `DataExport` key is present and non-empty in both `en.json` and `fr.json` (repo catalog-parity convention).
- [x] `tests/unit/list-all-records.test.ts` -- NEW (matrix-audit gap). Prove `listAllRecords` pages past the default cap to completeness (Large-table row) with the same org/table/soft-delete scope as `listRecords`.

**Acceptance Criteria:**
- Given an authenticated Admin in account settings, when they choose "Download My Data", then they receive a bundle containing all of the org's records as both CSV (one per logical table) and JSON, scoped strictly to their `organization_id`.
- Given an org whose data spans multiple logical tables (and any table exceeding the backend's default page size), when the export runs, then every table and every record is included with no silent truncation and no other org's data present.
- Given a non-admin or unauthenticated caller, when they hit the export endpoint, then no org data is read and they receive `403`/`401` respectively, surfaced in the UI via the `DataExport` catalog.
- Given an org in the read-only grace period, when an Admin exports, then the export succeeds (reads are never writability-gated).
- Given either locale, when the card renders, then its copy comes from the `DataExport` namespace, meets WCAG AA, and the button exposes an accessible label, focus ring, and pending feedback.

## Implementation Notes

- Built to the Code Map. NEW: `src/app/api/export/route.ts` (GET), `src/app/api/export/schemas.ts` (zod `slug` validator split out so Next's route type-gen does not reject a non-handler export), `src/lib/export/build-export.ts` (pure serializer), `src/lib/export/zip.ts` (fflate `zipSync` wrapper), `src/components/settings/DownloadMyDataButton.tsx`, and tests `build-export`, `route-export`, `list-all-records`, `data-export-catalog`. EDITED: `src/lib/data/records.ts` (+`listAllRecords` + `EXPORT_PAGE_SIZE`; `listRecords` untouched), `src/app/[slug]/settings/page.tsx` (new section), `src/lib/i18n/{en,fr}.json` (`DataExport` namespace), `package.json`/`package-lock.json` (+`fflate@^0.8.3`).
- Export is a READ via `resolveAdminIdentity` (admin + RLS + cross-org slug check), never the writable variant, so a `read_only`/grace-period org still exports. `listAllRecords` pages in 1000-row `.range()` windows until a short page, so a table over the default cap exports in full. Bundle = `export.json` at root + one `tables/<key>.csv` per table, zipped with fflate; returned as `application/zip` with a `scheza-{slug}-{date}.zip` attachment disposition and `Cache-Control: no-store`.
- CSV: `id` first, header row uses field `label`, columns in `FieldDefinition` order, hidden fields/tables included, relation values left as raw stored ids. JSON preserves keys and stored values exactly. Client component downloads via blob + object-URL; failures read the `{data,error}` envelope and show the translated `error.<code>`. WCAG AA: labelled Button, `role="status"`/`role="alert"`, `aria-describedby`, `aria-hidden` icons, `min-h-12` target. Copy carries no em-dashes.
- Verified: `npm run type-check` clean; `npm test` 1656 pass across 147 files (incl. 20 new); `npm run lint` clean (only the pre-existing eslintrc-deprecation notice); `npm run build` compiles with `/api/export` emitted as a dynamic route.
- **Matrix-test audit:** all 8 rows covered by passing tests — Admin export + Empty org (`build-export`), Large table (`list-all-records` pagination), and Non-admin / Unauthenticated / Cross-org / Read-only-grace / Server-failure (`route-export`). The live download/FR-toggle/403-in-UI checks are assigned to the Playwright MCP manual review (same node-env split as Stories 8.1-8.3).
- Minor: the route calls `getCurrentUser()` for the 401 gate and then `requireUser()` (which re-fetches) to keep the 401 path single-sourced and route-test-mockable; a deliberate, harmless double-read, flagged for review. (Resolved in review patch: collapsed to a single `requireUser()`.)
- **Review Pass 1 (Blind Hunter + Edge Case Hunter + Verification Gap):** 4 patches applied (CSV record-id column collision with a field keyed `id`; UTF-8 BOM so Excel renders French CSV data; deferred blob-URL revoke so large downloads are not canceled; collapsed the redundant double session read), 1 deferred (export size/memory ceiling for a very large org, logged to `deferred-work.md`), 8 rejected (recorded in the Review Triage Log). Re-verified green after patches.
- **Playwright MCP manual review (localhost:3000, authed admin `session-1f4fa453`, rich org: 5 visible tables + 1 hidden `Dépenses` table, sensitive/PII + select + relation fields, FR data) — PASSED.** Verified live: the Settings "Download your data" card renders; clicking it returns `200 application/zip` and downloads `scheza-session-1f4fa453-2026-10-06.zip`; the archive contains `export.json` plus one `tables/<key>.csv` for every logical table INCLUDING the hidden `Dépenses` table and hidden fields; empty tables emit header-only CSVs; CSVs carry the UTF-8 BOM and render French data correctly; `export.json` is complete with per-table record counts and raw stored values; the EN/FR toggle re-labels the card instantly with no reload. Console errors are the pre-existing dev-only `manifest.webmanifest` notice, unrelated to this story. The non-admin/unauthenticated/cross-org 403/401 paths are covered by `route-export.test.ts` (same node-env split accepted for Stories 8.1-8.3).

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **[patch] CSV record-id column collides with a field keyed `id` (Edge Case Hunter).** `medium`. Verified: `build-export.ts` `tableToCsv` builds each row as an object keyed by column name with `id` reserved for `record.id`, then overwrites `row[field.key]`. Key normalization (`src/lib/utils.ts:78`, `[^a-z0-9]+`→`_`) maps a label like "ID" to key `id`, so such a field overwrites the record-id column and emits a duplicate column, dropping the real record id from every row. Reachable via AI-generated/imported "ID" columns. Smallest robust fix (build rows positionally) adds no surface → patch.
- **[patch] CSVs lack a UTF-8 BOM, so Excel mis-decodes French/accented data (Blind Hunter).** `medium`. Verified: `zip.ts` encodes via `strToU8` (no BOM) and `build-export.ts` adds none; the project's own importer strips a BOM on read (`parse.ts:129`), confirming Excel CSVs carry one. For a bilingual EN/FR product, French record data (é/à/ç) renders corrupted in Excel, undercutting the "human-readable" CSV goal. One-line BOM prepend, round-trip-safe (importer strips it) → patch. Folds in the Verification-Gap "Other" note that the `tableToCsv` comment wrongly claims Papa.unparse JSON-encodes nested values (cosmetic comment fix in the same function).
- **[patch] Object-URL revoked synchronously after `anchor.click()` (Edge Case Hunter).** `low`. Verified: `DownloadMyDataButton.tsx` calls `URL.revokeObjectURL(url)` immediately after `anchor.click()`; for large blobs some browsers cancel the download. Core happy path; trivial fix (defer revoke a tick) → patch.
- **[patch] Redundant double session read in the route (Blind Hunter + Verification-Gap, author-flagged).** `low`. Verified: the handler calls `getCurrentUser()` + manual 401 throw, then `requireUser()` (which fetches the session again). `requireUser()` already throws `401 unauthorized`; collapsing to a single `const user = await requireUser()` is a direct simplification (no new surface) → patch.
- **[defer] No size/memory ceiling for a very large org (Blind Hunter).** `maybe-false`, medium-if-true. The route buffers every table's records in memory, builds all CSV/JSON strings, and runs synchronous `zipSync` on a `force-dynamic` serverless function. At realistic small-business scale this is fine; I cannot bound the largest plausible org vs the serverless memory/time limit. Settle by: known max org data volume and the function's memory/duration cap. Logged to deferred-work rather than dropped.
- **[reject·false] Sensitive/PII fields exported with no marking (Blind Hunter).** The export is the owner receiving their OWN data (no third party); including `sensitive` fields is the intended PIPEDA-portability behavior. The Story 8.3 `sensitive` flag is a UI reassurance signal, not an export-redaction requirement. No user harm; annotating would add surface. Not a defect.
- **[reject·low] `select` fields export the stored token, not the label (Blind Hunter).** Consistent with the frozen "values exactly as stored... raw, not resolved" decision (relation was the example, the rule is general). A token like `in_progress` is still legible; resolving labels adds option-lookup surface. Rejected as low.
- **[reject·low] "default page cap 1000" premise unverified / PostgREST `db-max-rows` not cited (Blind Hunter).** Comment nuance only. `listAllRecords` requests explicit 1000-row `.range()` windows and pages until a short page, so completeness holds regardless of any server cap; export correctness does not rest on the config. Rejected as cosmetic.
- **[reject·low] JSON silently omits `version` (Blind Hunter).** Intentional and pinned by `build-export.test.ts` ("no version in the body"); `version` is an internal optimistic-concurrency counter, not user data. The faithful guarantee is over the record `data`. Rejected as low.
- **[reject·low] `Content-Disposition` filename interpolates `slug` without escaping (Blind Hunter + Edge Case Hunter).** Unreachable: org slugs are generated via `kebabCase` → `[a-z0-9-]` only (`src/lib/utils.ts:37`), and `resolveAdminIdentity` requires the query slug to equal the caller's stored slug (`membership.slug === slug`), so a slug containing `"`/CR/LF 403s before the filename is built. Defense-in-depth encoding would add a branch for an unreachable input. Rejected as low.
- **[reject·low] "Empty org" matrix row only covered in the pure layer (Blind Hunter).** The row (zero tables OR zero records) is covered by `build-export.test.ts` (zero-table empty bundle AND header-only CSV for a zero-record table), and the route 200 test does drive zero-record tables through the handler. Asserting zip-internal CSV content end-to-end is beyond the audit bar. Rejected as low.
- **[reject·low] CSV cells for nested object/array values become `[object Object]` (Verification-Gap other).** Unreachable with well-formed data: every supported field type (text/number/date/datetime/boolean/currency/email/phone/relation/select) stores a scalar, never an object/array. The misleading comment is corrected as part of the BOM patch above. Rejected as low.

## Design Notes

- **Read-only must still export.** The export is the user's lifeboat during the Epic 8.5 grace period, so it uses the admin-but-not-writable gate (`resolveAdminIdentity`). The writable variant would be a correctness bug that blocks the users who most need it.
- **Pagination to completeness.** `listRecords` returns only the first page (fine for the records UI); an export that silently stopped at 1000 rows would quietly violate "all records." The dedicated `listAllRecords` pages to exhaustion. This is the non-obvious correctness point of the story.

## Verification

**Commands:**
- `npm run type-check` -- expected: no errors
- `npm run lint` -- expected: clean (allow the pre-existing eslintrc-deprecation notice)
- `npm test` -- expected: green incl. the three new tests
- `npm run build` -- expected: compiles

**Manual checks (Playwright MCP, localhost:3000, authed `/session-…` admin fixture, on an org with multiple generated tables incl. a sensitive/PII table):**
- Settings page shows the "Download My Data" card; clicking it downloads a bundle; the bundle contains a CSV per logical table and a JSON with all records.
- Toggle FR: card copy switches to the FR catalog; no reload.
- Confirm (via a member fixture or a forced non-admin) the endpoint returns 403 and the UI shows the forbidden message.
