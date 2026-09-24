---
title: 'Story 1.6: Interactive Demo Dashboard (Pre-Account Browse & Basic Edit)'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'd64bd92c6d14d22a3177f7a9b54e1e1809103fb0'
story_key: '1-6-interactive-demo-dashboard'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4-ai-schema-synthetic-data-generation.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-5-hard-fallback-template.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After generation (or fallback), `/generate` shows a static, read-only reveal — a plain stacked `<table>` faded in behind a CSS `animate-pulse` skeleton. It does not deliver the "grow into dashboard" moment, does not let the anonymous visitor browse the multiple generated tables, open a record, or touch/edit the data. The core "experience the full value before being asked to create an account" promise (FR5, UX-DR2, UX-DR3) is unmet.

**Approach:** Turn the reveal into an interactive, anonymous demo dashboard that consumes the existing `GenerateResponse` (`{ schema, records, isFallback }`) already returned by `POST /api/generate` — no new generation call. It provides: a Framer-Motion skeleton→content "grow" transition, tab-based browse across the generated tables (responsive table on desktop, card list on mobile), an accessible open-a-record detail view, and a basic in-place optimistic edit of demo data — all with no account.

## Boundaries & Constraints

**Always:**
- Render from the data already in hand (the `POST /api/generate` response: `schema`, `records` keyed by `table_key`, `isFallback`) — no second generation call. Reuse the Story 1.5 subtle banner unchanged when `isFallback`.
- Skeleton screens "grow" into the populated layout via Framer Motion — no spinner/loading bar; honor `prefers-reduced-motion` (`useReducedMotion` → instant/opacity reveal). No generated table ever renders empty (pre-seeded by 1.4/1.5).
- Browse every table (tabs), open a record in an accessible detail dialog/sheet (focus-trapped, `Esc` closes), and make a basic in-place edit of a demo field that reflects optimistically and immediately in list + detail. The edit lives in client-side session state only — no DB write, no new API route — requires/creates no account, and touches only demo data.
- Per-type cell formatting shared across list + detail for all scalars (`text | number | boolean | date | datetime | currency | email | phone`) — CAD for `currency`, i18n yes/no for `boolean`; never `relation`.
- All strings via next-intl (new `Dashboard` namespace, EN + FR; reuse `Generate.cell*`); ARIA labels from schema `label`s; 48×48px targets; WCAG AA; keyboard-operable dialog. Build every visual/interaction surface via the `web-uiux-architect` skill. Add missing shadcn primitives (`card`, `dialog`, `skeleton`, `table`, `badge`) via the CLI at the pinned New York / zinc config.

**Never:**
- No account/auth/magic-link/claim (Epic 2). No full CRUD create/delete, filter/sort, column-hide, or real-time sync (Epic 3). No explainability info-icon/override UI (Story 1.7). No conversational editor (Epic 5) — the banner only names "customize via chat".
- No new migration, no runtime DDL, no change to the data model, RLS, or the `mutate.ts` / `records.ts` signatures.
- Never render raw stacks/SQL/schema JSON/LLM output; the service-role key must never enter a client bundle (CI-enforced).

**Decisions (resolved):**
- **Route shape.** Enhance the `/generate` reveal in place — extract its "ready" branch into a `DemoDashboard` client component; the POST/StrictMode guard, banner, and session-cookie wiring are unchanged.
- **Edit persistence: client-side only.** An in-place edit updates client-side session state (optimistic) with no DB write and no new API route; it is lost on a hard reload (which re-POSTs `/generate`). This keeps the service-role key strictly bootstrap-only per the architecture, keeps the edit truly confined to the session, and keeps 1.6 a pure frontend story — demo data is cleared at claim regardless, so persistence has no downstream value.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh generated schema renders | `GenerateResponse` with N tables + seeded rows | Skeleton grows into the populated dashboard; a tab per table; first table active; no spinner; no empty table | N/A |
| Fallback schema renders | `isFallback: true` | Same dashboard plus the unchanged 1.5 subtle banner | N/A |
| Browse tables | visitor switches tabs | Active table's rows render (table on desktop, cards on mobile); ARIA-labelled tablist | N/A |
| Open a record | tap a row / card | Detail dialog opens showing every field (label + type-formatted value); focus trapped | `Esc` / overlay closes; focus returns to trigger |
| Basic in-place edit | edit an editable field, confirm | Value updates in client session state immediately in list + detail; no account created; lost on hard reload | Invalid/empty input: inline translated message, no commit |
| Per-type formatting | currency / boolean / date / datetime / email / phone / text / number | Each formatted per type (shared formatter); email/phone shown as text | N/A |
| Reduced motion | `prefers-reduced-motion` | Content appears without the grow animation (instant/opacity) | N/A |
| Defensive empty table | a table with 0 rows (should not occur) | Translated `emptyTable` copy — never a blank panel | Defensive only |

</frozen-after-approval>

## Code Map

- `src/app/generate/page.tsx` -- MODIFY. Client component. Extract the read-only "ready" reveal branch into `<DemoDashboard>`; keep the `POST /api/generate` call, StrictMode single-POST guard, `failed`/`loading` phases, and the `isFallback` banner. Pass `{ schema, records, isFallback }` down. The inline `formatCell` helper here is the source to extract.
- `src/components/dashboard/DemoDashboard.tsx` -- CREATE. Client component consuming `GenerateResponse`: Framer-Motion skeleton→content grow (reduced-motion aware), tab browse across `schema.tables`, responsive table (desktop) / card list (mobile), row/card → open `RecordDetail`, and the optimistic in-place edit state.
- `src/components/dashboard/RecordDetail.tsx` -- CREATE. Accessible dialog/sheet rendering one record's fields (`label` + type-formatted value) with a basic in-place edit affordance for demo data.
- `src/components/ui/{card,dialog,skeleton,table,badge}.tsx` -- CREATE via shadcn CLI (New York / zinc). Currently absent; needed for the card view, detail modal, skeletons, semantic table, and type/status badges.
- `src/lib/format.ts` -- CREATE (extract). Move the typed cell formatter out of `generate/page.tsx` (currency CAD, boolean via `Generate.cellYes/cellNo`, date/datetime, text/number/email/phone) so list and detail share one implementation; keep `Generate.cellEmpty` for null/blank.
- `src/types/db.ts` -- REUSE, do not modify. `SchemaDefinition` / `TableDefinition` / `FieldDefinition` (`key,label,type,reason?,hidden?,sensitive?`) / `RecordData` (`id,version,data`) are sufficient as-is.
- `src/lib/data/records.ts`, `src/lib/data/mutate.ts`, `src/lib/generation/session.ts`, `src/lib/supabase/admin.ts` -- NOT TOUCHED. The client-side-only edit needs no read/write route; listed so the implementer does not wire them in.
- `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- MODIFY. Add a `Dashboard` namespace (tablist a11y label, detail title, edit/save/cancel, field-edit a11y, `editHint`, `emptyTable` reuse). Reuse existing `Generate.cell*`.
- `src/app/globals.css` -- VERIFY only. shadcn zinc tokens already present from the 1.1 init; new primitives inherit them.

## Tasks & Acceptance

**Execution:**
- [x] Add shadcn primitives via CLI: `card`, `dialog`, `skeleton`, `table`, `badge` -- the missing building blocks for card view, detail modal, skeletons, and semantic table.
- [x] `src/lib/format.ts` -- CREATE by extracting the typed cell formatter from `generate/page.tsx` -- one formatter shared by list + detail, per-type correct.
- [x] `src/components/dashboard/DemoDashboard.tsx` -- CREATE: skeleton→content grow (Framer Motion, `useReducedMotion`), tab browse, responsive table/card, open-record, optimistic edit -- the interactive dashboard body. Built via `web-uiux-architect`.
- [x] `src/components/dashboard/RecordDetail.tsx` -- CREATE: accessible dialog/sheet with field display + basic in-place edit -- the open-a-record + edit surface. Built via `web-uiux-architect`.
- [x] `src/app/generate/page.tsx` -- MODIFY: render `<DemoDashboard>` in the ready branch; keep POST/guard/banner/phases -- wire the dashboard into the existing reveal.
- [x] `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- MODIFY: add the `Dashboard` namespace (EN + FR) -- i18n compliance, no hardcoded strings.
- [x] `tests/unit/format.test.ts` (CREATE) -- cover the I/O matrix's per-type formatting for every scalar type + null/blank (vitest, node env — no jsdom, per repo precedent).

**Acceptance Criteria:**
- Given a freshly generated or fallback schema, when the dashboard mounts, then skeleton screens grow into the populated layout with no spinner and no empty table; under `prefers-reduced-motion` the reveal is instant.
- Given the dashboard, when the visitor switches tabs and opens a record, then they can browse every generated table and view that record's fields with correct per-type formatting, keyboard-operable and screen-reader labelled.
- Given an open record, when the visitor makes a basic in-place edit and confirms, then the change reflects optimistically and immediately in client session state, requires no account, writes to no DB/API, and is confined to the demo session.
- Given `isFallback: true`, when the dashboard renders, then the unchanged Story 1.5 subtle banner appears and behavior is otherwise identical.
- Given `npm run test`, `type-check`, `lint`, `build`, when run, then all pass; no service-role / `GEMINI_API_KEY` appears in any client bundle; no hardcoded user-facing strings.

## Implementation Notes

**Delivered.** All seven tasks complete. The `/generate` "ready" branch now renders `<DemoDashboard>` (the POST + StrictMode single-POST guard + `isFallback` banner + `missing`/`failed` phases are untouched; the inline `formatCell` was removed). The loading phase renders `<DashboardSkeleton>` (shadcn `Skeleton` placeholders laid in the final grid) so the reveal grows those into content.

- **`src/lib/format.ts`** — the typed formatter, extracted and framework-free: it takes a `CellStrings` object (`empty|yes|no`, sourced from the existing `Generate.cell*` keys) rather than a next-intl `t`, so both the list and detail render every scalar identically and it unit-tests in the node env with no jsdom. Per-type: CAD (`en-CA`) for `currency` (numeric only; else text), i18n yes/no for `boolean`, locale date/datetime formatting (raw string fallback when unparseable), plain text for `text|number|email|phone`, and the `empty` placeholder for null/undefined/blank. `relation` is absent from the type union and can never reach it.
- **`DemoDashboard.tsx`** (client) — a pure consumer of the `GenerateResponse` (no new fetch). Framer-Motion skeleton→content grow gated by `useReducedMotion` (opacity+rise normally; instant/opacity under reduced motion); the tab underline uses `layoutId` only when motion is allowed. ARIA `tablist`/`tab`/`tabpanel` with roving `tabIndex`, first table active. Responsive: semantic shadcn `<Table>` on `md:+`, `Card` list on mobile (first two visible fields headline the card). Rows/cards are keyboard-operable (`role="button"`, Enter/Space) and open the detail. The optimistic edit lifts into a session-only `records` copy owned here — reflects immediately in list + detail, no DB/API, lost on hard reload. Switching tabs closes any open detail (record ids are unique per table).
- **`RecordDetail.tsx`** (client) — Radix `Dialog` gives focus-trap + `Esc`/overlay close + focus-return for free. Renders every visible field as `label` + type-badge + formatted value; each has an inline edit affordance (48px targets). `boolean` edits via a two-choice `radiogroup`; scalars via a text `Input` (Enter commits; type-appropriate `inputMode`). Validation on confirm only: empty → `editEmpty`, non-numeric `number`/`currency` → `editInvalidNumber` (`role="alert"`, `aria-describedby`), no commit; numbers are coerced. Focus-on-edit uses a callback ref (not `autoFocus`, per the a11y lint rule).
- **shadcn primitives** — `card`, `dialog`, `skeleton`, `table`, `badge` added via CLI at the pinned New York/zinc config. The CLI generated `import { cn } from "cn"` (wrong) and pulled a spurious `cn` npm package; both corrected — all imports resolve `@/lib/utils` and the stray dependency was removed. `dialog.tsx` was adjusted so its close-button label comes from a `closeLabel` prop (wired to `Dashboard.close`) and the unused `DialogFooter` hardcoded-"Close" convenience was dropped, keeping the primitive i18n-clean.
- **i18n** — new `Dashboard` namespace in EN + FR (tablist/detail/edit a11y, `editHint`, `emptyTable`/`emptyDashboard`, `close`, per-type badge labels, validation messages, bool yes/no); reuses `Generate.cell*`.

**Verification (all green).** `type-check` (tsc --noEmit) clean; `lint` clean (no hardcoded user-facing strings, no service-role reference); `test` → **93 pass** (11 files, +14 from 1.5's 79, all new in `format.test.ts`); `build` succeeds (only the pre-existing non-fatal `@sentry/nextjs`→OpenTelemetry "Critical dependency" warning, exit 0). Scanned `.next/static`: no `SUPABASE_SERVICE_ROLE_KEY`/`GEMINI_API_KEY`/`GENERATE_SESSION_SECRET`/`service_role`, and no server-only fallback/prompt text — confirming the dashboard is a clean client bundle.

**Manual-check scope (per frozen "no DOM/e2e infra" boundary + 1.3–1.5 precedent).** Interactive/DOM behaviors — the live skeleton→dashboard grow, tab switching, dialog focus-trap/`Esc`/focus-return, the optimistic edit reflecting in list+detail, FR locale, the fallback banner, reduced-motion, and the 48px/AA/mobile-card checks — are the spec's manual checks, not automated (only the pure formatter is unit-tested). Not yet run in a browser this session.

**Review pass 1 patches (see Review Triage Log).** Four fixes applied after review, all verified: (1) **[high]** the ARIA tablist gained `ArrowLeft`/`ArrowRight`/`Home`/`End` roving keyboard navigation (`DemoDashboard.tsx`) — non-selected tabs were `tabIndex={-1}` with no arrow handler, making table-browsing keyboard-inaccessible (WCAG 2.1.1); (2) **[medium]** date-only values now format in UTC (`src/lib/format.ts`) so an Ontario (UTC-5/-4) visitor sees the stored calendar day, not the previous one; (3) **[low]** `validateAndCoerce` now rejects non-finite numbers via `!Number.isFinite` (`RecordDetail.tsx`) so `"1e999"`/`Infinity` no longer commit to a number/currency field; (4) **[low]** removed the orphaned `Generate.tableCaption`/`Generate.emptyTable` i18n keys (EN+FR) whose last usage this story deleted. One finding deferred (edit validate/coerce logic untested — `deferred-work.md`); six low/false findings rejected with refutations in the triage log. Full verification re-run green: **93 tests** pass, `type-check`/`lint`/`build` clean, `.next/static` bundle clean.

## Spec Change Log

## Review Triage Log

### Review pass 1 (2026-09-24)

Three layers (blind-hunter, edge-case-hunter, verification-gap) run in parallel at session (Opus) capability. Verdicts rendered against the code, not the reviewers' severities.

**Patched (route: patch — sent to the implementation subagent; verification re-run on the orchestrator side):**
- **[high → patch] ARIA tablist has no keyboard navigation — a keyboard/AT user cannot switch tables** (EdgeCase + BlindHunter, `DemoDashboard.tsx:121` tablist) — VERIFIED: the tabs are the roving-tabindex pattern (`role="tab"`, selected `tabIndex={0}`, others `tabIndex={-1}`) but there is NO `onKeyDown` on the tabs (the two `onKeyDown` handlers in the file are on table rows/cards). Non-selected tabs are out of tab order and no arrow handler exists, so a keyboard-only user can only ever activate the initially-selected tab — the story's headline "browse every table" is inoperable for keyboard/AT users, violating the spec's frozen "WCAG AA" + the epic's accessibility-from-first-component requirement (WCAG 2.1.1, Level A). Fallback/generated schemas routinely have 2–4 tables, so this is the common case. Fix: add `ArrowLeft`/`ArrowRight`/`Home`/`End` roving navigation that moves focus to and activates the target tab.
- **[medium → patch] Date-only values render one day early in Ontario (negative-UTC) timezones** (BlindHunter, `src/lib/format.ts` date branch) — VERIFIED: `new Date("2026-01-15")` parses date-only ISO as UTC midnight; `Intl.DateTimeFormat("en-CA")` with no `timeZone` formats in the browser's local zone, so in Ontario (UTC-5/-4 — the story's explicit target) a date-only seed value displays as the previous day. This is newly-introduced behavior (the old `formatCell` did `String(value)`); the unit test only asserts the year is present, so it doesn't catch it. Fix: format date-only values in UTC (so the calendar day matches the stored ISO date); leave `datetime` local (real instants render correctly in local time).
- **[low → patch] `validateAndCoerce` accepts `Infinity`/`1e999` for number/currency** (EdgeCase, `RecordDetail.tsx` `validateAndCoerce`) — VERIFIED: `Number("Infinity")`/`Number("1e999")` return `Infinity`, not `NaN`, so the `Number.isNaN` guard passes them through and the edit commits `Infinity` (rendered as `∞`/`Infinity`). The frozen matrix says "invalid number → no commit." Direct correction: reject non-finite via `!Number.isFinite(parsed)`.
- **[low → patch] Orphaned `Generate.tableCaption` / `Generate.emptyTable` i18n keys** (BlindHunter, `en.json`/`fr.json:46-47`) — VERIFIED orphaned: this story removed the old `/generate` table that used them; the only live `tableCaption`/`emptyTable` usages are now the `Dashboard.*` (DemoDashboard) and `Demo.*` (/demo) namespaces. Direct deletion.

**Deferred (route: defer — appended to `deferred-work.md`):**
- **[low → defer] The optimistic-edit validate/coerce logic ships without an automated test** (VerificationGap + BlindHunter, `RecordDetail.tsx` `validateAndCoerce`) — VERIFIED: `validateAndCoerce`/`toInputString`/`inputModeFor` are pure and unit-testable in the node env (no jsdom), yet only `format.test.ts` was added; an inverted empty-check or dropped guard would ship undetected. Real gap, but the frozen spec deliberately scopes edit-verification to manual checks ("no DOM/e2e infra" boundary, 1.3–1.5 precedent), the logic operates only on throwaway client-side demo data (no DB/API, lost on reload), and closing it means exporting the helper + a test — not worth a loopback. The Infinity tightening above is being patched regardless.

**Rejected:**
- **[low → reject] Boolean editor `role="radiogroup"` lacks arrow-key navigation** (EdgeCase + BlindHunter, `RecordDetail.tsx` boolean `FieldEditor`) — REFUTED as a functional block: the two options are native `<button role="radio">` at default `tabIndex=0`, so a keyboard user Tabs to each and selects with Space/Enter — the value IS changeable by keyboard. Arrow navigation is an APG nicety, not an operability failure; the fix adds roving tabindex + arrow handlers (more than a direct correction) for negligible gain. Unlike the tablist (which is genuinely unreachable), this widget works.
- **[low → reject] Editing a null/undefined boolean collapses to `false`** (EdgeCase, `RecordDetail.tsx:800` `Boolean(value)`) — the display already renders an empty boolean as the `—` placeholder (formatCell's null-check precedes the boolean branch); only actively editing a rare null-valued boolean pre-selects "No". Throwaway demo data; fix adds a tri-state branch. Low, unlikely to be met.
- **[low → reject] No per-type format validation for email/phone/date edits** (BlindHunter, `RecordDetail.tsx` `validateAndCoerce`) — the intent is a "basic in-place edit" of throwaway demo data; empty-rejection (all types) + numeric-validation (number/currency) satisfies the frozen matrix's "invalid/empty input." Format validators (email regex, date parsing) are gold-plating that adds public surface/branches for no demo value.
- **[low → reject] Reveal not announced to assistive tech (`aria-live` dropped from the ready state)** (BlindHunter, `page.tsx`) — the old ready container's `aria-live="polite"` was on a freshly-mounted region, which most screen readers do NOT announce for initial content (only subsequent mutations), so the practical AT impact is marginal; a fix that actually announces needs a persistent live region + effect (more than a trivial attribute re-add). Low.
- **[low → reject] `DialogContent.closeLabel` documented "required" but typed optional** (BlindHunter, `ui/dialog.tsx`) — no current defect: the sole consumer (`RecordDetail`) passes `closeLabel={t("close")}`, so the close button is labelled. A latent primitive-API nit for speculative future consumers; enforcing it adds a discriminated-union type surface. Low, no named current harm.
- **[low → reject] No unsaved-edit guard when closing/switching mid-edit** (BlindHunter, `RecordDetail`/`DemoDashboard`) — discarding an uncommitted draft on close/tab-switch is standard behavior for a basic demo edit; an unsaved-changes guard is gold-plating beyond the "basic in-place edit" intent.

_No intent_gap or bad_spec entries → no loopback; patches applied in place, defer recorded._

## Design Notes

- **Pure consumer.** `schema` + `records` already arrive in the POST response, so the dashboard needs no new data fetch — it renders what 1.4/1.5 provisioned, keeping 1.6 a frontend story.
- **Component testing.** Repo runs vitest in `node` env with no jsdom / `@testing-library` (unit + integration only, mocked SDK/DB). Per the 1.3–1.5 precedent, unit-test pure logic (the formatter); DOM/interaction is verified manually (Verification).
- **Skeleton-grow.** Lay shadcn `Skeleton` placeholders in the final grid, then animate them into content via Framer Motion (layout + opacity), gated by `useReducedMotion` — never a spinner (UX-DR2).

## Verification

**Commands:**
- `npm run test` -- expected: new `format.test.ts` passes; existing suite stays green.
- `npm run type-check` -- expected: `tsc --noEmit` passes.
- `npm run lint` -- expected: passes; no service-role / `GEMINI_API_KEY` in client-bundled code; no hardcoded user-facing strings.
- `npm run build` -- expected: production build succeeds.

**Manual checks:**
- Generate on `/`; skeleton grows into the dashboard (no spinner); switch tabs; open a record; edit a field and see it update immediately.
- Toggle locale to FR (tabs/detail/edit translate); force a fallback (1.5 banner shows, otherwise identical).
- Keyboard-operate the dialog (Tab traps, `Esc` closes, focus returns); confirm 48px targets, AA contrast, and the mobile card view at a narrow viewport.
