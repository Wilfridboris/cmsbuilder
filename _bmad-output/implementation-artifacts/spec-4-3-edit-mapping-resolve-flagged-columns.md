---
title: 'Story 4.3: Edit Mapping & Resolve Flagged Columns'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'b77fa8a30b138c73b973a9c6b24dd3c83e9213f1'
context:
  - '_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After 4.2 the Admin sees the proposed mapping but cannot change it, and every flagged (unmatched or low-confidence) column would be silently carried into the commit. The Admin must be able to correct any assignment, explicitly resolve each flagged column (remap or skip), and be blocked from importing until nothing is unresolved. Two 4.2 polish gaps ride along: the "Maps to" column shows the raw field key (`customer_name`) instead of its human label ("Customer Name"), which owners misread as a source column; and the AI `reason` stays English under the `fr` locale.

**Approach:** Make the 4.2 mapping surface editable. The Admin import server page loads the org schema and passes a client-safe `FieldCatalog` (non-hidden tables/fields with labels + types) into the view; each row gains a target-field picker (grouped by table) plus a "skip" option, and key targets now render as labels via that catalog. A pure resolution module tracks each column's decision, computes which flagged columns remain unresolved, and gates a new Import action (disabled, naming what remains, until every flagged column is resolved). The propose route threads the request locale into the mapping prompt so the AI writes each `reason` in the user's language. Still writes NOTHING to tenant data — the commit is 4.4.

## Boundaries & Constraints

**Always:**
- Two-phase invariant: 4.3 is analyze-phase and writes NOTHING to `records`, `org_schemas`, or any tenant table. Editing/resolution are client state over the 4.2 proposal; the propose route only READS the schema. Commit is 4.4.
- The import server page keeps its admin gate and additionally resolves the caller's RLS-scoped client + orgId (`resolveOrgIdentity`) and READS the schema (`getSchema`) to build the `FieldCatalog` — non-hidden tables/fields only, each `{ key, label, type }` (safe metadata). A schema read failure or empty schema degrades gracefully (picker offers only "skip"; no crash).
- Every row's target is editable to any non-hidden catalog field (grouped by table, preserving the frozen `{ table, field }` model) OR to "skip"; changes update only client state.
- Resolution gate: a column is "flagged" exactly when it is in the proposal's `unmapped` set (null target OR below-threshold). Each flagged column needs an explicit decision (choose a field, or skip) to count resolved; confident columns start resolved but stay editable. The Import action is disabled while any flagged column is unresolved and the surface names which remain.
- Target fields render as their human `label` (resolved from the catalog by key), never the raw key, in table + card + picker; a key with no catalog match falls back to the key.
- The propose route resolves the locale from the `NEXT_LOCALE` cookie (mirroring `request.ts`: `isLocale` else `defaultLocale`) and passes it to `buildMappingPrompt`, which tells the model to write each `reason` in that language (en → English, fr → French). This is the ONLY propose change; envelope, auth chain, sanitizer, and retry contract are unchanged.
- New UI copy resolves through next-intl (en + fr), real French, no em-dashes; keep the a11y baseline (labeled controls, ≥48×48px targets, WCAG AA, `aria-live` for the unresolved count).

**Never:**
- Never write to any tenant table, create/alter schema fields, or commit — that is 4.4. The 4.3 Import button only becomes ENABLED when resolution is complete; wiring its click to commit is 4.4.
- Never use the service-role client to read the schema / build the catalog; use the RLS-scoped client, as the propose route does.
- Never move a flagged column to resolved without an explicit Admin action (map or skip).
- Never break the 4.2 fallback: if the auto-proposal is unavailable (`Import.error.mappingUnavailable`), the Admin can still map fully manually (every column starts unmapped, resolved via the picker).
- Decision (2026-09-28): "map to a new field" (FR50) is interpreted as **remap to a different EXISTING field**; the picker offers existing non-hidden fields + "skip" only. Creating a brand-new schema field (label + type + validation) is OUT of scope here — it is a write that belongs with 4.4's commit and is logged in `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Confident column | Proposal target is set and above threshold | Row starts resolved, target shown as its label; editable; not counted as remaining | N/A |
| Flagged low-confidence | Column in `unmapped` with a tentative target | Row starts unresolved and flagged; counts as remaining until the Admin confirms/changes/skips it | N/A |
| Flagged unmatched | Column in `unmapped`, `target: null` | Row starts unresolved, shows "not matched"; must be mapped or skipped | N/A |
| Remap | Admin picks a different field for a column | Decision becomes that `{table, field}`; row resolved; remaining count drops | N/A |
| Skip | Admin chooses "skip this column" | Decision becomes skip; row resolved and visibly marked skipped; remaining count drops | N/A |
| All resolved | No flagged column remains unresolved | Import action enabled; readiness message shown | N/A |
| Unresolved remain | ≥1 flagged column unresolved | Import action disabled; surface names the remaining columns | N/A |
| Label lookup | Target key present in catalog | Human label rendered | Key not in catalog → render the key verbatim |
| Empty / unreadable schema | `getSchema` empty or errors | Catalog empty; picker offers only "skip"; all columns resolvable by skipping; no crash | Degrade silently, no error screen |
| fr locale reason | `NEXT_LOCALE=fr` at propose time | Model prompt instructs French `reason`; app copy already French | Prompt still returns; sanitizer unchanged |

</frozen-after-approval>

## Code Map

- `src/app/[slug]/import/page.tsx` -- EXTEND: after the admin gate, `resolveOrgIdentity(slug, user.id)` → `{ client, orgId }`, `getSchema(client, orgId)`, build a non-hidden `FieldCatalog`, pass it to `ImportView`. Keep the existing redirect gates.
- `src/components/import/ImportView.tsx` -- EXTEND: accept `fieldCatalog`; own the per-column `decisions` state (init from the proposal via the new resolve module), reset it when a proposal loads/retries; compute readiness; render the gated Import button + remaining-columns message; pass catalog + decisions + `onDecisionChange` down.
- `src/components/import/MappingProposal.tsx` -- EXTEND (now the editable/resolvable surface): render the "Maps to" cell as a grouped `Select` (existing fields by table + a "skip" item), show target LABELS (via catalog), mark skipped/resolved rows, and drive the flagged highlight from unresolved (not just `unmapped`). Read-only loading/error states unchanged.
- `src/lib/import/resolve.ts` -- NEW pure module: `MappingDecision` (`{kind:"map";table;field} | {kind:"skip"} | {kind:"unresolved"}`), `initialDecisions(proposal)`, `unresolvedColumns(proposal, decisions)`, `isReadyToImport(proposal, decisions)`, `resolveFieldLabel(catalog, table, field)`. No I/O, no framework imports.
- `src/types/import.ts` -- EXTEND: add `FieldCatalog` (`Array<{ tableKey; tableLabel; fields: Array<{ key; label; type }> }>`); re-export `MappingDecision` from resolve or define here. Do NOT change frozen `ColumnMapping` / `ImportProposal`.
- `src/lib/import/mapping.ts` -- EXTEND `buildMappingPrompt(columns, sampleRows, schema, locale?)`: optional `locale` (default `defaultLocale`) adds one instruction line: write each `reason` in the mapped language. Keep the schema/sanitizer/threshold unchanged.
- `src/app/api/import/propose/route.ts` -- EXTEND: read the `NEXT_LOCALE` cookie (via `next/headers` `cookies()` + `isLocale`/`defaultLocale`), pass the locale to `buildMappingPrompt`. No other change.
- `src/lib/i18n/config.ts` -- REUSE `isLocale`, `defaultLocale`, `LOCALE_COOKIE`, `Locale`.
- `src/lib/data/records.ts` -- REUSE `getSchema(client, orgId)`. `src/lib/api/route-helpers.ts` -- REUSE `resolveOrgIdentity`. `src/types/db.ts` -- `SchemaDefinition`, `TableDefinition`, `FieldDefinition { key, label, type, hidden }`.
- `src/components/ui/select.tsx` -- REUSE `Select`/`SelectTrigger`/`SelectContent`/`SelectGroup`/`SelectLabel`/`SelectItem` (match the `ImportDropzone` sheet-picker pattern, `min-h-12`).
- `src/lib/i18n/en.json` + `fr.json` -- EXTEND the `Import.mapping` namespace (picker label, choose-field, skip, skipped/set-by-you marker, remaining-columns gate copy, ready + import-button label). Real French, no em-dashes.
- `tests/unit/import-mapping.test.ts`, `tests/unit/route-import-propose.test.ts` -- UPDATE for the new `buildMappingPrompt` locale arg + cookie threading (keep 4.2 assertions green).

## Tasks & Acceptance

**Execution:**
- [x] `src/types/import.ts` -- add `FieldCatalog`; keep frozen types intact.
- [x] `src/lib/import/resolve.ts` -- pure `MappingDecision` model + `initialDecisions`, `unresolvedColumns`, `isReadyToImport`, `resolveFieldLabel`.
- [x] `src/lib/import/mapping.ts` -- add optional `locale` param to `buildMappingPrompt`; append the "write reason in <language>" instruction (en/fr).
- [x] `src/app/api/import/propose/route.ts` -- resolve locale from the `NEXT_LOCALE` cookie and pass it to `buildMappingPrompt`.
- [x] `src/app/[slug]/import/page.tsx` -- load schema under the RLS client, build the non-hidden `FieldCatalog`, pass it to `ImportView`; degrade gracefully on read failure.
- [x] `src/components/import/MappingProposal.tsx` -- editable target picker (grouped, + skip), label rendering via catalog, skipped/resolved states, unresolved-driven flagging; loading/error states unchanged.
- [x] `src/components/import/ImportView.tsx` -- accept `fieldCatalog`; own decisions + readiness; render the gated Import button and remaining-columns message; reset on new proposal.
- [x] `src/lib/i18n/en.json` + `fr.json` -- add the new `Import.mapping.*` keys (real French, no em-dashes).
- [x] `tests/unit/import-resolve.test.ts` -- vitest over the resolution matrix (initial decisions, remap, skip, unresolved gate, readiness, label lookup + fallback, empty catalog).
- [x] `tests/unit/import-mapping.test.ts` + `tests/unit/route-import-propose.test.ts` -- update for the locale arg / cookie threading; assert the fr prompt requests a French reason and 4.2 behavior is unchanged.

**Acceptance Criteria:**
- Given a proposed mapping, when the Admin opens the import surface, then every row's target is editable (remap to any non-hidden field, or skip) and nothing is written to `records`/`org_schemas` (verify via network + DB).
- Given columns the AI could not confidently map, when the mapping renders, then each is visibly flagged and the Import action stays disabled, naming the remaining columns, until each flagged column is explicitly mapped or skipped.
- Given the target fields, when the mapping renders, then each shows its human label (e.g. "Customer Name"), not the raw key (`customer_name`).
- Given the `fr` locale, when the proposal is generated, then the per-column `reason` text is French, and all app copy remains real French with no em-dashes.

## Implementation Notes

## Spec Change Log

## Review Triage Log

### Pass 1 (2026-09-28)

- **[F0] Manual-mapping fallback on proposal failure not implemented** — `medium` → **patch** — Verified: on a `mappingUnavailable` error `ImportView` renders only `MappingProposal`'s error card + Retry (`status==="error"`), and `ImportGate` renders only when `status==="ready" && proposal`, so there is NO editable surface on failure. This breaks the frozen boundary ("if the auto-proposal is unavailable, the Admin can still map fully manually") and gates the whole import on LLM availability, contrary to the epic/4.2 design. Additive fix over the existing correct editable surface (no re-architecture) → patch.
- **[F1] Out-of-catalog resolved `map` target renders blank in the picker trigger (no key fallback)** — `low` → **patch** — Verified: `TargetPicker` uses `<SelectValue placeholder=…>`; Radix `SelectPrimitive.Value` echoes the selected item's text and renders nothing when the value matches no `SelectItem`, so a seeded target absent from the catalog (schema drift between page-load catalog and propose-time proposal) shows blank, not the key — violating the frozen matrix row "key not in catalog → render the key verbatim." The written+tested `resolveFieldLabel` fallback is never wired. Fix is a direct correction using the existing helper → patch.
- **[F2] `decisionFor` (and, pre-F1, `resolveFieldLabel`) exported but unused** — `low` → **patch** — Verified via grep: referenced only by tests/docs. Grouped with F1's fix (wiring `resolveFieldLabel` makes it used; delete the still-unused `decisionFor`).
- **[F6] Stale AI confidence%/reason shown after the Admin overrides or skips a flagged column** — `low` → **patch** — Verified: `MappingRow`/`MappingCard` render `mapping.confidence`/`mapping.reason` (the AI's original guess) regardless of the current decision, so a remapped/skipped column shows a % and reason describing a field the user rejected. Everyday (remap is a core action). Fix: show AI confidence/reason only when the current decision's target equals `mapping.target`.
- **[F10] Import-page catalog projection untested (hidden-field exclusion + degrade-to-`[]`)** — verification-gap, pre-verified → **patch** — No test invokes `ImportPage`; inverting the `!hidden` filter would leak hidden fields into the client picker (a forbidden contract break) or a rethrow would crash instead of degrade, both undetected. Repo has the pattern (`slug-dashboard-page.test.tsx`). Add `tests/unit/import-page.test.tsx`.
- **[F11] `MappingProposal`/`ImportView` component behavior untested (flag-clear, remaining count, picker round-trip)** — verification-gap → **defer** — The load-bearing predicate logic is unit-tested in `resolve.ts`; a first-ever RTL harness for this Select/framer-motion/next-intl component is disproportionate to this change. Logged to deferred-work.
- **[F3] `valueToDecision` mis-splits a key containing `::`** — `false` — `normalizeTableName` restricts every stored table/field key to `[a-z0-9_]` (`utils.ts:57`), so `::` can never appear in a real key; `targetValue`/`split("::")` round-trips safely. Unreachable.
- **[F4] Select could emit a value that silently reverts a column to unresolved** — `false` — Radix `onValueChange` fires only with an actual `SelectItem` value (`targetValue(...)` or `SKIP_VALUE`); the UI cannot emit an empty/one-part value, so the `{kind:"unresolved"}` branch is unreachable defensive code.
- **[F5] Redundant `resolveOrgIdentity` org lookup despite `requireAdmin` returning orgId** — `low`, rejected — `getSchema` needs the RLS-scoped client that only `resolveOrgIdentity` builds (`requireAdmin` returns membership metadata, not a client); this mirrors the established `/api/import/propose` pattern. One extra indexed by-slug query per page load is negligible; the fix would diverge from the shared pattern (adds complexity, unlikely everyday harm).
- **[F7] `remaining` columns message is unbounded (no cap / "and N more")** — `low`, rejected — Cosmetic; the info is accurate; only long with many unresolved columns; a truncation cap adds branching complexity for negligible everyday harm.
- **[F8] Locale-cookie resolution duplicated instead of a shared `resolveRequestLocale` helper** — `low`, rejected — Maintainability only, no runtime defect; both paths funnel through `isLocale(...) ? … : defaultLocale`; extracting a helper adds new public surface for a latent, not-everyday risk.
- **[F9] `FieldCatalog.type` threaded from the server but not consumed** — `low`, rejected — Per spec (`FieldCatalog` is `{key,label,type}`); a small, harmless, forward-looking payload for 4.4 type-aware handling — not a defect.

**Outcome:** No `intent_gap` or `bad_spec` (no frozen-block ambiguity; the foundation is sound). Four `patch` entries (F0 manual fallback, F1+F2 label fallback + dead helper, F6 stale AI metadata, F10 page test) re-engage the implementation subagent; one `defer` (F11). No loopback.

## Design Notes

- **Decision state, not proposal mutation.** The frozen `ColumnMapping.target` cannot distinguish "null = unresolved" from "null = skipped", so 4.3 layers a client `MappingDecision` per column over the immutable proposal. Confident columns seed `{kind:"map"}`; flagged columns (`proposal.unmapped`) seed `{kind:"unresolved"}` — an explicit action is required even when a tentative target exists. Gate = `unresolvedColumns(...).length === 0`.
- **Labels are a client lookup — no frozen-contract change.** The catalog carries labels + picker options from one source (the server page); the propose response keeps returning key-only targets. Closes both 4.2 deferred items with the schema 4.3 needs anyway.
- **Picker.** shadcn `Select` with `SelectGroup`/`SelectLabel` per table + a "skip" item; field lists are small (no combobox). Match `ImportDropzone` styling (`min-h-12`).
- **Import seam.** 4.3 owns the button's enabled/disabled gate; its onClick is a seam (`onImport`) that 4.4 wires to `/api/import/commit`. No write path here.

## Verification

**Commands:**
- `npm run test -- tests/unit/import-resolve.test.ts tests/unit/import-mapping.test.ts tests/unit/route-import-propose.test.ts` -- expected: all pass (new resolution suite + updated locale suites).
- `npx tsc --noEmit` -- expected: no new type errors (the pre-existing `src/app/api/claim/route.ts` baseline error is unrelated).
- `npm run lint` -- expected: clean (only the project-wide eslintrc-deprecation warning).

**Manual checks:**
- On `/[slug]/import` as an Admin: upload a CSV, confirm targets show human labels; change a mapping and skip a column; confirm flagged columns block the Import button until resolved and the remaining list is accurate; inspect network + DB to confirm nothing is written; toggle `fr` and confirm both app copy and the AI `reason` are French.
