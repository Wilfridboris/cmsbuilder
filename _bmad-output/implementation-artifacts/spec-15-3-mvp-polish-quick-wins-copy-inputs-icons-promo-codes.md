---
title: 'Story 15.3: MVP Polish Quick-Wins — Copy, Inputs, Icons & Promo Codes'
type: 'chore'
created: '2026-10-08'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'd814a49fd0c7dfbe13c69e37690df0dc4deb01b1'
context:
  - '_bmad-output/implementation-artifacts/epic-15-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Post-testing left a batch of small rough edges: em-dashes remain in i18n banner/CTA/subtitle strings and in the Gemini prompt instruction (with no guard against em-dashes in AI-generated labels/seed values), most textareas are still drag-resizable, the browser tab and PWA install still serve the default Next scaffold favicon, Stripe Checkout cannot redeem a launch coupon, and issued invoice money renders on screen as a bare `1234.50` instead of `$1,234.50`.

**Approach:** A cohesive quick-wins pass across copy, inputs, icons, billing, and money display. Each item reuses an existing primitive (next-intl catalogs, the schema validator's label sanitizer, the shadcn Textarea base, the brand kit icon set, the Stripe session, the existing `formatMoney`) with no new architectural layer.

## Boundaries & Constraints

**Always:**
- All changed user-facing copy resolves through next-intl (en + fr) and contains no em-dash (U+2014); the no-em-dash rule applies to every string touched.
- AI-generated output is hardened by a pure `scrubEmDash` guard (not only prompt wording): it replaces U+2014 and U+2013 with a hyphen-minus and collapses any doubled space, applied to generated table labels, field labels, and select-option labels in the validator sanitizer AND to string seed values in the seeding path, so the invariant holds regardless of what the model returns.
- The Gemini prompt INSTRUCTION TEXT (the strings sent to the model, not JSDoc comments) contains no em-dash, and explicitly instructs the model to avoid em-dashes in its output.
- Textareas are not drag-resizable: the base `ui/textarea.tsx` carries `resize-none` so every textarea is consistent; the landing `PromptBuilder` textarea stays non-resizable.
- The Scheza brand favicon is served for the browser tab, and the companion icon set is present and wired: apple-touch-icon, the PWA manifest icons (192/512/maskable), and the Next metadata `icons` export. The Epic 8.2 "Add to Home Screen" install stays unbroken.
- Icon/metadata wiring follows the installed Next version's convention — consult `node_modules/next/dist/docs/` (per AGENTS.md) before writing metadata/icon code; this Next may differ from training data.
- Stripe Checkout sets `allow_promotion_codes: true`; the `success_url`/`cancel_url` return flows are unchanged.
- Issued invoice and credit-note money on screen renders with a currency symbol and locale thousands grouping via the EXISTING `formatMoney(amount, language)`, keyed off the document's FROZEN `language` so on-screen output matches the frozen PDF exactly (en `$1,234.50`, fr `1 234,50 $`).

**Never:**
- Do not rewrite or migrate existing persisted data; the em-dash guard affects only new generation output going forward.
- Do not change the `POST /api/generate` response contract, the generation/claim flow, or the frozen-snapshot invariant (I6) of issued invoices.
- Do not modify the frozen PDF money path beyond confirming it already uses `formatMoney` (no regression).
- Out of scope: the draft `LineItemsEditor` line amounts and the mark-paid amount input (both bare-number-by-design editor contexts; the AC scopes money to issued surfaces + PDF); Google sign-in (15.4); any broader copy sweep beyond the strings named here.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| i18n scrub | `fallbackBanner`, `lastTable`, `ctaSubtext`, invite `subtitle` (en+fr) | em-dash replaced with a comma/period/colon that reads naturally; meaning preserved | n/a |
| Prompt instruction | `prompts.ts` instruction strings | no em-dash in instruction text; model told to avoid em-dashes in output | n/a |
| AI label with em-dash | model returns table/field/option label containing `—` | `scrubEmDash` yields a hyphen-minus, no doubled space; persisted label has no em-dash | guard, never reject |
| AI seed value with em-dash | string seed cell containing `—` | scrubbed to hyphen-minus before persist | guard |
| Textarea drag | user drags any textarea corner | cannot resize (`resize-none`); `field-sizing-content` auto-grow unaffected | n/a |
| Favicon / install | browser tab + "Add to Home Screen" | Scheza brand favicon shown; apple-touch-icon + manifest icons + metadata icons present | n/a |
| Promo code | create Checkout session | Stripe-hosted page shows a promotion-code field; coupon redeemable; return flows unchanged | n/a |
| Issued money en | `invoice.language = en`, total 1234.5 | on screen `$1,234.50`, matching the PDF | n/a |
| Issued money fr | `creditNote.language = fr`, total 1234.5 | on screen `1 234,50 $`, matching the PDF | n/a |

</frozen-after-approval>

## Code Map

- `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- em-dashes at `Generate.fallbackBanner` (85), `*.lastTable` (134), `*.ctaSubtext` (145), invite `subtitle` (196) in BOTH files. Rewrite each without an em-dash. No other `src` i18n strings contain `—`.
- `src/lib/gemini/prompts.ts` -- em-dashes appear in JSDoc comments (ignore) AND in the numbered instruction list inside the `buildGenerationPrompt` template literal (e.g. lines 290/294/295/297+). Remove em-dashes from the INSTRUCTION strings and add a short "no em-dash in any label or value" instruction.
- `src/lib/schema/validator.ts` -- `validateGeneratedSchema` sanitizes labels: table `t.label.trim()` (~419), field `label: f.label.trim()` (507-509), and select-option `o.label.trim()` in `validateSelectOptions` (363). Apply `scrubEmDash` at each. Add the helper here (or a small shared util) as a pure, node-testable function.
- `src/lib/generation/provision.ts` + `src/lib/data/seed.ts` -- seeding path for generated rows (`seedRows`). Scrub em-dash from string seed values before persist. Pin the exact seam during implementation (seed inflation is the natural spot).
- `src/app/api/generate/route.ts` -- consumes `validateGeneratedSchema` (`validation.sanitized`) + parsed `seedRows`; no contract change, just benefits from the guard upstream.
- `src/components/ui/textarea.tsx` -- shadcn base; add `resize-none` to the className so all textareas are consistent. `PromptBuilder.tsx:161` already has `resize-none` (becomes redundant but harmless).
- `src/app/favicon.ico` -- the DEFAULT Next scaffold favicon (25931 bytes, Sep-24). Replace with the brand `scheza-brand-kit/web/favicon.ico` (2325 bytes). Optionally add `scheza-brand-kit/web/favicon.svg`/`favicon-16|32|48.png`.
- `src/app/layout.tsx` -- `export const metadata.icons` currently only `{ apple: "/apple-touch-icon.png" }` (29-31). Extend with the favicon/icon entries per the Next metadata-icons doc.
- `src/app/manifest.ts` -- already lists the three brand icons (192/512/maskable). Verify only; no change expected.
- `src/app/api/stripe/checkout/route.ts` -- add `allow_promotion_codes: true` to `stripe.checkout.sessions.create(...)` (~115-126). One line; return flows untouched.
- `src/lib/invoicing/format.ts` -- `money(value)` is bare `.toFixed(2)` (7-10): the on-screen defect. `src/lib/invoicing/tax.ts` already exports `formatMoney(amount, language)` producing `$1,234.56`/`1 234,56 $`.
- `src/components/invoices/IssuedInvoiceView.tsx` -- renders `money(...)` at 172/175/191/210/219; has the viewer `locale` prop and `invoice.language` (InvoiceRow carries `language`). Switch money renders to `formatMoney(x, language)` using the frozen `invoice.language` (derive `en|fr` as the credit-note view does at line 68).
- `src/components/invoices/IssuedCreditNoteView.tsx` -- renders `money(...)` at 182/185/201/217; already derives `language` (68). Switch to `formatMoney(x, language)`.
- `src/lib/invoicing/pdf.tsx` -- already uses `formatMoney(..., lang)` (450-473). Verify only (no regression).
- Tests live in `tests/unit/` (vitest). Relevant existing suites: `format.test.ts`, `gemini-generation.test.ts`, `invoice-tax.test.ts`, `provision.test.ts`, `route-generate.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- rewrite the four em-dash strings in each file without an em-dash, preserving meaning and natural phrasing.
- [x] `src/lib/gemini/prompts.ts` -- strip em-dashes from the instruction template strings and add a no-em-dash output instruction (comments may stay).
- [x] `src/lib/schema/validator.ts` -- add a pure `scrubEmDash` helper and apply it to sanitized table labels, field labels, and select-option labels.
- [x] `src/lib/generation/provision.ts` / `src/lib/data/seed.ts` -- apply `scrubEmDash` to string seed values before persist. (Implemented in `validator.ts` `filterSeedRows`, the pure seed-inflation projection point every generated row flows through.)
- [x] `src/components/ui/textarea.tsx` -- add `resize-none` to the base className.
- [x] `src/app/favicon.ico` -- replace the scaffold favicon with the brand favicon; add brand `favicon.svg` if wiring it via metadata.
- [x] `src/app/layout.tsx` -- extend `metadata.icons` with the favicon/icon entries per the installed Next metadata-icons doc.
- [x] `src/app/api/stripe/checkout/route.ts` -- set `allow_promotion_codes: true` on the Checkout session.
- [x] `src/components/invoices/IssuedInvoiceView.tsx` + `IssuedCreditNoteView.tsx` -- render money via `formatMoney(amount, language)` using the frozen document language; drop the bare `money()` import (remove `money` from `src/lib/invoicing/format.ts` if then unused). (`money()` kept: still used by out-of-scope `InvoiceCreditNotes.tsx`.)
- [x] `tests/unit/` -- unit test `scrubEmDash` (em/en-dash → hyphen, no doubled space) and that `validateGeneratedSchema` output labels carry no em-dash given em-dash input; test issued-money formatting (en `$1,234.50`, fr `1 234,50 $`); assert the i18n bundles and the prompt instruction contain no em-dash.

**Acceptance Criteria:**
- Given the en + fr i18n bundles, when scanned, then no em-dash remains in any user-facing string.
- Given a generation that returns an em-dash in a label or seed value, when it is sanitized/seeded, then the persisted label/value contains no em-dash.
- Given any textarea, when the user drags its resize handle, then it does not resize.
- Given the app in a tab and installed as a PWA, when icons load, then the Scheza brand favicon, apple-touch-icon, manifest icons, and metadata icons are all served.
- Given the subscription Checkout session, when it opens, then a promotion-code field is available and the success/cancel returns are unchanged.
- Given an issued invoice or credit note, when money renders on screen, then it shows a currency symbol and thousands grouping matching the frozen PDF.

## Implementation Notes

Per the user's run instruction, route any UI/visual decision (textarea consistency, favicon/icon presentation) through the `/web-uiux-architect` skill. Consult `node_modules/next/dist/docs/` for the current metadata/icons convention before writing the layout/icon wiring (AGENTS.md: this Next version may differ from training data).

Implementation deviations (recorded at build time):
- Prompt em-dashes: the Code Map pointed at `buildGenerationPrompt`, but the instruction em-dashes actually lived in `buildEditorPrompt` (the generation prompt was already clean from 15.1). Fixed the editor prompt and added a global no-em-dash STYLE instruction, honoring the Always rule ("the Gemini prompt INSTRUCTION TEXT contains no em-dash").
- Seed-value scrub seam: placed in `filterSeedRows` (validator.ts) — the pure, node-testable projection every generated row flows through — rather than `provision.ts`/`seed.ts`.
- `money()` in `invoicing/format.ts` was kept (not removed): still used by the out-of-scope `InvoiceCreditNotes.tsx`.
- Icons: added brand `favicon.svg` + `favicon-16/32/48.png` to `public/` and wired `metadata.icons.icon`; the file-based `app/favicon.ico` still emits the classic `<link rel="icon">`; `manifest.ts` verify-only (unchanged).
- Matrix coverage: the textarea-drag (CSS `resize-none`) and favicon/install (binary assets + head links) rows are verified by manual review, not unit tests (not testable in the node env); the other seven rows have passing unit tests.

Review patches (pass 1): narrowed the `scrubEmDash` docstring to the generation/seed scope (the chat-editor validators are intentionally out of scope) and added a trailing `.trim()` so a dash at a string edge leaves no dangling whitespace; extended the on-screen money fix to `InvoiceCreditNotes.tsx` (the credit-note list total) via `formatMoney` keyed off the note's frozen `language` — adding `language` to `CreditNoteSummary` (Pick + select) — since this change had otherwise left that sibling list rendering a bare figure next to the newly-formatted detail views.

## Verification

**Commands:**
- `npm run type-check` -- expected: no errors.
- `npm run lint` -- expected: clean on `src`.
- `npm run test` -- expected: all unit tests pass, including the new `scrubEmDash`/label-guard, issued-money, and no-em-dash bundle/prompt assertions.
- `npm run build` -- expected: production build succeeds.

**Manual checks (if no CLI):**
- Playwright MCP review on localhost:3000: confirm the brand favicon in the tab; generate and confirm labels/seed values have no em-dash; try to drag-resize a textarea (should not resize); open an issued invoice and confirm on-screen money reads `$1,234.50`; open a subscription checkout and confirm the promotion-code field.

## Spec Change Log

(No bad_spec loopbacks.)

## Review Triage Log

Pass 1 (blind-hunter, edge-case-hunter, verification-gap). No intent_gap or bad_spec, so no loopback. Patches: scrubEmDash docstring + trailing-trim, and InvoiceCreditNotes list money formatting. One defer (render-level money test). Edge-case-hunter returned no findings.

- **patch** `scrubEmDash` docstring overclaims it holds "regardless of what the model returns", but the chat-editor validators (`validateAddField`/`validateAddTable`/`validateAddSelectOption`/`validateRenameSelectOption`, validator.ts ~722/846/982/1023) return raw `.trim()` labels without the scrub (blind) — low. Verified: those functions do not call `scrubEmDash`. The editor path is out of frozen AC2 scope (AC2 targets the Gemini GENERATION prompt + its output), so the functional gap is out of intent; the only in-scope defect is the inaccurate docstring. Fix: narrow the docstring to the generation/seed scope.
- **patch** `src/components/invoices/InvoiceCreditNotes.tsx:165` still renders bare `money(creditNote.total)` while the issued views now use `formatMoney`, a visible on-screen money inconsistency on the invoice page (blind, verification-gap `other`) — medium. Verified: line 165 uses `money()`; `CreditNoteSummary` (credit-notes.ts:42) carries no `language`. This change exposed the inconsistency (all three were bare before); the frozen block does NOT exclude this file (only `LineItemsEditor`/mark-paid input are frozen-out). Fix: format via `formatMoney` keyed off the note's frozen language (add `language` to the summary Pick + select).
- **patch** `scrubEmDash` can leave a dangling hyphen / edge whitespace when a dash sits at a string edge; the `.trim()` runs before the scrub, not after (blind) — low. Verified by tracing the regex + collapse. Cosmetic and far-fetched (model emitting a label ending in an em-dash), but trivially corrected by a trailing `.trim()`; bundled with the docstring patch since same function.
- **defer** The issued-view money change is untested at the view boundary: no test renders `IssuedInvoiceView`/`IssuedCreditNoteView`, so the new `language` derivation + `Number(...)` coercion are unobserved; inverting the ternary keeps the suite green (verification-gap `defer`, blind) — medium (unverified by automated test). These are `async` server components the repo deliberately verifies via post-commit Playwright MCP (mirrors 15-2); the spec's manual-check list covers exactly this. Covered by the mandated manual review now; ledgered for an optional future render-level test.
- **false** `scrubEmDash` scrubs en-dashes (U+2013) but `no-em-dash-copy.test.ts` only asserts em-dash (U+2014) absence (blind) — refuted. No bad outcome: the project rule is em-dash-specific; static copy needs no en-dash guard, and scrubbing en-dash from AI output is harmless extra hardening, not an invariant requiring a static-copy test.
- **false** `allow_promotion_codes: true` is not gated to a launch window and stays on for all tiers forever (blind) — refuted. The frozen spec + AC/FR109 set the flag unconditionally; coupons are created and retired in the Stripe dashboard, so permanence is the intended control model.
- **false** `favicon.ico` binary changed but the layout comment ("already emits …") reads as if unchanged, and the manifest-icon claim is asserted not verified (blind) — refuted. The `.ico` replacement is the spec task (scaffold → brand, intended); the comment describes Next's auto-emit mechanism (accurate regardless of icon content); `manifest.ts` was verify-only because it already carried the 192/512/maskable icons.
- **false** `textarea.tsx` gains `resize-none` globally, a UX regression for long-form inputs with no opt-out (blind) — refuted. The frozen Boundaries mandate exactly this ("the base `ui/textarea.tsx` carries `resize-none` so every textarea is consistent"); `field-sizing-content` still auto-grows textareas with content, so only manual drag is removed, which is the intended behavior.
- **low (reject)** `IssuedCreditNoteView` was converted but got no explanatory comment while `IssuedInvoiceView` did and even cross-references it (blind). Cosmetic doc asymmetry, no named harm; the credit-note derivation is a self-evident one-liner.
