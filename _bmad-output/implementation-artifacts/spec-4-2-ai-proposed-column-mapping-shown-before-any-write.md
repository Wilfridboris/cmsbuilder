---
title: 'Story 4.2: AI-Proposed Column Mapping (Shown Before Any Write)'
type: 'feature'
created: '2026-09-27'
status: 'done'
route: 'dispatch'
baseline_commit: 'a62f726bb572d50dd54912917a191099eff5e820'
review_loop_iteration: 0
context:
  - '_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After 4.1 an Admin sees the columns parsed from their spreadsheet but nothing tells them where those columns will land. Before any real data is committed they must see the system's proposed source-column to target-field mapping and its reasoning, with every column the AI cannot confidently place clearly flagged, so they can trust the import. Silently guessing would corrupt their newly claimed tables.

**Approach:** Add a read-only mapping-proposal phase on top of 4.1's preview. A new Admin-only `POST /api/import/propose` re-parses the file server-side, reads the org's existing schema, asks Gemini (via the shared hardened client) to map each source column to an existing target field with a confidence and a one-line reason, validates every proposed target against the real schema, flags low-confidence and unmatched columns, and returns an `ImportProposal`. The UI renders it as a "shows its work" mapping table. Editing/resolving (4.3) and commit (4.4) build on this; 4.2 still writes nothing.

## Boundaries & Constraints

**Always:**
- Two-phase invariant holds: propose is analyze-phase and writes NOTHING to `records`, `org_schemas`, or any tenant table. It only READS the schema via `getSchema`.
- Auth mirrors 4.1 analyze: authenticate, `resolveOrgIdentity(slug, actorId)` (non-member → 403), `requireAdmin` (Member → 403), and a `membership.slug === slug` check (cross-org Admin → 403), all before any parse or AI work.
- Parse strictly server-side by re-running `parseSpreadsheet` on the uploaded bytes (same ≤5 MB + extension guard as analyze); never trust client-parsed columns/rows.
- Map only to EXISTING, non-hidden fields in the caller's `org_schemas`. Every Gemini-proposed `{table, field}` must resolve (via `normalizeTableName`) to a real non-hidden field in the loaded schema; any that does not becomes `target: null`, never silently kept.
- Columns below the confidence threshold or with `target: null` are flagged as needing resolution and listed in `unmapped`. Every source column appears exactly once in `mappings`.
- Call Gemini through the shared `callGeminiWithTimeout` (which applies `HARDENED_SYSTEM_PROMPT`) with a mapping response schema; retry once on failure, mirroring `/api/generate`. Output is structure-only, never DDL.
- On a Gemini mapping failure (timeout or unparseable output) after one retry, return the translated key `Import.error.mappingUnavailable`; the UI shows an "auto-mapping unavailable" state with a Retry and still lets the Admin continue to manual mapping in 4.3. Nothing is written and no column is silently guessed. (Resolved 2026-09-27: chose an explicit translated error over silent degradation, matching the epic's translated-error-with-retry convention.)
- Return the `{ data, error }` envelope where `error` is a translation KEY; never expose raw LLM output, stacks, SQL, or schema JSON. All UI copy resolves through next-intl (en + fr): no hardcoded strings, no em-dashes.
- UI meets the platform accessibility baseline (semantic table + caption, ≥48×48px targets, WCAG AA, aria-live for the async proposal); build it following the `/web-uiux-architect` skill and reuse the ColumnPreview responsive table/card pattern.

**Never:**
- Never write to any tenant table, and never use the service-role client for tenant data (service-role is used only inside `requireAdmin`'s narrow membership read, as in 4.1).
- Never propose or create NEW schema fields, make the mapping editable, or commit it — pointing a column at a new field and resolving flags is Story 4.3; committing is 4.4.
- Never persist the uploaded file or the proposal; 4.2 is stateless (re-parse per call, no `fileId`).
- Never let a Gemini hallucination reach the client as a real mapping — unresolved targets are downgraded to `null` before returning.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Confident matches | Admin posts a file whose columns match existing fields | `ImportProposal { rowCount, mappings, unmapped }`; each matched column has a `target`, `confidence ≥ threshold`, and `reason`; renders within ~5s | N/A |
| Low-confidence column | A column Gemini maps with confidence < threshold | Kept in `mappings` with its tentative target but flagged; `sourceColumn` added to `unmapped` | N/A |
| No good match | Gemini returns null / no target for a column | `target: null`, added to `unmapped`, shown as "not mapped" | N/A |
| Hallucinated target | Gemini names a table/field absent from the schema | Target downgraded to `null`, column flagged unmapped | N/A |
| Empty schema | Org schema has no tables/fields | All columns `target: null`, all `unmapped` | N/A |
| Gemini failure | Timeout or unparseable output after retry-once | Translated "auto-mapping unavailable" state with a Retry; Admin may still continue to manual mapping (4.3); nothing written | `Import.error.mappingUnavailable` |
| Multi-sheet Excel | Same `sheet` field as analyze; chosen sheet re-parsed | Proposal for the chosen sheet's columns | `Import.error.*` on parse fail |
| Non-Admin / anon | Member, anon, or missing session | Rejected before any parse or AI call | forbidden (403) / unauthorized (401) |
| File errors | Empty / oversized / unreadable / missing file | Translated retryable error, no AI call | `Import.error.empty` / `.tooLarge` / `.unreadable` / `.noFile` |

</frozen-after-approval>

## Code Map

- `src/app/api/import/analyze/route.ts` -- exemplar to MIRROR for the new propose route: auth chain, `formData` read (slug/file/sheet), `errorForKey` mapping, `{ data, error }` envelope. Do not modify.
- `src/lib/import/parse.ts` -- REUSE `parseSpreadsheet(buffer, filename, chosenSheet?) : { columns, rows, sheetName, sheetNames? }` and `ParseError`. Do not change.
- `src/app/api/import/schemas.ts` -- REUSE `analyzeInputSchema` (file present, ≤ `MAX_UPLOAD_BYTES`, extension in `ACCEPTED_EXTENSIONS`, optional `sheet`) as the propose guard.
- `src/lib/gemini/client.ts` -- REUSE `callGeminiWithTimeout<T>(userPrompt, responseSchema, timeoutMs?)` (applies `HARDENED_SYSTEM_PROMPT`, JSON mode, 15s wall). Do not change.
- `src/app/api/generate/route.ts` -- exemplar for the call → validate/sanitize → retry-once pattern. Mirror; do not modify.
- `src/lib/data/records.ts` -- REUSE `getSchema(client, orgId): Promise<ApiResponse<SchemaDefinition>>` to load target tables/fields under the RLS-scoped client. Do not change.
- `src/types/db.ts` -- target shapes `SchemaDefinition`, `TableDefinition`, `FieldDefinition { key, label, type, hidden?, ... }`; enumerate targets as non-hidden fields per table.
- `src/lib/utils.ts` -- REUSE `normalizeTableName(input)` to match proposed targets to real table/field keys.
- `src/lib/api/route-helpers.ts` -- REUSE `resolveOrgIdentity`, `json`, `handleError`, `AppError`; plus `requireAdmin` + `createAdminClient` exactly as analyze uses them.
- `src/lib/data/import-client.ts` -- EXTEND: add `proposeMapping(...)`; reuse the existing `ImportApiError` code-carrying pattern.
- `src/components/import/ImportView.tsx` -- EXTEND: retain the File + chosen sheet after preview, auto-fetch the proposal, render `MappingProposal`.
- `src/components/import/ColumnPreview.tsx` -- pattern to MIRROR for the responsive mapping table (semantic `<Table>` + sr-only `<caption>` + mobile `<dl>` cards, `cellEmpty`).
- `src/lib/i18n/en.json` + `fr.json` -- EXTEND the `Import` namespace with a `mapping` sub-namespace; real French, no em-dashes.
- NEW files: `src/types/import.ts`, `src/lib/import/mapping.ts`, `src/app/api/import/propose/route.ts`, `src/components/import/MappingProposal.tsx`, and the two test files below.

## Tasks & Acceptance

**Execution:**
- [x] `src/types/import.ts` -- define `ColumnMapping { sourceColumn: string; target: { table: string; field: string } | null; confidence: number; reason?: string }` and `ImportProposal { rowCount: number; mappings: ColumnMapping[]; unmapped: string[] }`; shared by route, client, components, and 4.3/4.4.
- [x] `src/lib/import/mapping.ts` -- pure, framework-free: `buildMappingPrompt(columns, sampleRows, schema)`, `MAPPING_RESPONSE_SCHEMA` (Gemini structured-output shape), `MAPPING_CONFIDENCE_THRESHOLD = 0.7`, and `sanitizeProposal(rawGeminiOutput, schema, sourceColumns, rowCount): ImportProposal` (resolve targets against non-hidden schema fields via `normalizeTableName`, clamp confidence to [0,1], flag null/below-threshold into `unmapped`, ensure each source column appears exactly once). No I/O, no framework imports.
- [x] `src/app/api/import/propose/route.ts` -- `POST`: auth chain (mirror analyze), read `formData` (slug/file/optional sheet), guard, `parseSpreadsheet`, `getSchema`, `callGeminiWithTimeout(buildMappingPrompt(...), MAPPING_RESPONSE_SCHEMA)` with retry-once, `sanitizeProposal`, return `{ data: ImportProposal, error: null }`. On Gemini failure after retry-once, throw `AppError` carrying `Import.error.mappingUnavailable`. No DB writes; map file/parse failures to existing `Import.error.*` keys via `AppError`/`handleError`.
- [x] `src/lib/data/import-client.ts` -- add `proposeMapping(slug, file, sheet?): Promise<ImportProposal>` posting multipart to `/api/import/propose`, returning the proposal or throwing `ImportApiError(code)`.
- [x] `src/components/import/MappingProposal.tsx` -- read-only "shows its work" mapping table: per source column show the proposed target field label, a confidence indicator, and the reason; visibly flag unmapped/low-confidence columns and summarize how many still need resolution; loading state and an "auto-mapping unavailable" error state with a Retry (`Import.error.mappingUnavailable`); responsive table+card mirroring `ColumnPreview`. Built per `/web-uiux-architect`.
- [x] `src/components/import/ImportView.tsx` -- after a preview resolves, keep the File + chosen sheet, auto-call `proposeMapping`, and render `MappingProposal` with its own loading/error state below the preview; keep "Start over".
- [x] `src/lib/i18n/en.json` + `fr.json` -- add `Import.mapping.*` (heading, summary, source/target/confidence/reason headers, `notMapped`, flagged badge, unmapped summary, loading) plus `Import.error.mappingUnavailable` (reuse existing `Import.retry`); real French, no em-dashes.
- [x] `tests/unit/import-mapping.test.ts` -- vitest for `sanitizeProposal` across the matrix (confident, low-confidence, null, hallucinated target, empty schema, missing column filled, confidence clamp, duplicate targets preserved) and `buildMappingPrompt` output shape.
- [x] `tests/unit/route-import-propose.test.ts` -- route tests: 401/403 before any parse/AI, guard rejections, Gemini success → sanitized proposal, the Gemini-failure branch → `Import.error.mappingUnavailable`, and assert no tenant writes (mock `callGeminiWithTimeout` + `getSchema`).

**Acceptance Criteria:**
- Given an Admin uploads a spreadsheet whose columns match existing fields, when the propose phase runs, then a mapping proposal renders showing each column's target field, confidence, and reason, and nothing is written to `records` or `org_schemas` (verify via network + DB inspection).
- Given Gemini proposes a table or field absent from the org schema, when the proposal is sanitized, then that column is returned `target: null` and flagged unmapped (no hallucinated target reaches the UI).
- Given the `fr` locale, when the mapping surface renders, then all copy is real French via next-intl with no hardcoded strings and no em-dashes.
- Given a non-Admin or unauthenticated caller, when `/api/import/propose` is called, then it returns 403/401 before any parse or Gemini call.

## Implementation Notes

- **Separate `/api/import/propose` route (not folded into analyze).** Propose is its own single-purpose route mirroring analyze's auth chain; the client re-posts the File (+ chosen sheet) so parsing stays strictly server-side. `ImportView` now retains `{ preview, file, sheet }` and auto-fires `proposeMapping` the moment a preview resolves, driving `MappingProposal`'s loading/ready/error states. `ImportDropzone.onPreview` was widened to lift the `file` + resolved `sheet` upward (import stays stateless, no `fileId`).
- **`sanitizeProposal` is the trust boundary.** It iterates the caller's real `sourceColumns` (never the model's list), resolves each proposed `{targetTable, targetField}` through a `normalizeTableName`-keyed index of real non-hidden fields, downgrades anything that does not resolve (hallucination, hidden field, half-null, empty schema) to `target: null`, clamps confidence to [0,1] (non-numbers → 0), and flags null/below-threshold columns into `unmapped`. Every source column appears exactly once; duplicate targets are preserved for 4.3.
- **Gemini failure path.** `callGeminiWithTimeout` is retried exactly once; a second failure throws `AppError(502, "Import.error.mappingUnavailable")`, which the client surfaces as the "auto-mapping unavailable" + Retry state. `reportError` logs both attempts. Multi-sheet workbooks with no chosen sheet return `Import.error.unreadable` (the client re-analyzes with a chosen sheet first, matching the analyze picker flow).
- **Known deviation — target shown as field KEY, not label.** The frozen `ColumnMapping.target` carries only `{ table, field }` keys and the frozen `ImportProposal` enumerates only `{ rowCount, mappings, unmapped }`, so no human label is available client-side; `MappingProposal` renders the target field **key** (e.g. `client_name`). Showing the human label would require widening the frozen contract (return the schema or add labels), so it is deferred — 4.3's editable field picker is the natural home for label display. The frozen AC ("showing each column's target field") is satisfied by the key. Flagged for the human in case a label is wanted sooner.
- **Cleanup.** Removed an unused `Import.mapping.flagged` i18n key from both locales (the component uses `flaggedBadge`), per Epic 3's dead-key retro action.
- **Verified:** `import-mapping` + `route-import-propose` = 32/32 pass; full suite 541 pass; `tsc` clean except the pre-existing unrelated `src/app/api/claim/route.ts` baseline error; lint clean.

## Spec Change Log

## Review Triage Log

### Pass 1 (2026-09-27)

- **[EC1/BH5] `buildTargetIndex` last-wins collision when two stored field keys normalize identically** — `low` — verified the overwrite exists (`mapping.ts` index keyed by `normalizeTableName(table.key)::normalizeTableName(field.key)`), but stored `org_schemas` keys are already normalized snake_case (persisted through `normalizeTableName` by the schema validator), so re-normalizing is idempotent and two distinct stored keys in one table cannot collide with a well-formed schema; even under legacy collision the worst case is resolving to one of two near-identical real fields (both real, non-hidden, user-reviewable) — no hallucination reaches the client. Route: **reject** (everyday-unlikely; fix adds a guard/restructures the index).
- **[EC2] A synchronous config error (missing `GEMINI_API_KEY`) is caught, retried, and surfaced as `Import.error.mappingUnavailable`** — `low` — verified the try/catch retries any error then throws `mappingUnavailable`; but the real cause is logged server-side via `reportError` (both attempts), the user is not blocked (they continue to manual mapping in 4.3), the message is an acceptable degraded fallback, and this mirrors the established `/api/generate` retry-any-error convention. A missing key is a deploy-time misconfig, not an everyday runtime path. Route: **reject** (everyday-unlikely; fix adds config-vs-transient branching).
- **[BH1] Route slices `rows.slice(0, SAMPLE_ROW_CAP)` (10) then the prompt re-caps to 5 samples/column** — `low` — verified; not dead code (the 10-row slice is the scan window from which up to 5 non-blank values per column are drawn — reasonable for sparse columns). No incorrect output; only a minor naming clarity nit (borrows 4.1's preview cap). Route: **reject** (negligible; no named harm).
- **[BH2] Blank-cell interaction with the 5-sample bound is untested** — `low` — verified the de-blank loop in `buildMappingPrompt` has no test with leading-blank cells; but this is a prompt-shaping heuristic (not a frozen matrix row), and a regression would at most send a blank sample to Gemini (harmless, output is schema-constrained). Route: **reject** (negligible harm; heuristic, not a behavioral contract).
- **[BH3] `unmapped` conflates null-target and below-threshold; name/copy misleading** — `false` — the claim "nothing lets a consumer distinguish no-target from low-confidence" is refuted: every `ColumnMapping` carries both `target` (null vs set) and `confidence`, so the two states are trivially distinguishable. The `unmapped` name + its "needs resolution" semantics are in the **frozen** `ImportProposal`/matrix; renaming would edit the frozen spec. Route: **reject** (false; and fix would edit frozen spec).
- **[BH4] No empty-state for zero source columns; count=0 renders "Every column was matched"** — `false` — unreachable: propose runs only after analyze produced a preview (which requires columns), and `parse.ts` throws `Import.error.empty` for header-only/no-data files, so `columns: []` with a readable sheet never reaches `sanitizeProposal`/`MappingProposal`. Route: **reject** (unreachable).
- **[BH6] Target rendered as field KEY, not human label (self-disclosed deviation)** — `low` — verified `MappingProposal` renders `mapping.target.field` (e.g. `client_name`). The frozen `ColumnMapping.target` carries only `{table, field}` keys, so a label needs a frozen-contract renegotiation; the frozen AC ("showing each column's target field") is satisfied by the key, and the key sits beside a plain-English reason + confidence %, keeping the surface readable. Already documented in Implementation Notes and surfaced to the human as a 4.3 (field-picker) candidate. Route: **reject** (low; only fix edits the frozen contract — human-owned).
- **[BH7] `resolveMappingError` whitelist includes codes the route "can never return"; unknown → mappingUnavailable** — `low` — partly false: the whitelisted codes CAN occur (e.g. session expiry between preview and propose → `unauthorized`), so the whitelist is appropriate; the residual is that a truly unexpected 5xx falls back to the "try again / map yourself" message — an acceptable degraded fallback in the mapping context. Route: **reject** (acceptable degradation; everyday-unlikely).
- **[BH8] No test asserts the "writes NOTHING" invariant beyond `getSchema` called once** — `low` — verified the route imports no mutation layer, so the invariant is structurally enforced (the Verification-Gap layer independently confirmed there is no write path); the mock exposes no write method to assert against without restructuring. Route: **reject** (invariant structurally guaranteed; negative-assertion test is low value).
- **[BH9] `"""`-delimited user data could break the fence / comment overstates the guarantee** — `low` — refuted in substance: the user data is `JSON.stringify`-encoded, so a literal `"""` in a cell becomes `\"\"\"` and cannot match the bare `"""` fence; combined with JSON-mode + `MAPPING_RESPONSE_SCHEMA` + `HARDENED_SYSTEM_PROMPT`, injection cannot alter output shape. Only the comment's absolute phrasing is slightly strong. Route: **reject** (no real harm; cosmetic).
- **[BH10] Retry has no backoff/jitter and logs attempt 1 as an error even on eventual success** — `low` — verified `reportError(firstErr, {attempt:1})` fires before the retry; but the 15s timeout already spaces attempts, and this mirrors the established `/api/generate` convention. Minor observability noise on self-healed calls. Route: **reject** (low; mirrors convention; fix adds complexity).
- **[BH-extra] `Session.sheet: string | undefined` vs optional `sheet?`; intentional `fr`/`en` `confidenceValue` "%" spacing divergence** — `low`/non-defect — the `%`-spacing divergence is correct French typography (not a bug); the explicit-`undefined` style is cosmetic. Route: **reject** (cosmetic / not a defect).
- **[VG-note] Implementation Notes say a `flagged` key was "removed" but the net diff only adds keys** — `low` — accurate about the action (the impl agent added `Import.mapping.flagged`; it was removed before the diff was regenerated, so the add+remove nets out); harmless clarity nuance in an agent-owned section. Route: **reject** (cosmetic doc nuance; no code impact).

**Outcome:** No `high`/`medium` findings; no `intent_gap`, `bad_spec`, `patch`, or `defer` entries. All findings verified `low` or `false` and rejected per the triage rules. No loopback; no code changes from review.

## Design Notes

- **Confidence threshold.** `MAPPING_CONFIDENCE_THRESHOLD = 0.7` (tunable constant); any mapping with `confidence < threshold` is flagged and added to `unmapped`. Clamp the model's confidence to [0,1] before comparing.
- **Prompt shape.** Send the source column names, up to 5 sample values per column (bounded to keep the prompt small on wide sheets), and the target schema as `{ table.key, table.label, fields: [{ key, label, type }] }` for non-hidden fields only. Instruct Gemini to pick the single best EXISTING target per column with a confidence 0-1 and a one-line reason, or null when nothing fits — never invent tables or fields.
- **Response + sanitize.** `MAPPING_RESPONSE_SCHEMA` = `{ mappings: [{ sourceColumn, targetTable: string|null, targetField: string|null, confidence: number, reason: string }] }`. `sanitizeProposal` converts this to `ColumnMapping[]`, drops any target that does not resolve to a real non-hidden field, computes `unmapped`, and guarantees one entry per source column (missing columns filled as `target: null`).
- **Duplicate targets** (two columns → same field) are preserved in the proposal and left for 4.3 to resolve; 4.2 does not deduplicate.

## Verification

**Commands:**
- `npm run test -- tests/unit/import-mapping.test.ts tests/unit/route-import-propose.test.ts` -- expected: all mapping + route tests pass.
- `npx tsc --noEmit` -- expected: no new type errors (one pre-existing baseline error in the unmodified `src/app/api/claim/route.ts` is unrelated to this story).
- `npm run lint` -- expected: clean (only the project-wide eslintrc-deprecation warning).

**Manual checks:**
- On `/[slug]/import` as an Admin: upload a CSV whose columns match your schema and confirm the mapping table shows target fields, confidence, and reasons, with unmatched/low-confidence columns visibly flagged; inspect network + DB to confirm nothing is written; toggle locale to `fr` and confirm copy is real French.
