---
title: 'Field-Level Sensitivity Indicator'
type: 'feature'
created: '2026-10-05'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '32d48ec6cf37d2a59fa4a76cb2660411ebf6ca0c'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Field definitions already carry a `sensitive` flag (set by the AI generation prompt and the fallback template for PII like phone/email), but nothing in the UI surfaces it, so users handling private data get no signal the platform protects it. The FR40 / UX-DR12 conversion-trust payoff is unrealized.

**Approach:** Show a small padlock beside sensitive fields in both the table and card record views, revealing a plain-language, PIPEDA-reassuring message on tap or hover. The flag already exists on `FieldDefinition.sensitive`, so this is read-only presentation: one shared `SensitivityBadge` wired into every field-label render site in `RecordsView`, with copy from the next-intl catalog.

## Boundaries & Constraints

**Always:**
- Render only when `field.sensitive === true`, at every place a sensitive field appears in the authenticated table and card views: both table header variants (sortable + non-sortable) and all three card positions (primary headline, secondary subheadline, `<dl>` label).
- Reveal the message on tap/click, hover, and keyboard focus; dismiss on Escape, outside click, blur, or pointer-leave. Hover/focus reveal must not steal keyboard focus (suppress Popover open auto-focus).
- In the sortable header the padlock is a sibling of the sort `<button>`, not inside it, so activating it reveals the message without sorting.
- All copy from a next-intl namespace (no hardcoded strings), present in both `en.json` and `fr.json`. The message states the truthful NFR-S2 guarantee (encrypted at rest, Canadian servers only, PIPEDA).
- Meet WCAG AA: accessible label on the icon trigger, `aria-hidden` icon, visible `focus-visible` ring, mobile touch target padded toward 44px, reveal animation guarded by `motion-reduce`.

**Never:**
- Never change `FieldDefinition`, `org_schemas`, generation, the fallback template, or add a migration — the flag exists and is populated upstream.
- Never add the indicator outside the two record views (record detail panel, chat, public intake forms, import); public forms must not expose a PII flag to anonymous submitters.
- Never add a new dependency or a hover-only Tooltip primitive that cannot open on touch — reuse `popover.tsx`.
- Never gate, mask, or alter the value; this is a trust signal, not access control.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior |
|----------|--------------|-------------------|
| Sensitive column, table | `sensitive === true` in header | Padlock beside label (sortable: sibling of sort button; else beside span); sort still works |
| Sensitive field, card | `sensitive === true` at any card position | Padlock beside that position |
| Non-sensitive field | `sensitive` falsy | No padlock, no extra DOM |
| Reveal | tap / hover / focus the padlock | Catalog message shows; hover/focus-open does not steal focus |
| Dismiss | Escape / outside / blur / pointer-leave | Message closes |
| Locale FR | active locale `fr` | Label + message from FR catalog |

</frozen-after-approval>

## Code Map

- `src/types/db.ts:81` -- `FieldDefinition.sensitive?: boolean` already exists ("Marks PII for PIPEDA handling (FR40)"). REUSE; do not modify.
- `src/components/dashboard/RecordsView.tsx` -- only consumer. `RecordsTable` header loop (~909-955): sortable branch renders `{field.label}` inside the sort `<button>` (line 934); non-sortable in a `<span>` (line 950). `RecordsCards` (~1049-1147): `primaryField` headline (~1062), `secondaryField` subheadline (~1078), `restFields` `<dt>` label (line 1128). Each is a full `FieldDefinition` in scope.
- `src/components/dashboard/SensitivityBadge.tsx` -- NEW `'use client'` shared component (padlock + Popover reveal).
- `src/components/dashboard/OverrideControl.tsx` -- REFERENCE: inline adornment on `Popover`/`PopoverTrigger`/`PopoverContent` + `useTranslations` + lucide icon `aria-hidden`; mirror its shape (minus rename/remove).
- `src/components/ui/popover.tsx` -- REUSE. No Tooltip primitive exists; none is added. `src/lib/utils.ts` (`cn`) as needed.
- `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- ADD a `Sensitivity` namespace in both; mirror the `PwaInstall` block. `useTranslations('Sensitivity')` (pattern: `src/components/forms/FormFieldsEditor.tsx:3,120`); catalogs load via `src/lib/i18n/request.ts`.
- lucide `Lock` -- already imported elsewhere (e.g. `src/components/forms/FormFieldsEditor.tsx:6`).

## Tasks & Acceptance

**Execution:**
- [x] `src/components/dashboard/SensitivityBadge.tsx` -- NEW. Controlled `Popover`: trigger is an icon `<button type="button">` with lucide `Lock` (`size-3.5`, `text-muted-foreground`, `aria-hidden`), `aria-label`=`t('indicatorLabel')`, padding-expanded tap target, `focus-visible:ring`. Open on click/tap + `onMouseEnter`/`onFocus`; close on `onMouseLeave`/`onBlur`/Escape/outside. `PopoverContent side="top"` with `onOpenAutoFocus={(e) => e.preventDefault()}`, small `max-w`, `text-sm text-pretty`, `motion-reduce:animate-none`, body=`t('message')`.
- [x] `src/components/dashboard/RecordsView.tsx` -- mount `<SensitivityBadge />` at all five sites guarded by `field.sensitive`: restructure the sortable `TableHead` so the badge is a flex sibling of the sort button; beside the non-sortable header span; beside the primary headline, secondary subheadline, and `<dt>` label.
- [x] `src/lib/i18n/en.json` + `fr.json` -- add the `Sensitivity` namespace (`indicatorLabel`, `message`) in both. EN `message`: "Stored encrypted, on Canadian servers only (PIPEDA)."
- [x] `tests/unit/sensitivity-badge.test.ts` -- assert `Sensitivity.indicatorLabel` and `Sensitivity.message` are present and non-empty in both catalogs (node-testable parity pin; `tests/**` convention).

**Acceptance Criteria:**
- Given a field flagged `sensitive`, when the list renders in table or card view, then a padlock appears beside that field's position, and non-sensitive fields show nothing extra.
- Given the padlock, when the user taps, hovers, or keyboard-focuses it, then a plain-language PIPEDA message appears (encrypted, Canadian servers only) and dismisses on Escape/outside/blur/leave without stealing keyboard focus on hover.
- Given either locale, when the indicator renders, then label and message come from the `Sensitivity` catalog, meet WCAG AA contrast, and are keyboard-operable with a visible focus ring.
- Given a sortable sensitive column, when the user activates the padlock, then the reveal opens without triggering a column sort.

## Implementation Notes

- Built to the Code Map. NEW: `src/components/dashboard/SensitivityBadge.tsx`, `tests/unit/sensitivity-badge.test.ts`. EDITED: `src/components/dashboard/RecordsView.tsx` (import + 5 `field.sensitive`-guarded mount sites; sortable `TableHead` wrapped in `flex items-center pr-1` with the sort button as `flex-1` and the badge as its sibling), `src/lib/i18n/en.json` + `fr.json` (`Sensitivity` namespace). No type/schema/generation/migration change — `FieldDefinition.sensitive` already exists and is populated upstream.
- `SensitivityBadge` is a controlled Popover (`open`/`onOpenChange`): click/tap toggles via the native trigger, `onMouseEnter`/`onFocus` open and `onMouseLeave`/`onBlur` close for hover/focus parity, Escape + outside-click close natively. `onOpenAutoFocus` is prevented so hover/focus reveal keeps focus on the trigger (no trap, no jump). Trigger padding `p-1.5` expands the tap target; icon is `size-3.5` `aria-hidden` with an `aria-label` from the catalog.
- Copy carries no em-dashes (house-style rule).
- Verified: `npm run type-check` clean, `npm run lint` clean (only the pre-existing eslintrc-deprecation notice), `npm test` 1636 pass across 143 files (incl. the new catalog test), `npm run build` compiles.
- **Matrix-test audit:** the "Locale FR" / no-hardcoded-strings row is pinned by the `sensitivity-badge` catalog-parity test. The render-gating rows (padlock renders iff `sensitive`; non-sensitive shows nothing) are pinned by the new `RecordsView sensitivity indicator` cases in `records-view.test.tsx`, which render via `renderToStaticMarkup` (the closed Radix trigger still emits markup) and assert the badge appears in both the table header and a card site for a sensitive field and is absent otherwise. The remaining rows are pure DOM interaction (reveal on tap/hover/focus, dismiss paths, no focus steal) not reachable in the `node` test env (no jsdom) — assigned to the Playwright MCP manual review, the same split accepted for Stories 8.1 and 8.2.
- **Review patches (Pass 1):** (1) added the `records-view` render-gating test above; (2) linked the PIPEDA message to the trigger via a visually-hidden `aria-describedby` span so assistive tech reaches it despite the focus-suppressed portaled popover; (3) enlarged the padlock tap target (`p-1.5` to `p-2.5`) toward the mobile 44px standard while the icon stays `size-3.5`.

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **[patch] Badge render-site gating is untested (Verification Gap, pre-verified; also Blind Hunter).** `medium`. Verified: `tests/unit/records-view.test.tsx` renders the full component via `renderToStaticMarkup` and asserts on trigger `aria-label`s; a closed Radix `PopoverTrigger asChild` still renders its button into static markup. No fixture sets `sensitive: true`, so all five `field.sensitive` guards — and the sort-button-sibling placement — could regress with a green suite. Cheap to cover in the existing renderer → patch.
- **[patch] PIPEDA reassurance message is inaccessible to assistive tech (Blind Hunter).** `medium`. Verified: the trigger's `aria-label` is `indicatorLabel` ("Sensitive field. See how it is protected."); the actual `message` lives only in `PopoverContent`, which is portaled and has `onOpenAutoFocus` prevented, so focus never reaches it and nothing associates it with the control. A screen-reader user gets the "sensitive" cue but never the protection message that is the story's payload. The AC requires WCAG AA. Smallest fix (describe the control with the message) is additive, no public surface → patch.
- **[patch] Mobile tap target below the stated standard (Edge Case Hunter).** `low`. Verified: trigger is `p-1.5` (6px) around a `size-3.5` (14px) icon ≈ 26px square; the spec set "padded toward 44px" and the card view is the mobile surface. Meets the WCAG 2.2 AA 24px floor but misses the comfort target. Fix is a direct className change (expand hit area without growing visual size) → patch.
- **[defer] `RecordDetail.tsx` shows no padlock on sensitive fields (Blind Hunter).** Verified real: `RecordDetail.tsx:168` renders `{field.label}` in a span already hosting `OverrideControl`, with no badge. Out of scope by intent: the frozen AC scopes FR40/UX-DR12 to a field-level indicator on "columns ... in both table and card views"; the single-record detail panel is a distinct surface the intent did not name. Logged to `deferred-work.md` as a future consistency enhancement rather than silently dropped.
- **[reject·low] Hover closes when the pointer moves toward the popover content (Blind Hunter).** `low`, rejected. The content is non-interactive reassurance text; it stays open while the pointer is on the padlock, which satisfies the AC's hover reveal. The user never needs to move onto the content to read it. Keeping it open across the trigger/content gap would add pointer-tracking complexity for no demonstrated need.
- **[reject·low] `max-w-56` is narrower than the base popover `w-72` (Blind Hunter).** `low`, rejected. Cosmetic; the narrower box is intentional for short text and names no functional harm. The "fix" is a subjective design change, not a correction.
- **[reject·false] Each sensitive column adds a Tab stop (Blind Hunter).** Rejected. The focusable trigger is exactly what the AC's "fully keyboard-operable" requirement mandates; the extra stop is intended accessible behavior, not a defect.

## Design Notes

- **Popover, not Tooltip.** The AC requires reveal on tap OR hover; a Radix Tooltip covers hover + focus but not touch tap, and the card view is the mobile surface, so Tooltip fails the AC there. Reuse `popover.tsx` (as `OverrideControl` does): Popover opens on tap/click + keyboard natively; hover/focus openers are layered on, with `onOpenAutoFocus` prevented so the reveal never traps or jumps focus.
- **Header separation.** The sortable label lives inside the sort `<button>`; render the badge as a sibling inside `TableHead` (flex `[sort button flex-1][badge]`) so the padlock is its own target.
- **Copy** (no em-dashes). FR `message`: "Stocké chiffré, sur des serveurs canadiens uniquement (PIPEDA)."; `indicatorLabel` EN "Sensitive field. See how it is protected." / FR "Champ sensible. Voir comment il est protégé." Truthful per NFR-S2 (Supabase ca-central-1, at-rest encryption).

## Verification

**Commands:**
- `npm run type-check` -- no errors
- `npm run lint` -- clean (allow the pre-existing eslintrc-deprecation notice)
- `npm test` -- green incl. the new `sensitivity-badge` catalog test
- `npm run build` -- compiles

**Manual checks (Playwright MCP, localhost:3000, authed `/session-…` fixture, on a table that HAS a sensitive field, e.g. generated phone/email):**
- Table: sensitive column shows the padlock beside the header; sorting still works; tap/hover reveals the PIPEDA message; Escape/outside dismisses.
- Mobile card view: padlock appears on the sensitive field's position and reveals on tap.
- Keyboard: Tab to the padlock shows a focus ring and the message; hover-open does not pull focus into the popover.
- Toggle FR: label + message switch to the FR catalog. Confirm a non-sensitive table shows no padlock.
