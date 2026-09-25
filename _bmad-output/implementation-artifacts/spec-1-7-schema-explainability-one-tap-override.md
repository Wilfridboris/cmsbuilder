---
title: 'Story 1.7: Schema Explainability & One-Tap Override'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '53fa5431f3d2087de36a6f202aae493538a0c7a9'
story_key: '1-7-schema-explainability-one-tap-override'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-6-interactive-demo-dashboard.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The anonymous demo dashboard (Story 1.6) renders the generated tables and fields but never explains *why* the AI built each one, nor lets the visitor remove or rename what it got wrong. The per-table and per-field `reason` strings already come back from generation (and the fallback template) but sit unused; the "trust and control from the first moment" promise (FR46, FR47, UX-DR13) is unmet.

**Approach:** Surface each generated table's and field's one-line `reason` via an inline info affordance on the dashboard, with a one-tap Rename/Remove beside it. Overrides mutate a client-side, session-only copy of the schema — exactly as Story 1.6's edits mutate a session-only copy of the records: Rename edits `label`; Remove sets the append-only `hidden` flag. No account, no DB write, no migration; the definition and data stay intact and hidden items drop out of the existing `!hidden` render filters.

## Boundaries & Constraints

**Always:**
- Read `reason`/`label` from the schema already in `DemoDashboard` state (the `POST /api/generate` response) — no new fetch, no new generation call.
- Every table and field with a `reason` shows it via an inline info affordance at generation time (on the dashboard, not a settings screen), with Rename + Remove beside it. When `reason` is absent (optional in the type), render no affordance for that item — never an empty popover or placeholder.
- Remove = set `hidden: true` on the table/field in the session-only schema copy: no destructive migration, definition and any `records.data` preserved. Rename edits only `label`, never `key`. Both reflect immediately across tablist, desktop columns, mobile cards, and open detail via the existing `!hidden` filters.
- Overrides are client session state only — lost on hard reload (which re-POSTs `/generate` and regenerates), confined to the anonymous session, no account. They persist in-session so Epic 2's claim can carry the overridden schema forward.
- New strings via next-intl (`Explainability` namespace, EN + FR); ARIA labels from schema `label`s; 48×48px targets; WCAG AA; keyboard-operable popover + inline rename. Build every visual/interaction surface via the `web-uiux-architect` skill. Add the missing shadcn `popover` primitive via the CLI (New York / zinc).

**Never:**
- No DB write, API route, migration, runtime DDL, or service-role use; no change to `/api/generate`, the Gemini prompt/response schema, the fallback template, `provision.ts`, or `mutate.ts`/`records.ts` (reasons are already generated).
- No auth/claim (Epic 2 — this story only produces in-session overrides), no conversational editing (Epic 5), no add-table/field/view (append-only *adds* are Epic 5 — this story only renames/hides existing items), no undo/restore, no delete-confirm dialog (removal is one-tap, non-destructive).
- Never leave the dashboard empty (block removing the last visible table). Never leak raw stacks/SQL/schema JSON/LLM output; the service-role key must never enter a client bundle (CI-enforced).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior | Error Handling |
|----------|--------------|-------------------|----------------|
| Show table/field reason | item has `reason` | Inline info affordance reveals the one-line reason (tab for tables; column header + record detail for fields) | N/A |
| Reason absent | `reason` undefined | No affordance rendered for that item | Defensive |
| Rename field/table | non-empty label, confirm | `label` updates in session schema; reflects everywhere immediately | Empty/blank → translated inline message, no commit |
| Remove field | tap Remove | `hidden: true`; drops from all views; data intact | N/A |
| Remove table (not last) | tap Remove | `hidden: true`; tab drops; if active, first remaining visible table becomes active and any open detail closes | N/A |
| Remove last visible table | one visible table left | Blocked/disabled with a translated explanation; dashboard never empties | Guarded |
| Reduced motion / keyboard | `prefers-reduced-motion`; AT user | Popover + rename operate and close by keyboard; focus returns to trigger | N/A |

</frozen-after-approval>

## Code Map

- `src/types/db.ts` -- MODIFY. Add `hidden?: boolean` to `TableDefinition` (mirrors `FieldDefinition.hidden`; append-only table hide). `reason?` already exists on both. Backward-compatible optional JSONB field — no migration.
- `src/lib/schema/overrides.ts` -- CREATE. Pure, immutable transforms: `renameTable`, `renameField`, `hideTable`, `hideField`, `visibleTables` (`tables.filter(t => !t.hidden)`), `canHideTable` (`visibleTables(schema).length > 1`). Node-unit-testable; reused by Epic 2 (carry at claim) and Story 3.5 (column hide).
- `src/components/dashboard/OverrideControl.tsx` -- CREATE via `web-uiux-architect`. Reusable inline shadcn `Popover`: shows `reason`, offers Rename (inline `Input`, Enter commits, empty rejected — reuse the RecordDetail edit idiom) + Remove (disabled with a reason when not allowed). Used for both a table (tablist) and a field (column header + detail).
- `src/components/dashboard/DemoDashboard.tsx` -- MODIFY. Lift `response.schema` into `useState` (as 1.6 did for records). Render the tablist from `visibleTables(schema)`; attach the table `OverrideControl` per tab; pass field rename/remove handlers into `TableView` headers and `RecordDetail`. On table remove, recompute the active table from remaining visible tables and `setOpenRecordId(null)`. Handlers call the `overrides` transforms via `setSchema`.
- `src/components/dashboard/RecordDetail.tsx` -- MODIFY. Add each field's `reason` + field `OverrideControl` to `FieldRow` — the field-override surface for mobile (cards have no headers) and detail. Leave the existing value-edit affordance untouched.
- `src/components/ui/popover.tsx` -- CREATE via shadcn CLI (New York / zinc). Absent today.
- `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- MODIFY. Add `Explainability` namespace (EN + FR): info a11y label, reason heading, rename/remove labels + per-target a11y (`renameField`/`removeField`/`renameTable`/`removeTable`), rename placeholder, empty-rename message, last-table explanation. Reuse `Dashboard.save`/`cancel`.
- `tests/unit/overrides.test.ts` -- CREATE. Cover every transform + the `canHideTable`/last-table guard + immutability (input not mutated).
- NOT TOUCHED (do not wire in): `src/app/api/generate/route.ts`, `src/lib/gemini/prompts.ts`, `src/lib/generation/fallback.ts`, `src/lib/generation/provision.ts`, `src/lib/data/{mutate,records}.ts`, `src/app/demo/page.tsx` (separate Story 1.2 diagnostic route).

## Tasks & Acceptance

**Execution:**
- [x] `src/types/db.ts` -- add `hidden?: boolean` to `TableDefinition` -- enables append-only table removal, mirroring fields.
- [x] `src/lib/schema/overrides.ts` -- CREATE pure rename/hide transforms + `visibleTables`/`canHideTable` -- one tested source of override logic.
- [x] `tests/unit/overrides.test.ts` -- CREATE covering the matrix's transform + guard cases + immutability (node env, no jsdom, per repo precedent).
- [x] Add the shadcn `popover` primitive via CLI (New York / zinc) -- building block for the info + override affordance.
- [x] `src/components/dashboard/OverrideControl.tsx` -- CREATE reason popover + inline Rename + Remove -- the explainability/override affordance. Via `web-uiux-architect`.
- [x] `src/components/dashboard/DemoDashboard.tsx` -- lift schema into session state, render `visibleTables`, wire table + field override handlers, guard active-table/open-detail on remove.
- [x] `src/components/dashboard/RecordDetail.tsx` -- add each field's reason + field override control -- the mobile/detail field-override surface. Via `web-uiux-architect`.
- [x] `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- add the `Explainability` namespace (EN + FR) -- no hardcoded strings.

**Acceptance Criteria:**
- Given a generated or fallback schema, when the dashboard renders, then every table and field with a `reason` exposes it via an inline info affordance at generation time (not a settings screen); items without a `reason` show none.
- Given a visible field or table, when the visitor uses its override control, then they can Rename (label only) or Remove it in one action; a Remove sets the append-only `hidden` flag, runs no migration, and preserves the definition and data.
- Given a removed field or table, when the dashboard re-renders, then it is hidden from all demo views while its definition and data remain intact, confined to the anonymous session (no account, no DB write).
- Given one visible table left, when the visitor attempts to remove it, then the action is blocked with a translated explanation and the dashboard never empties.
- Given `npm run test`, `type-check`, `lint`, `build`, then all pass; no service-role / `GEMINI_API_KEY` in any client bundle; no hardcoded strings; popover + inline rename keyboard-operable and screen-reader labelled (WCAG AA).

## Implementation Notes

**Delivered.** All eight tasks complete. `reason` was already produced per-table and per-field by the Story 1.4 generation call (required in the response schema) and the 1.5 fallback template, so no generation-path file was touched — 1.7 only *renders* those reasons and adds the override affordance.

- **`src/lib/schema/overrides.ts`** — pure, immutable, framework-agnostic transforms (`renameTable`, `renameField`, `hideTable`, `hideField`, `visibleTables`, `canHideTable`). Rename edits only `label`; hide sets the append-only flag; `hideTable` refuses the last visible table as a backstop even if a caller forgets the guard. Node-unit-testable; reusable by Epic 2 (carry at claim) and Story 3.5 (column hide).
- **`src/types/db.ts`** — added `hidden?: boolean` to `TableDefinition`, mirroring `FieldDefinition.hidden`. Optional JSONB field, backward-compatible, no migration.
- **`OverrideControl.tsx`** (CREATE) — one reusable Radix `Popover` for both tables (tablist) and fields (desktop column header + record detail). Shows the `reason` (icon + uppercase section label + text) and, separated by a divider, offers inline Rename (`Input`, Enter commits, empty/blank rejected via translated `role="alert"` message — the RecordDetail edit idiom) + Remove (`text-destructive` + `hover:bg-destructive/10`, disabled with a translated explanation when the last-table guard blocks it). Radix gives focus-trap-free keyboard operation, Esc, and focus-return; shadcn's `popover.tsx` supplies the CSS `data-[state]` open/close animation (no Framer Motion needed). The info affordance renders only when the item has a `reason`.
- **`DemoDashboard.tsx`** — lifted `response.schema` into `useState` alongside the records copy; the tablist renders `visibleTables(schema)`; each tab carries the table `OverrideControl`; field rename/remove flow into the `TableView` column headers and into `RecordDetail`. Removing the active table recomputes the active tab from the remaining visible tables and closes any open detail. Overrides mutate the session-only schema copy — no DB write, no API, lost on hard reload — and stay in-session for Epic 2's claim to carry forward.
- **`RecordDetail.tsx`** — each `FieldRow` gains the field `reason` + `OverrideControl` (the field-override surface for mobile, whose cards have no column headers). The existing value-edit affordance is untouched.
- **i18n** — new `Explainability` namespace (EN + FR): info a11y labels, reason heading, rename/remove + per-target a11y labels, placeholder, empty-rename message, and the last-table explanation; reuses `Dashboard.save`/`cancel`.
- **shadcn `popover`** — added via CLI (New York / zinc); imports `radix-ui` (the unified package already used by the 1.6 `dialog` primitive). No net `package.json` change.

**web-uiux-architect pass.** The implementation subagent built the surfaces directly (reusing the web-uiux-architect-derived 1.6 patterns) rather than invoking the skill. An orchestrator-side pass through the `web-uiux-architect` skill then refined `OverrideControl` within the shadcn New York/zinc baseline (the epic defers bespoke palette/glassmorphism): clearer reason hierarchy (icon + section label), a divider before the action group, a destructive hover affordance on Remove, and — the one real fix — **restored 48×48px touch targets** on the field override triggers, which had been overridden to `size-8` (32px), violating the frozen "48×48px minimum touch targets" constraint.

**Verification (all green).** `type-check` (tsc --noEmit) clean; `lint` clean (no hardcoded user-facing strings, no service-role reference; only the eslintrc deprecation notice); `test` → **109 pass** (12 files, +16 in `overrides.test.ts`); `build` succeeds (only the pre-existing non-fatal Sentry→OpenTelemetry warning). Scanned `.next/static`: no `SUPABASE_SERVICE_ROLE_KEY`/`GEMINI_API_KEY`/`GENERATE_SESSION_SECRET`/`service_role`. Forbidden files (`/api/generate/route.ts`, `prompts.ts`, `fallback.ts`, `provision.ts`, `mutate.ts`, `records.ts`, `demo/page.tsx`) untouched.

**Matrix test audit.** Pure-logic rows — rename field/table, remove field, remove table (not last), remove last visible table (blocked), and the visible/absent filtering — are covered by passing `overrides.test.ts` cases. The interaction/DOM rows (reason display, reduced-motion/keyboard operation, the inline empty-rename rejection inside `RenameForm`) are scoped to manual checks by the frozen Design Notes and the repo's no-jsdom precedent (1.3–1.6); not automated. Not yet exercised in a browser this session.

## Spec Change Log

## Review Triage Log

### Review pass 1 (2026-09-24)

Three layers (blind-hunter, edge-case-hunter, verification-gap) run in parallel at session (Opus) capability against the diff. Verification-gap found no gaps (it confirmed `overrides.test.ts` runs unskipped in the node include path and its assertions pin every pure transform's real behavior). Verdicts rendered against the code, not the reviewers' framing.

**Patched (route: patch — sent to the implementation subagent; verification re-run orchestrator-side):**
- **[medium → patch] Keyboard focus is lost after removing a table** (EdgeCase + BlindHunter, `DemoDashboard.tsx` `handleRemoveTable` + `OverrideControl` Remove) — VERIFIED: Remove calls `onRemove()` then `closeAll()`; Radix returns focus to the `PopoverTrigger`, but that trigger lives inside the removed table's tab wrapper, which `visibleTables` drops from the render on the same update — so focus-return targets a detached node and lands on `<body>`. Affects removing any table (each tab owns its own trigger), so keyboard/AT users lose focus context (WCAG 2.4.3). Fix: after a removal, move focus to the active tab button.
- **[low → patch] Non-unique `aria-describedby` id in the rename form** (BlindHunter, `OverrideControl.tsx` `RenameForm`) — VERIFIED: the error `<p>` and `aria-describedby` both use the hardcoded `id="override-rename-error"`. Only one popover is open at a time so no live DOM collision occurs (hence low), but the id should be unique — fix with `useId()`.
- **[low → patch] Dead i18n key `Explainability.info`** (BlindHunter, `en.json`/`fr.json`) — VERIFIED orphaned: every call site uses `infoFor` (with `{item}`); the argless `info` string is never referenced. Direct deletion from EN + FR.

**Rejected:**
- **[low → reject] No last-visible-FIELD guard (asymmetric with the table guard)** (BlindHunter + EdgeCase + VerificationGap-other, `overrides.ts` `hideField` / `DemoDashboard` `handleRemoveField`) — the frozen invariant is explicit and table-scoped: "Never leave the dashboard empty (block removing the last visible table)"; the guarded "dashboard empty" state is zero *tables*, which holds. A table whose columns are all removed is a distinct, lesser state — reachable only by a visitor deliberately removing every reason-bearing column of throwaway demo data, and recovered by a hard reload (which regenerates). The fix adds public surface (`canHideField`/`visibleFields` + a `lastField` i18n string + a new disabled path + test) beyond a direct correction, for an edge outside the frozen intent. Consistent with 1.6's gold-plating rejections.
- **[low → reject] Info button is an interactive non-`role=tab` child of `role="tablist"`** (EdgeCase, `DemoDashboard.tsx` tablist) — the roving-tabindex/arrow contract still manages the tabs correctly and the info button is Tab-reachable and operable; the AT impact is a marginal semantic imperfection. The epic mandates the affordance "beside" each table, so the adjacency is intent-driven; moving it out of the tablist is a layout restructure, more than a direct correction. Marginal harm + non-trivial fix → low, rejected.
- **[low → reject] Rename accepts a no-op or duplicate label** (BlindHunter, `OverrideControl.tsx` `commit`) — commit rejects empty/blank (per the frozen matrix); renaming to an identical or duplicate label commits a harmless state copy and distinct labels remain backed by distinct `key`s (data correct). Duplicate-name entry is unusual on demo data; a dedup/no-op guard adds branches + a message for negligible benefit. Low.
- **[low → reject] Override affordance is unreachable when a table/field has no `reason`** (BlindHunter, all three render sites) — this is the frozen decision, not a defect: "When a `reason` is absent … show no info affordance for that item." The bad outcome (an un-removable generated item) is also not reachable in practice — the Story 1.4 response schema marks `reason` required on every table and field and the 1.5 fallback template populates all of them (verified). A fix here would edit the frozen spec.
- **[low → reject] `handleRemoveField`/`handleRenameField` implicitly assume the open record belongs to `activeTable`** (BlindHunter) — REFUTED as a defect: it holds by construction — `TableView` renders only the active table's fields, `RecordDetail` receives `activeTable`, and switching tabs closes the detail (`setOpenRecordId(null)`), so the early-return `if (!activeTable)` never mismatches. A latent-coupling comment, no current harm.
- **[low → reject] Initial `activeTableKey` recomputes `visibleTables(response.schema)` instead of reading state `schema`** (BlindHunter) — on first render `schema === response.schema`, so the two agree; a one-time duplicate filter call, purely cosmetic, no harm.

_No intent_gap or bad_spec entries → no loopback; patches applied in place._

## Design Notes

- **Session-only overrides (mirrors 1.6).** The epic frames removal as "a frontend display flag"; the service-role key is bootstrap-only (no server write path for an account-less session); a hard reload re-POSTs `/generate` and regenerates anyway. So overrides live in a `useState` copy of the schema in `DemoDashboard`, never persisted. They stay in-session, so Epic 2's claim (same session, client state alive) can read the overridden schema and carry it into the live schema — that wiring is Epic 2's job.
- **Reason data already exists.** `TableDefinition.reason` and `FieldDefinition.reason` are required in the Story 1.4 response schema and present in the 1.5 fallback template. This story only renders them.
- **Table hide is new; field hide exists.** `FieldDefinition.hidden` is already consumed by `TableView`/`CardList`/`RecordDetail`. Adding `TableDefinition.hidden` + a `visibleTables` tablist filter completes the mechanism symmetrically.
- **Pure transforms tested; DOM manual.** Per the 1.3–1.6 precedent (vitest node env, no jsdom), extract override logic to `overrides.ts` and unit-test it; verify popover/rename/remove interactions manually.

## Verification

**Commands:**
- `npm run test` -- expected: new `overrides.test.ts` passes; existing suite stays green.
- `npm run type-check` -- expected: `tsc --noEmit` passes.
- `npm run lint` -- expected: passes; no service-role / `GEMINI_API_KEY` in client-bundled code; no hardcoded user-facing strings.
- `npm run build` -- expected: production build succeeds; `.next/static` free of service-role/`GEMINI_API_KEY`.

**Manual checks:**
- Generate on `/`; open a table/field info affordance and read its reason; Rename a field and a table (updates everywhere); Remove a field and a table (disappear, data-backed views still render).
- Attempt to remove the last remaining table → blocked with a translated message.
- Toggle locale to FR (all override strings translate); keyboard-operate the popover + inline rename (focus trap/return, Esc closes, 48px targets, AA); confirm mobile card view exposes field overrides via the record detail.
