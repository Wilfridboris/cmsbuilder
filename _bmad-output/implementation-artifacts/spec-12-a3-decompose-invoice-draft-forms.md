---
title: 'Decompose the invoice & credit-note draft forms (retro A3)'
type: 'refactor'
created: '2026-09-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '9f8a6a2e4fc29bbc67fa4bd4b80c330035e3c519'
context: ['.claude/skills/web-uiux-architect/skill.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `InvoiceDraftForm.tsx` (813 lines) and `CreditNoteDraftForm.tsx` (677 lines, ~85% a clone) each own load-on-edit, ~14 pieces of state, live totals, four inline async actions (create/update/discard/issue), a line-items editor table, and two structurally-identical confirm dialogs. The duplication is hard to read, test, and change, and each AI session piles more in (Epic 12 retro [A3]).

**Approach:** Extract the three duplicated concerns into shared units under `src/components/invoices/` — a `LineItemsEditor` component, a reusable confirm-dialog component (used for both issue and discard), and a `useDraftForm` orchestration hook (shared state + row helpers + live totals + save/discard/issue lifecycles with shared error mapping) — then reduce both forms to thin shells that compose them while keeping each form's divergent parts. Pure refactor: no behavior or API change.

## Boundaries & Constraints

**Always:**
- Preserve the exported prop signatures of `InvoiceDraftForm` and `CreditNoteDraftForm` (and the exported `CreditNotePrefillLine` type) exactly — the 4 consumer pages depend on them unchanged.
- Behavior parity with today: load-on-edit, live totals via `computeInvoiceTotals`/`computeLineAmount`, create/update/discard/issue flows, redirects, version gating, error-code→message mapping, min-1-row guard, and all disabled/loading/"saved" states.
- Keep invoice-only features: `LinkedRecordPicker` customer picker, due-date field, customer-label resolution with "unavailable" fallback, `dateInvalid` error key. Keep credit-note-only features: prefill from source invoice, "corrects invoice N" header, customer-id-only handling (no picker/due-date), `creditExceedsInvoice` error key.
- All writes stay through the existing `invoices-client` / `credit-notes-client` layer.
- Shared UI components (LineItemsEditor, confirm dialog) are implemented via the `web-uiux-architect` agent.
- The shared `LineItemsEditor` uses one markup for both forms: the richer invoice layout (visible column headers on `sm+`, per-cell `sr-only` `<Label>`s, mobile totals hints). The credit-note draft therefore gains headers/hints — an accepted, strictly-additive accessibility improvement.

**Never:**
- Do not change any API route, `mutate` layer, DB schema, or i18n message catalogs (message keys may be passed as props; the JSON catalogs are untouched).
- Do not touch `IssuedInvoiceView` / `IssuedCreditNoteView` (separate clones — out of scope for A3).
- Do not merge the two forms into one generic component; two form shells remain.
- Do not introduce jsdom/RTL or a new test runner.
- No visual or behavioral regression to the invoice draft form.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add row | click "add line" | new empty row appended; totals recompute | N/A |
| Remove row (>1) | multiple rows, click remove | row removed; totals recompute | N/A |
| Remove last row | exactly 1 row | remove disabled / no-op (min 1 row) | N/A |
| Save | click Save | `create*` when new, `update*` when edit; edit shows "saved" | code→message in alert; stays on form |
| Issue confirm | Issue → confirm | `issue*` called with current version; redirect on success | code→message; dialog remains |
| Discard confirm | Discard → confirm | `discard*` called; redirect on success | code→message |
| Unknown error code | action rejects, code not in allowlist | falls back to `genericError` message | shown in alert |

</frozen-after-approval>

## Code Map

- `src/components/invoices/InvoiceDraftForm.tsx` (813) -- source form; state 147-165, load effect 180-231, totals 258-265, `buildInput` 267-278, actions `handleSubmit`/`handleDiscard`/`handleIssue` 280-335, `resolveError`/`ERROR_KEYS` 84-102/172-177, `newRow`/`toNumber` 104-114, line-items render 500-650, LinkedRecordPicker 734-744, issue dialog 746-776, discard dialog 778-809.
- `src/components/invoices/CreditNoteDraftForm.tsx` (677) -- clone; props/prefill 109-131, load 181-218, `buildInput` 249-259, actions 261-312, line-items 398-527, issue dialog 611-641, discard dialog 643-674. Uses secondary `Invoices` namespace for shared labels; exports `CreditNotePrefillLine` (line 70).
- `src/lib/invoicing/tax.ts` -- `computeLineAmount`, `computeInvoiceTotals`, `TotalsLineItem`/`InvoiceTotals` types. REUSE, do not change.
- `src/lib/data/invoices-client.ts` / `credit-notes-client.ts` -- `create*`/`get*`/`update*`/`discard*`/`issue*`, `InvoiceApiError`, `InvoiceDraftInput`/`CreditNoteDraftInput`. REUSE via injection into the hook.
- `src/components/ui/{dialog,button,input,label,select}.tsx` -- shadcn primitives the extracted components build on.
- `src/components/invoices/LinkedRecordPicker.tsx` -- stays in `InvoiceDraftForm` only.
- Consumers (props must stay stable): `src/app/[slug]/invoices/new/page.tsx`, `.../invoices/[id]/page.tsx`, `.../invoices/[id]/credit-notes/new/page.tsx`, `.../invoices/[id]/credit-notes/[cnId]/page.tsx`.
- `tests/unit/credit-note-draft-form.test.tsx` -- existing SSR/`renderToStaticMarkup` test (mocks next-intl/next-navigation/framer-motion/client layer); MUST keep passing.
- `vitest.config.ts` -- env is `node` (no jsdom); tests assert on HTML strings only.

## Tasks & Acceptance

**Execution:**
- [x] `src/components/invoices/LineItemsEditor.tsx` (new) -- extract the line-items table (controlled description/quantity/unit-price inputs, per-row `computeLineAmount`, add/remove with min-1 guard) plus the totals block (subtotal, tax lines, total, hints). Props: `rows`, `onAddRow`, `onRemoveRow`, `onUpdateRow`, `totals`, and the label strings/translator. Markup per the Open Question decision. Implement via `web-uiux-architect`.
- [x] `src/components/invoices/ConfirmActionDialog.tsx` (new) -- extract the confirm-dialog pattern (title, body, confirm/cancel labels, `pending` spinner+disabled, optional `destructive` variant, `open`/`onOpenChange`/`onConfirm`). Used twice per form (issue + discard). Implement via `web-uiux-architect`.
- [x] `src/components/invoices/use-draft-form.ts` (new) -- orchestration hook: shared state (`loading`, `status`, `error`, `version`, `rows`), row helpers (`addRow`/`removeRow`/`updateRow` on `newRow`), live `totals`, dialog state (issue/discard `open`+`pending`), and generic `runSave`/`runDiscard`/`runIssue` that take injected async ops + `buildInput`/redirect callbacks and apply shared error-code mapping (`resolveError` over a base `ERROR_KEYS` set each form extends with its extra code). Form-specific state (customer object/`customerMissing`/`pickerOpen`, `dueDate`, prefill) stays in the forms.
- [x] `src/components/invoices/InvoiceDraftForm.tsx` -- slim to compose `useDraftForm` + `LineItemsEditor` + two `ConfirmActionDialog`s + `LinkedRecordPicker`; keep due-date, customer picker/label-resolution, and exported props unchanged.
- [x] `src/components/invoices/CreditNoteDraftForm.tsx` -- slim likewise; keep prefill, "corrects invoice N" header, `customerRecordId`-only handling, no due-date/picker, and exported `CreditNotePrefillLine` + props unchanged.
- [x] `tests/unit/credit-note-draft-form.test.tsx` -- keep green; adjust only mock targets/imports if a boundary moved.
- [x] `tests/unit/line-items-editor.test.tsx` (new) -- `renderToStaticMarkup`: N rows render N description inputs; subtotal/total render; column headers present; min-1 remove guard (`disabled=""` at 1 row, none at 2).
- [x] `tests/unit/confirm-action-dialog.test.tsx` (new) -- `renderToStaticMarkup`: title/body/confirm label render; `pending` renders disabled confirm + spinner.
- [x] `tests/unit/draft-error-map.test.ts` (new) -- pure `mapErrorCode`: known/extra codes resolve to themselves, unknown/null fall back to `genericError`, one form's extra code is unknown to the other.

**Acceptance Criteria:**
- Given the 4 consumer pages with today's props, when built, then they compile with no prop-signature change to either form.
- Given an invoice or credit-note draft in edit mode, when loaded, then rows/province/language/customer (and due-date for invoices) populate exactly as before.
- Given either form, when rows are added/removed and amounts edited, then displayed totals equal `computeInvoiceTotals` output as before.
- Given either form, when save/discard/issue succeed or fail, then the same redirects, error messages, and loading/"saved" states occur as before.
- Given `LineItemsEditor` and `ConfirmActionDialog`, when the forms render, then both forms use them and no duplicated table or confirm-dialog markup remains in either form.

## Implementation Notes

- Extracted three shared units under `src/components/invoices/`: `use-draft-form.ts` (config-injected orchestration hook), `LineItemsEditor.tsx` (shared table + totals, richer invoice markup per the decision), `ConfirmActionDialog.tsx` (one confirm dialog used twice per form). Both forms slimmed to thin shells composing them: `InvoiceDraftForm.tsx` 813→510 lines, `CreditNoteDraftForm.tsx` 677→414 lines; ~850 lines of duplication removed net.
- Behavior parity verified against the pre-refactor code (`git show 9f8a6a2`): confirm-button icons (`FileCheck2`/`FileMinus2`/`Trash2`), `closeLabel` wiring, disabled/pending states, issue-button `version === null || issuing` gate, redirect targets, and credit-note-only bits (no due-date, no picker, `tInvoices` for shared line labels, no language placeholder) all carried over exactly. The credit-note editor gains the invoice's column headers + totals hints — the approved additive change.
- Each form keeps its divergent state (invoice: customer object + `customerMissing` + `pickerOpen` + `dueDate`; credit note: `customerRecordId` + prefill) and passes live `province`/`taxRegistered` into the hook so totals recompute; the form's `load` callback populates its own extra fields as a side effect and returns `{version, rows}` to the hook. `buildInput` closes over the hook's `form` object but is only invoked lazily inside `runSave`, so there is no temporal-dead-zone at runtime (confirmed by `next build`).
- Matrix Test Audit: added `tests/unit/draft-error-map.test.ts` (pure `mapErrorCode`, extracted from the hook's `resolveError`) to cover the "unknown error code → genericError" row, and a min-1 remove-guard assertion to `line-items-editor.test.tsx` to cover "remove last row". Totals recompute is covered by the existing `invoice-tax.test.ts` (`computeInvoiceTotals`) plus the editor's rendered totals; the remaining event-wiring rows (add/remove append, save/issue/discard runner→injected op) are not unit-testable in the repo's node/no-jsdom env (spec "Never" + repo precedent) and are covered by the existing route/integration tests for the server ops plus the pending manual browser review.
- `web-uiux-architect` standards were applied as the quality bar (WCAG-AA focus/`sr-only`, motion discipline, Tailwind v4 idioms); the existing markup already met them, so it was preserved verbatim rather than redesigned (no glassmorphism/bento introduced), per the spec's faithful-extraction directive.
- `credit-note-draft-form.test.tsx` still passes untouched. `confirm-action-dialog.test.tsx` mocks `@/components/ui/dialog` to render children inline because Radix `DialogPortal` targets `document.body`, absent under `renderToStaticMarkup` (same technique as the form test mocking `framer-motion`).
- Verification: `npx vitest run` 890/890 pass (84 files, +6 new); `npm run lint` clean; `npm run build` exit 0 (all 4 consumer pages compile against unchanged form props). Only pre-existing build warning is from `node_modules/@prisma/instrumentation`, unrelated.
- Not done (per spec Verification): the live Playwright/`web-uiux-architect` browser review on localhost:3000 confirming no visual/behavioral regression across create+edit of both forms — recommended before marking the retro item done.

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter / edge-case-hunter / verification-gap):

- **[E3] medium → patch** — Credit-note qty/unit-price inputs lose their accessible name. Verified against baseline: baseline `CreditNoteDraftForm` named those inputs via `aria-label`; the shared `LineItemsEditor` uses an unassociated `sm:sr-only <Label>` (no `htmlFor`) for all three cells, which does not name a sibling input. So the credit-note qty/price inputs regress from named to unnamed, contradicting the spec's "strictly-additive" note. (Invoice was already unassociated → parity.) Fix associates each cell's `<Label>` with its `<Input>` via `htmlFor`/`id`, improving both forms.
- **[VG-other] low → patch** — `confirm-action-dialog.test.tsx` asserts the pending state with `toContain("disabled")`, which also matches the Tailwind `disabled:` class variants in the rendered `className`, so it would pass even if the boolean `disabled` attribute were dropped. Strengthen to `disabled=""` (as `line-items-editor.test.tsx` already does).
- **[BH8] low → patch** — `useDraftForm` returns `setRows`/`setVersion`/`setError` but neither form shell uses them (grep confirms NONE); exposing raw setters widens the API past what callers need and invites invariant-bypassing mutation. Remove from the returned object (keep internal). Direct deletion, reduces surface.
- **[BH1 / E1] low → reject** — Load effect deps `[isEdit]` (vs baseline `[isEdit, invoiceId, slug]`). The injected `load` is recreated each render, so the baseline deps were also single-shot in practice; a stale reload needs edit→edit client nav that reuses the component instance, which the app's list→detail nav remounts and does not trigger. Proper fix needs memoization (added complexity). Unlikely + non-trivial fix → rejected.
- **[BH2] low/false → reject** — Module-level `rowSeq` "shared across components/tests". Baseline forms already used module-level `rowSeq`; the two forms live on separate routes and are never co-mounted; keys stay unique; the added tests match input values, not keys. No reachable harm.
- **[BH3] low → reject** — `LineItemsEditor` uses `taxName` instead of the canonical `line.label`. Parity with baseline (both render the translated HST name, not `line.label`); ON is the only active province, so `taxName` == `line.label` == "HST" — no drift reachable.
- **[BH4] low → reject** — Credit-note header/hint addition not asserted at the form level. `line-items-editor.test.tsx` pins that headers/hints render, and both forms use the component identically, so a regression fails that test; a form-level duplicate assertion adds little.
- **[BH5] low → reject** — `buildInput`/`create`/`update` typed `unknown`. Two controlled callers each build and cast their own typed input; a generic `useDraftForm<TInput>` adds type surface/complexity for a closed seam.
- **[BH6] low → reject** — Hook runners (`runSave`/`runIssue`/`runDiscard`) untested. verification-gap found no gap: these are behavior-preserving moves of logic that was untested before too; the spec forbids introducing jsdom/RTL; the extracted pure part (`mapErrorCode`) is now tested.
- **[BH7] low → reject** — `ConfirmActionDialog` `icon` type advertises boolean `aria-hidden` while the spinner uses the string form. `aria-hidden={true}` is functionally valid for lucide; cosmetic type nit, no user/dev harm.
- **[BH9] low → reject** — `runSave` create branch stays in `"saving"` until the redirect. Identical to baseline (pre-existing); only manifests if `router.push` no-ops; no data harm; a timeout/guard adds complexity.
- **[BH10] low → reject** — No AGENTS/changelog pointer to the new shared primitives. All three new units carry file-level JSDoc stating the shared-reuse intent, and sprint-status tracks A3; a fix would edit agent-context/doc files.
- **[E2] low/false → reject** — `runDiscard` lost the baseline `!creditNoteId` guard. The discard button renders only when `isEdit`, and the injected `discard()` ids are non-null there; the null-id path is unreachable.
- **[E4] low → reject** — `LineItemsEditor` tax line uses `key={line.label}`. Only one HST line exists in the MVP (single province/rate); a collision needs ≥2 same-label lines, which is unreachable today. Future-only.
- **[VG] no gap** — verification-gap traced the full diff and found no shipping verification gap: every behavioral surface is a behavior-preserving move, no test was deleted or weakened, and the newly-testable pure logic is covered.

## Design Notes

- Keep two form shells rather than one generic form: the customer (object+picker vs id-only), due-date, and prefill differences would force a conditional-heavy mega-component. Sharing the three heavy duplicated concerns (editor, dialog, lifecycle) is exactly retro [A3]'s decomposition and gives most of the de-duplication without that cost.
- The `useDraftForm` hook is config-injected so the credit-note's `invoiceId`-scoped client calls and the invoice's flat calls are both expressible without branching inside the hook.
- Test env is node + `renderToStaticMarkup` (no jsdom): interactive add/remove/keyboard/commit paths stay manual-review only, consistent with repo precedent (deferred-work items for 3.1/3.3/3.5). Extracted-component tests assert rendered structure only.
- The `web-uiux-architect` standards in `context:` apply as a quality bar for the extracted UI (WCAG-AA focus/`focus-visible`, `sr-only` labels, motion discipline, Tailwind v4 idioms) — carry over and, where the existing invoice markup already meets them, preserve exactly. This is a faithful extraction, NOT a redesign: reuse the current Tailwind classes, shadcn primitives, and framer-motion usage verbatim; do not introduce new visual treatments (glassmorphism, bento, new color/shadow systems) or alter layout beyond the approved credit-note headers/hints addition.

## Verification

**Commands:**
- `npx vitest run` -- expected: all suites pass, including `credit-note-draft-form` and the two new component tests.
- `npm run lint` -- expected: clean (no new warnings/errors in `src`).
- `npm run build` -- expected: succeeds (this is the repo's type check).

**Manual checks:**
- Via `web-uiux-architect` / Playwright on localhost:3000: create and edit an invoice draft and a credit-note draft; confirm no visual or behavioral regression (rows, totals, save/discard/issue, dialogs), per the post-story manual-review practice.
