---
title: 'Responsive Table & Card Views (authenticated dashboard)'
type: 'feature'
created: '2026-09-26'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '5611659f0665a63f2558f0ed382c6286579c624e'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The authenticated tenant dashboard (`/[slug]`) stacks every logical table as a raw `<table>` in a horizontally-scrolling container — a desktop table crammed onto a phone, with all tables in one long scroll. That fails FR6 / UX-DR7 (responsive DataTable ⇄ swipeable card view) and the mobile-first touch/accessibility targets, on phones — the primary field-worker device.

**Approach:** Replace the inline table markup in `[slug]/page.tsx` with a reusable client surface that shows **one logical table at a time**, chosen via an accessible switcher: the active table renders as a shadcn `Table` on desktop (`md+`) and a card list on mobile (`<md`), with a horizontal `react-swipeable` gesture moving between tables on mobile. Views are driven by the org's `org_schemas` field definitions and the existing `listRecords` query layer. Read-only display only. Data stays server-fetched (fast first paint); the surface is a client component because active-table state + swipe need the client.

**Decision (resolved swipe model):** mobile horizontal swipe navigates **between logical tables**, in sync with the switcher; layout is one-table-at-a-time on desktop and mobile. Single visible table → no switcher, swipe is a no-op. (Chosen over inert swipe and swipe-to-peek.)

## Boundaries & Constraints

**Always:**
- Show one logical table at a time via an accessible switcher (tablist/tab semantics, ≥48×48px, keyboard-operable, translated label). Mobile `react-swipeable` horizontal swipe changes the active table and stays in sync with the switcher; the selection drives both desktop and mobile presentations.
- Drive columns, labels, and formatting strictly from *visible* field definitions (`visibleTables(...)`, then filter `field.hidden`); render values via `formatCell(value, field.type, cellStrings)`.
- Desktop `Table` exposes an sr-only caption and column-header semantics with ARIA labels from schema field labels; the card list has an accessible list label. Loading uses shadcn `Skeleton`, never a spinner.
- New user-facing strings go through next-intl under `SlugDashboard` in BOTH `en.json` and `fr.json`.
- Preserve the existing RLS-scoped server fetch, auth redirect, and tenant-isolation in `page.tsx` unchanged.

**Never:**
- No record CRUD, filter/sort, column hide/unhide, detail modal, real-time sync, or swipe-to-act on records (edit/delete gestures) — those are Stories 3.2–3.6. Swipe only switches tables.
- Do not modify `listRecords`, `getSchema`, `mutate.ts`, `types/db.ts`, or write to `org_schemas`.
- Do not add `@tanstack/react-table` or wire a TanStack Query provider (deferred to Story 3.2).
- Do not reuse/modify `DemoDashboard.tsx` or its `OverrideControl`/`RecordDetail`; mirror its pattern only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior |
|----------|--------------|-------------------|
| Multiple visible tables | `visibleTables` length > 1 | switcher lists all; active table renders below |
| Desktop, active table populated | ≥ md, N records | shadcn `Table`, one column per visible field, values via `formatCell`, sr-only caption |
| Mobile, active table populated | < md, N records | card list; each card shows the record's key fields |
| Mobile swipe left/right | swipe on card area | active table advances/retreats; switcher tracks; clamps at ends (no wrap) |
| Single visible table | length == 1 | no switcher; table renders; swipe no-op |
| Active table empty | 0 records | translated `SlugDashboard.emptyTable`, not an error |
| No visible tables | `visibleTables` empty | translated `SlugDashboard.emptyDashboard`; no switcher |
| Null/missing field value | `row.data[key]` undefined | `formatCell` renders the translated empty-cell string |

</frozen-after-approval>

## Code Map

- `src/app/[slug]/page.tsx` -- TARGET. Keep auth/redirect + RLS slug→org resolution + per-table `listRecords` fan-out (~L38–78). Replace the per-table `<section>` loop + inline `<table>` (~L91–143) with `<RecordsView tables={tables} recordsByTable={recordsByTable} cellStrings={cellStrings} />`, keeping the `<main>`/header and empty-dashboard branch.
- `src/components/dashboard/RecordsView.tsx` -- NEW client component. Owns `activeIndex`; renders switcher (hidden when one table), active table as desktop `Table` (`hidden md:block`) + mobile card list (`md:hidden`), wires `react-swipeable` on the card area to change table. Props `{ tables: TableDefinition[]; recordsByTable: Record<string, RecordData[]>; cellStrings: CellStrings }`.
- `src/components/dashboard/DemoDashboard.tsx` -- REFERENCE ONLY (do not import/modify). Tablist + `activeTable`/`role="tabpanel"` (~L260–344), `TableView` (~L358–440), `CardList` (~L442–523: 2 headline fields + rest as `<dl>`), `DashboardSkeleton` (~L531–560), `hidden md:block`/`md:hidden` split.
- `src/lib/data/records.ts` -- `listRecords(client, orgId, tableKey): ApiResponse<RecordData[]>`, `getSchema`. Read-only; don't modify.
- `src/lib/schema/overrides.ts` -- `visibleTables(schema)`. Reuse.
- `src/lib/format.ts` -- `formatCell(value, type, cellStrings)` + `CellStrings`. Reuse.
- `src/types/db.ts` -- `RecordData` (`{ id, version, data }`), `TableDefinition`, `FieldDefinition` (`type: text|number|date|datetime|boolean|currency|email|phone`, `hidden?`, `sensitive?`, `reason?`).
- `src/components/ui/{table,card,skeleton}.tsx` -- shadcn primitives.
- `src/lib/i18n/{en,fr}.json` -- `SlugDashboard` namespace; add switcher/tablist label, table caption, card-list label in both.
- `package.json` -- `react-swipeable@7.0.2` installed.

## Tasks & Acceptance

**Execution:**
- [x] `src/components/dashboard/RecordsView.tsx` -- create the read-only surface: `activeIndex` state; accessible switcher (tablist/tab, ≥48×48px, arrow-key + click, hidden when one table, translated label); active table as desktop shadcn `Table` (visible fields → columns, sr-only caption, ARIA header semantics) in `hidden md:block` and mobile card list (key fields per card, ≥48×48px) in `md:hidden`; `react-swipeable` advances/retreats the active table, clamped at ends.
- [x] `src/app/[slug]/page.tsx` -- swap the section loop + inline `<table>` for `<RecordsView .../>`; keep the empty-dashboard branch and all auth/RLS/tenant logic untouched.
- [x] `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- add the new `SlugDashboard` keys (switcher/tablist label, table caption, card-list label) in both locales.
- [x] `tests/unit/records-view.test.tsx`, `tests/unit/slug-dashboard-page.test.tsx` -- unit-test every I/O & Edge-Case Matrix row (RecordsView via `react-dom/server` render + the pure `clampTableIndex` helper; page-level empty-dashboard / RecordsView-wiring rows).

**Acceptance Criteria:**
- Given an org with >1 visible table, when the dashboard loads, an accessible switcher lists the tables and selecting one shows it; with a single visible table, no switcher appears.
- Given the active table at `md+`, it renders as a shadcn `Table` with columns from the `org_schemas` visible fields and rows from `listRecords`, plus sr-only caption and schema-derived column semantics.
- Given the active table on mobile (`<md`), it renders as a card list (not a horizontally-scrolled table), each card showing key fields, all touch targets ≥48×48px; a horizontal swipe changes the active table and the switcher tracks it.
- Given a table with no records, the translated empty-table message shows (no error); given no visible tables, the empty-dashboard message shows.
- Given the view mounts, the loading placeholder is a `Skeleton` (never a spinner) and initial data is SSR-delivered for fast interactive (NFR-P3).

## Implementation Notes

- Built with the `/web-uiux-architect` skill active. Motion is CSS-only (no Framer Motion): the active-tab underline is a CSS-positioned `<span>`, transitions via Tailwind `transition-colors`. Switcher follows the WAI-ARIA tablist keyboard contract (roving `tabIndex`, Arrow/Home/End), mirroring the demo dashboard; tab buttons are `min-h-12` (48px).
- Added `src/app/[slug]/loading.tsx` (not a listed task but required by the frozen "loading uses Skeleton, never a spinner" constraint): a route-level shadcn `Skeleton` in the dashboard shape, shown while the dynamic server page fetches. This is the correct vehicle since the page is a server component with no client loading state.
- Extracted `clampTableIndex(index, count)` (exported, pure) for the swipe/switcher clamp so the interaction is unit-testable in the node test env (no jsdom in this repo).
- Swipe handlers wrap the whole mobile area (not just the cards) so an empty table can still be swiped away to another table. `touch-pan-y` keeps vertical page scroll with the browser.
- Cards are non-interactive (read-only) — the only interactive elements are the switcher tabs; record open/detail/edit arrive with Stories 3.2/3.3.
- Verified: `npm run lint` clean, `npx tsc --noEmit` clean, `npm run build` succeeds, `vitest run` 230/230 pass (incl. the 2 new files, 11 new tests covering all 8 matrix rows).

## Spec Change Log

## Review Triage Log

Pass 1 (2026-09-26):

- **medium → patch** — Single-table case leaves `<section role="tabpanel" tabIndex={0}>` with no owning tablist and no accessible name (blind-hunter). Verified: when `!hasSwitcher` the role/tabIndex remain but `aria-labelledby` is `undefined` → an unnamed focus stop for every single-table org. Fixed: tab semantics applied only when `hasSwitcher`.
- **low → patch** — Tab buttons set `min-h-12` (48px) but no min-width, so a very short label could be <48px wide, missing the explicit ≥48×48px AC (edge-case-hunter EC4). Fixed: added `min-w-12`.
- **low → patch** — `RecordsTable` wraps `<Table>` in `overflow-x-auto rounded-lg border`, but shadcn `Table` already renders its own `overflow-x-auto` container (table.tsx:8-11) → double scroll container; `rounded-lg` doesn't clip the inner scroll (blind-hunter BH2). Fixed: outer wrapper is now `overflow-hidden rounded-lg border`.
- **low → patch** — `cardListLabel` buries "Swipe left or right…" inside the mobile list's `aria-label` (accessible name), which is discouraged and misleading for single-table orgs (blind-hunter BH7). Fixed: label simplified to "Records for {table}." in both locales; the always-visible tablist tabs provide accessible navigation.
- **medium (unverified) → defer** — Interactive navigation (swipe direction, arrow-key roving, click active-table selection) ships unverified; tests cover only `renderToStaticMarkup` at index 0 + the pure `clampTableIndex` (verification-gap VG1/VG2, blind-hunter BH3/BH4). Closing it needs a jsdom/testing-library harness the repo deliberately lacks (Story 1.6 `RecordDetail` precedent). Deferred with a new entry.
- **false** — "Keyboard nav wraps while swipe clamps → focus/selection desync" (blind-hunter BH1). Refuted: keyboard `next` is already in `[0,count-1]` via modulo, so `clampTableIndex(next)` returns it unchanged; selection and focus both land on `next`. The wrap-vs-clamp difference is intentional (WAI-ARIA APG arrow-key wrap; matches the demo).
- **low → reject** — `RecordsView` throws if rendered with `tables=[]` (edge-case-hunter EC1). The sole caller guards `tables.length === 0`; unreachable, and the fix guards an undemonstrated state.
- **low → reject** — Table with all fields hidden renders an empty header/cell-less rows (edge-case-hunter EC2). Reachable only if an Admin hides every field (unusual); cosmetic empty shell, not a crash.
- **low → reject** — Two visible tables sharing a `key` collide on ids/keys (edge-case-hunter EC3). Table keys are normalized-unique per org schema; not reachable.
- **low → reject** — `safeIndex` re-implements the clamp inline / `activeIndex` not reset on `tables` change (blind-hunter BH6). No real bug in 3.1: `activeIndex` is always ≥0 and the server-rendered `tables` prop is stable for the component's lifetime; the reset fix needs a `useEffect` for a state not reachable until Story 3.2.

## Design Notes

- Use the `/web-uiux-architect` skill (per the build request) for `RecordsView` visual/interaction design — switcher styling, layout, card composition, touch ergonomics, swipe feel/motion — within the Boundaries.
- Mirror the demo's tablist + responsive split and card composition (first two visible fields as headline/subtext, rest as a `<dl>`); do not reuse the demo component (bound to pre-auth state + explainability out of scope).
- One `activeIndex` drives both switcher and swipe; clamp at `0`/`tables.length - 1` (no wrap); skip switcher + swipe when `tables.length === 1`. Server-fetched data passed as props leaves a clean seam for Story 3.2 to add TanStack Query `initialData` hydration — no read-path rework.

## Verification

**Commands:**
- `npm run lint` -- expected: passes (incl. i18n/no-hardcoded-strings gate).
- `npx tsc --noEmit` -- expected: no type errors.
- `npm run build` -- expected: succeeds.

**Manual checks:**
- Claimed org with several tables + records: desktop shows switcher + active table as a shadcn table; on mobile, card list with left/right swipe changing the active table (switcher tracks). Single-table org: no switcher. Empty table / empty dashboard show translated messages. EN/FR toggle renders new strings in both.
