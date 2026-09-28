---
title: 'Story 4.1: Upload & Parse a Spreadsheet'
type: 'feature'
created: '2026-09-27'
status: 'done'
route: 'dispatch'
baseline_commit: 'a6b3c00722e2f20e97ce8261091e4d975d37b913'
review_loop_iteration: 0
context:
  - '_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Claiming an account clears the synthetic demo data, so an Admin lands on empty tables and bounces unless they can bring in their real history. The first step of import is letting them upload a spreadsheet and trust what the system read from it before anything is committed.

**Approach:** Add an Admin-only Import surface where a `.csv`, `.xls`, or `.xlsx` file is uploaded, parsed server-side (papaparse for CSV, SheetJS/`xlsx` for Excel), and returned as a read-only preview of detected columns with sample values. This is the analyze phase only: no rows are written to `records`, and AI column mapping (4.2), edit/resolve (4.3), and commit (4.4) layer on top later.

## Boundaries & Constraints

**Always:**
- Parse strictly server-side (never trust client rows); bound the upload before parsing (reject > 5 MB with a translated error).
- Treat the first row as headers; return detected column names, total data-row count, and up to the first 10 data rows as samples.
- Excel workbooks: if a `.xls`/`.xlsx` has more than one sheet, do NOT silently guess — return the sheet names and have the user pick which sheet to parse, then re-analyze the chosen sheet. A single-sheet workbook (or CSV) parses directly with no selection step.
- Authenticate and require the Admin role on the addressed org (via `resolveOrgIdentity`); non-Admins get `403 forbidden`.
- Return the `{ data, error }` envelope where `error` is a translation KEY, never raw copy/stack/library output. All strings resolve through next-intl (en + fr): no hardcoded copy, no em-dashes.
- Preview renders within 5 seconds for a within-limits file; every unreadable/empty/oversized/non-spreadsheet file yields a translated non-technical error with a retry path and leaves no state.
- UI meets the platform accessibility baseline (real labeled file input, keyboard-operable dropzone, ≥48×48px targets, WCAG AA); build it following the `/web-uiux-architect` skill.

**Never:**
- Never write to `records`, `org_schemas`, or any tenant table — analyze phase is read-only.
- Never call Gemini, propose a column→field mapping, or persist the parsed file (those are 4.2/4.4); never use the service-role client here.
- Never expose raw parser errors, file contents beyond the sample preview, or SQL to the client.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid CSV | Admin uploads `.csv` with a header row + data | `{ columns, rowCount, sampleRows (≤10), sheetName }` returned; preview renders < 5s; no DB write | N/A |
| Valid Excel (single sheet) | Admin uploads `.xls`/`.xlsx` with one sheet | Same shape as CSV, parsed via `xlsx` | N/A |
| Multi-sheet Excel | Workbook with >1 sheet, no sheet chosen yet | Return `{ sheetNames, needsSheetSelection: true }` (no preview); user picks a sheet, re-analyze returns that sheet's preview | N/A |
| Empty file | 0 bytes, or headers with no data rows | Translated "empty file" error, retry offered, no state | `Import.error.empty` (400) |
| Unreadable / not a spreadsheet | `.pdf`, image, corrupt bytes, or parse throws | Translated "unreadable/unsupported" error, retry | `Import.error.unreadable` (400) |
| Oversized file | Upload > 5 MB | Translated "too large" error before parsing, retry | `Import.error.tooLarge` (413) |
| Non-Admin / no session | Member, anon, or missing session | Request rejected, no parse | `forbidden` (403) / `unauthorized` (401) |
| Missing file field | POST with no file part | Translated generic error | `Import.error.noFile` (400) |

</frozen-after-approval>

## Code Map

- `src/lib/api/route-helpers.ts` -- REUSE `resolveOrgIdentity(slug, actorId)` (auth + RLS org resolution), `json<T>(body,status)`, `handleError(err,route)`, `AppError(status,key)`. Do not reimplement.
- `src/app/api/records/route.ts` + `records/schemas.ts` -- exemplar: named `POST` export, `export const dynamic="force-dynamic"`, sibling `schemas.ts` Zod file. Mirror for the new import route.
- `src/components/dashboard/RecordsView.tsx` + `src/components/ui/table.tsx` -- reuse the semantic table + `<caption>` + mobile-card responsive pattern for the preview.
- `src/components/layout/DashboardNav.tsx` -- add Admin-only "Import" entry (mirror the Settings link + `aria`).
- `src/app/providers.tsx` + `src/lib/data/records-client.ts` -- TanStack Query + client-fetch pattern (throw typed error on `error`) for the upload call.
- `src/lib/i18n/en.json` + `fr.json` -- add `Import` namespace; French must be real, no em-dashes.
- `src/lib/import/` + `src/components/import/` -- `.gitkeep` placeholders; new lib + UI land here.
- `package.json` -- `papaparse@5.4.1`, `@types/papaparse`, `xlsx@0.18.5` installed; vitest is the runner. No new deps.
- Next.js 16.3.6 reads uploads via `const form = await req.formData(); const file = form.get('file')` (Web Request API); confirm against `node_modules/next/dist/docs/` before coding.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/import/parse.ts` -- pure `parseSpreadsheet(buffer, filename)` dispatching CSV (papaparse, header row) vs Excel (`xlsx`); returns `{ columns, rows, sheetName, sheetNames }`; throws typed `ParseError` on empty/unreadable. No I/O or framework imports.
- [x] `src/app/api/import/schemas.ts` -- Zod guard: file present, size ≤ 5 MB, extension in `.csv/.xls/.xlsx`; optional `sheet` field (sheet name to parse).
- [x] `src/app/api/import/analyze/route.ts` -- `POST`: `resolveOrgIdentity` + Admin check, read `formData` (file + optional `sheet`), guard, `parseSpreadsheet`. If Excel has >1 sheet and no `sheet` given, return `{ data: { sheetNames, needsSheetSelection: true }, error: null }`; otherwise return `{ data: { columns, rowCount, sampleRows: rows.slice(0,10), sheetName }, error: null }`. Map failures to matrix error keys via `AppError`/`handleError`. No DB access.
- [x] `src/lib/data/import-client.ts` -- client fetch posting file (+ optional `sheet`) to analyze; returns preview or sheet-selection payload, or throws a typed error carrying the translation key.
- [x] `src/components/import/ImportDropzone.tsx` + `ColumnPreview.tsx` -- drag-drop + labeled file-picker dropzone; sheet picker when `needsSheetSelection`; preview table/cards of columns + samples; translated error + retry state. Built per `/web-uiux-architect`. (+ `ImportView.tsx` client shell toggling dropzone↔preview.)
- [x] `src/app/[slug]/import/page.tsx` -- Admin-only page composing dropzone + preview; deny non-Admins per existing `[slug]` guards.
- [x] `src/components/layout/DashboardNav.tsx` -- add Admin-only "Import" link.
- [x] `src/lib/i18n/en.json` + `fr.json` -- add `Import` namespace (title, subtitle, dropzone label, preview caption, sheet-picker label, `error.*`).
- [x] `tests/unit/import-parse.test.ts` -- vitest tests for every matrix parse scenario (valid CSV, single/multi-sheet xlsx, empty, unreadable, header detection, sample-row cap). See Spec Change Log for the path deviation from `src/lib/import/parse.test.ts`.

**Acceptance Criteria:**
- Given an Admin, when they upload a valid spreadsheet, then columns + ≤10 sample rows render within 5 seconds and nothing is written to `records` (verify via network + DB inspection).
- Given the `fr` locale, when any screen in this feature renders, then all copy is real French via next-intl with no em-dashes and no hardcoded strings.
- Given the analyze route, when called by a non-Admin or unauthenticated caller, then it returns `403`/`401` before any parse work.

## Implementation Notes

- **Admin gate = RLS membership + authoritative role.** The route resolves the org under the caller's RLS client via `resolveOrgIdentity(slug, actorId)` (non-member → 403) and then re-checks the role with `requireAdmin` against `org_members` (a Member → 403), plus a `membership.slug === slug` check so a cross-org Admin is also rejected. This mirrors the `/api/records` + Settings-page pattern; the service-role client is used ONLY inside `requireAdmin`'s narrow membership read, never for tenant data. All auth work happens before any `formData`/parse.
- **`slug` travels as a form field.** An upload is a single multipart POST, so the addressed org is a `slug` part in the same `FormData` as the `file` (no query string). The client sets `slug`, `file`, and optional `sheet`.
- **Error-key discipline.** `parse.ts` throws `ParseError` carrying a translation KEY (`Import.error.empty`/`.unreadable`); `schemas.ts` attaches matrix KEYs as refinement messages (`.noFile`/`.empty`/`.tooLarge`/`.unreadable`); the route's `errorForKey` maps each KEY to its matrix status (400/413) via `AppError`, and `handleError` collapses everything else to a masked 500. Raw parser output/stacks/SQL never reach the client.
- **Header + row hardening in the pure parser.** Blank/duplicate headers are disambiguated deterministically (`Column N`, `Name (2)`) so row objects never silently collapse columns; fully blank rows are dropped; a UTF-8 BOM is stripped; Excel dates coerce to ISO strings. A header-only file (no data rows) is treated as empty per the matrix.
- **Keyboard-operable dropzone without custom key handling.** The dropzone is a `<label>` wrapping a real `<input type="file">` (`sr-only`), so Space/Enter open the native picker and the input stays the a11y source of truth; drag events only decorate it. Targets are ≥48px, focus is visible via `focus-within:ring`, decorative icons are `aria-hidden`, and an `aria-live` region announces the analyze round-trip. Motion is CSS-first; Framer Motion is used only for the error enter/exit via `AnimatePresence`.

- **Verification fixes (post-implementation audit).** Two issues caught reviewing the staged diff against the frozen boundaries: (1) `ColumnPreview.tsx` rendered an em-dash `—` as the empty-cell placeholder — a frozen "no em-dashes" violation and the same pattern Epic 3's retro removed; replaced with a translated `Import.cellEmpty` key ("Empty" / "Vide"), matching the existing `Generate.cellEmpty` convention. (2) `tests/unit/route-import-analyze.test.ts` `fakeFile` typed its bytes as `Uint8Array`, which `tsc` rejected as a `BlobPart` under the project's generic `Uint8Array` lib; narrowed the param to `Uint8Array<ArrayBuffer>`. After both: 506/506 tests pass, lint clean, and the only remaining `tsc` error is the pre-existing, unrelated `src/app/api/claim/route.ts` export (present at the baseline commit; untouched by this story).

## Spec Change Log

- **2026-09-27 — Parse test path moved to `tests/unit/import-parse.test.ts`.** The Tasks list named `src/lib/import/parse.test.ts` and the Verification command referenced that path, but the project's `vitest.config.ts` has `include: ["tests/**/*.test.{ts,tsx}"]`, so a test under `src/**` is NOT collected — a probe confirmed vitest reports "No test files found" for a `src/` path (a CLI positional only filters WITHIN the include glob; it does not widen it). To keep the suite actually runnable under `npm run test`, the pure parser test lives at `tests/unit/import-parse.test.ts` (where all 49 existing unit suites live), covering every matrix parse scenario. A sibling `tests/unit/route-import-analyze.test.ts` was added to lock the handler-owned matrix rows (401/403 before parse, guard rejections, preview vs sheet-selection, error-key→status mapping) — mirroring the existing `route-records.test.ts` convention. Adjust the Verification command to the new path (below).

## Review Triage Log

### Pass 1 (2026-09-27)

- **[EC1] Excel date cells render as serial numbers** — `medium` — verified: `parse.ts` calls `XLSX.read`/`sheet_to_json` without date coercion, so date cells return numeric serials (e.g. "44197") that `cellToString` stringifies; the `instanceof Date` branch (parse.ts:105) is dead for Excel. Preview shows confusing serials for date columns (common in the invoice/work-record domain). Route: **patch**.
- **[EC3] `parseCsv` comment claims "hard failure → unreadable" but code only throws `empty`** — `low` — verified comment/code mismatch; harmless but misleading. Route: **patch** (direct comment correction, bundled with parse.ts).
- **[VG1] Route non-`ParseError` masking branch (→400 `unreadable`) untested** — `low` — pre-verified gap: only a `ParseError` throw is exercised; deleting the fallback (route.ts:384-385) keeps all tests green, so a regression to a masked 500 would slip. Locks a frozen matrix guarantee. Route: **patch** (add test).
- **[BH8] No route test for the `sheet` form-field forwarding** — `medium` — verified: the route reads `form.get("sheet")` and passes it to `parseSpreadsheet` as the chosen sheet (the story's headline multi-sheet wiring), but only the pure parser is tested with a chosen sheet; the route boundary wiring is unverified. Route: **patch** (add test).
- **[BH1] Dead `Import.fileLabel` i18n key** — `low` — verified unused (grep: appears only in en.json/fr.json, no component reference). Route: **patch** (remove key from both locales; direct deletion).
- **[EC2] Empty/whitespace `sheet` field defaults to 400 `unreadable`** — `low` — verified real: an empty `sheet` fails Zod base `.min(1)` before `superRefine`, so `errorForKey` falls to the default. Rejected: unreachable via the UI (client only sets `sheet` when non-empty; button disabled while ""); fix restructures the schema (more than a direct correction).
- **[BH2] Chosen filename never shown before preview** — rejected — enhancement beyond intent; the spec/AC do not require filename display and the preview surfaces `sheetName`. Not a defect.
- **[BH3] `genericError` 400 path (formData failure / missing slug) not in matrix + untested** — rejected — the matrix-gap fix would edit the frozen spec (disallowed); the missing-slug/formData-failure branches are reachable only by malformed non-UI requests (the client always sends a valid `slug` + multipart). Low harm.
- **[BH4] `aria-describedby` stale id + no announcement of terminal states** — `low`/partly false — errors ARE announced (verified `role="alert"` at ImportDropzone.tsx:240) and the success path renders a semantic heading section. Rejected: everyday-unlikely barrier, fix adds an extra live region (complexity).
- **[BH5] Multi-sheet re-analyze error resets and forces re-upload** — `low` — verified: `reset()` clears `pendingFile`/`sheetNames`. Needs a multi-sheet workbook whose chosen sheet is empty (uncommon) and is recoverable by re-upload; fix adds a state branch. Rejected (low, everyday-unlikely, fix > direct correction).
- **[BH6] `extensionOf` duplicated in schemas.ts and parse.ts with divergent path handling** — `low` — verified two impls, but the divergence only bites filenames the schema guard already rejects upstream, so no demonstrated harm reaches the parser; fix is a refactor. Rejected (low, guarded upstream).
- **[BH7] `file.size < 0` dead condition in the Zod refinement** — `low`/cosmetic — verified unreachable (`File.size` ≥ 0). Rejected (negligible, no user/dev harm).
- **[BH9] CSV filename stem presented as "sheet" in preview copy** — `low` — verified interpolation `in {sheet}` = stem; reads acceptably ("in customers"). Rejected (cosmetic copy, no clear defect).
- **[BH10] No row-count bound / no deferral note for the 5,000-row constraint** — rejected — the 5 MB file cap bounds the preview; the 5,000-row/60s limit is an import (4.4) constraint; adding a note would edit the frozen spec.

## Verification

**Commands:**
- `npm run test -- tests/unit/import-parse.test.ts tests/unit/route-import-analyze.test.ts` -- expected: all parse + route edge-case tests pass. (Path changed from `src/lib/import/parse.test.ts` — see Spec Change Log.) VERIFIED: 14 + 11 pass; full suite 506/506 across 49 files.
- `npx tsc --noEmit` (or the project typecheck script) -- expected: no type errors. VERIFIED: no errors from Story 4.1 files. One pre-existing baseline error in the unmodified `src/app/api/claim/route.ts` is unrelated to this story.
- `npm run lint` -- expected: clean. VERIFIED: clean (only the project-wide eslintrc-deprecation warning).

**Manual checks:**
- On `/[slug]/import` as an Admin: upload a real multi-column CSV and an `.xlsx`, confirm columns + sample values render < 5s; upload a `.pdf` and a >5 MB file and confirm translated retryable errors; toggle locale to `fr` and confirm copy is translated.
