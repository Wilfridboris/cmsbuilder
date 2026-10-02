---
title: 'Story 5.6: Remove a View via Chat'
type: 'feature'
created: '2026-10-02'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'cddc7a33d0d35f8ef5759d92fbfcc53432ff8abd'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 5.3 lets an Admin create views via chat, but there is no way to remove one, so view tabs accumulate with no cleanup path (FR97). Unlike a table, a view is pure metadata (a saved filter/sort over existing rows and stores no data of its own), so removing it is inherently non-destructive. This story also picks up the Undo-on-add-view affordance parked when Story 5.5 shipped only the column path.

**Approach:** Introduce one new editor operation, `remove_view`, that deletes a view's definition from `org_schemas` (it is removed, not hidden — a view holds no rows, so there is no visibility flag for views). `remove_view` joins the Story 5.4 allowlist fence (`PERMITTED_OPERATIONS`), the editor prompt is taught the existing views (key + label) so the model can return an exact `viewKey`, and a new guarded `removeView` mutator + pure `removeView` transform do the read-validate-write. Removal is reachable two ways: (1) by chat NL ("remove the Unpaid view"); (2) by an Admin-only "Remove view" control in the view-tab overflow menu that removes optimistically and offers an inline Undo. The just-added-view chat bubble also gains an Undo. Both Undo paths and the tab control call a new direct, non-LLM `POST /api/schema/views` (mirroring Story 3.5's `/api/schema/columns`): remove deletes by `viewKey`; restore (Undo) re-adds the returned definition through the existing `addView`. All copy is server/`ChatAssistant`/`RecordsView` i18n (en + fr), reassuring, no em-dash, and no raw JSON/SQL/schema/stack ever shown.

## Boundaries & Constraints

(Epic-5 invariants in `epic-5-context.md` apply; below is specific to this story.)

**Always:**
- A remove-view request for an exactly-identifiable existing view resolves to `remove_view` and is satisfied by `removeView(identity, viewKey)` — the view object is removed from `schema.views`; no field, table, or row in `records` is touched (a view stores no data).
- `remove_view` is added to `PERMITTED_OPERATIONS` so it passes the same Story 5.4 fence (`assertEditorOperationAllowed` = allowlist + raw-SQL discard) as the add ops; its branch then validates `viewKey` is a non-empty string AND resolves to a view in the summary the model was shown before any write (an out-of-summary / hallucinated / stale key → reassuring `declined`, no mutation — mirrors the Story 5.5 resolve-before-write guard).
- The editor prompt lists the existing views (exact `key`, `label`, source table) so the model returns an EXACT `viewKey`; a remove request naming no resolvable view (none match, or several plausible) routes to `needs_clarification` → `clarify`, removing nothing.
- The Admin-only view-tab overflow menu exposes "Remove view"; selecting it removes the view optimistically and shows an inline Undo affordance (reusing the dashboard `StatusMessage` region, no new toast dependency). Undo restores the removed view unchanged via the direct endpoint's restore action.
- A newly applied `add_view` chat result carries an Undo affordance that removes the just-added view via the same `remove_view` path; after apply or undo, `router.refresh()` updates the view switcher.
- Both the tab control and both Undo flows go through a new direct `POST /api/schema/views` that is Admin-gated server-side (`requireAdmin` + `membership.slug === slug`, `resolveWritableOrgIdentity`) exactly like `/api/schema/columns`; a Member receives 403 and the control is not rendered for Members.
- Restore (Undo of a removal) re-adds the removed view's `{label, sourceTableKey, filters, sort}` through the existing `addView`; because the removed key's slot is free, the same `viewKey` is re-derived.
- New user-facing copy lives only in `ChatAssistant` and `RecordsView` i18n (en.json + fr.json), is reassuring and non-technical, contains no em-dash, and never mentions JSON, SQL, schemas, or errors.

**Never:**
- No view `hidden`/visibility flag and no view-hide mutator — a view is removed outright (this story explicitly does not reuse or build the field-style hide path for views).
- No table removal/hide, no column changes, no rename, no relationship edits, no data mutation — only a view definition is deleted (and re-added on Undo).
- Never change Story 5.4's verb/raw-SQL guards, the `add_field` / `add_table` / `hide_field` branches, the `needs_clarification`/`out_of_scope` conversational flows for other requests, the degraded LLM-failure path, or auth/role gating.
- Never expose a raw `viewKey`, JSON, SQL, schema object, or error stack to the user in any message.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Remove a named view (chat) | "remove the Unpaid view" (one match) | `remove_view` → `removeView(identity, unpaid)`; `applied` + `viewRemoved` copy naming the view; the view tab disappears on refresh; no rows touched | N/A |
| Remove view, ambiguous/none | "remove the view" (0 or 2+ candidates) | `needs_clarification` → `clarify` naming candidate views; nothing removed | N/A |
| View not found / stale (chat) | `remove_view` with a `viewKey` not in the shown summary | Route resolves against the summary first; out-of-summary → reassuring `declined`; nothing written | Graceful decline, no raw key |
| Remove via tab control | Admin opens a view tab's overflow menu → "Remove view" | Optimistic remove via `POST /api/schema/views` (remove); inline Undo affordance shown; view tab gone | On failure: reassuring `removeViewFailed` banner, view restored in UI |
| Undo a tab removal | Undo on a just-removed view | `POST /api/schema/views` (restore) re-adds the view def; view tab returns; `viewRestored` copy | N/A |
| Undo an add-view (chat) | Undo on a just-added view bubble | `remove_view` path removes the just-added view; bubble swaps to `undone` copy | N/A |
| Member attempts removal | Member calls `POST /api/schema/views` (or `remove_view`) | 403 `forbidden`; control not rendered for Members | 403, no write |
| Raw SQL in output | `remove_view` output stringifies to contain `;`/`--`/a SQL verb | Caught by the existing raw-SQL discard in the fence; `rejected` + logged | Rejection is total |

</frozen-after-approval>

## Code Map

- `src/lib/schema/validator.ts` — `PERMITTED_OPERATIONS` (L66-71) + `isPermittedOperation` (L76-81) + `assertEditorOperationAllowed` (L242-269, the allowlist + raw-SQL fence). **Change:** add `"remove_view"` to `PERMITTED_OPERATIONS`; refresh the rationale comment. Leave `BLOCKED_KEYWORDS` / raw-SQL / reserved-key logic untouched (none of the new op name's chars are blocked).
- `src/lib/gemini/prompts.ts` — `buildEditorPrompt` (L168-261): intro L208 ("FOUR things"), rule 3 `add_view` (L233-244), rule 5 `out_of_scope` (L250-252). Table list built at L176-192 from `options.tables` only. `EDITOR_RESPONSE_SCHEMA` `kind` enum (L274-283), properties (L285+), `propertyOrdering`. **Change:** add a `views` option to `buildEditorPrompt` (+ a `ChatViewSummary` type: `{ key, label, sourceTableKey }`) and render an existing-views list; add rule 7 `remove_view` (return EXACT `viewKey` from that list; 0/2+ matches → `needs_clarification`); update the intro to include "remove a view" and narrow rule 5 so view-removal routes to `remove_view` not `out_of_scope`; add `"remove_view"` to the enum, add a `viewKey` STRING property, extend `propertyOrdering`. No em-dash.
- `src/app/api/schema/edit/route.ts` — `EditorChatResult` (L89-109, `viewKey?` already present; `undo?: "hide" | "show"` L104), `GeminiEditorOutput` (L112-130), the `tables` summary build (L181-195 via `visibleTables`), `buildEditorPrompt` call (L201-205), the `add_view` branch (L372-459, applied return L442-455 with the "deferred" comment at L438-441), `handleMutateError`. **Change:** build a `views: ChatViewSummary[]` from `visibleViews(schemaResult.data)` and pass to `buildEditorPrompt`; add `kind: "remove_view"` + `viewKey?: unknown` to `GeminiEditorOutput`; add `"remove"` to `EditorChatResult.undo`; make the `add_view` applied result carry `undo: "remove"` (+ existing `viewKey`/`label`) so the bubble shows an Undo; add a `remove_view` branch (after L459) that validates `viewKey`, resolves it against the `views` summary (out-of-summary → `declined`), calls `removeView(identity, viewKey)`, returns `applied` + `t("viewRemoved", { view })`, mapping mutate errors via `handleMutateError`; update the L438-441 comment (add-view Undo now exists; view hide remains unsupported — views are removed).
- `src/lib/schema/overrides.ts` — `visibleViews` (L37-39), `addView` transform (L223-231). **Change:** add a pure `removeView(schema, viewKey)` that returns a new `SchemaDefinition` with the matching view FILTERED OUT of `schema.views` (destructive array removal, not a flag). Do not alter `visibleViews`.
- `src/lib/data/schema-mutate.ts` — `addView` (L344-393, pattern: read schema → validate → transform → write-back → `ApiResponse`), `setFieldVisibility` (L62-110). **Change:** add a guarded `removeView(identity, viewKey, context?)` mutator mirroring `addView`: read the RLS-scoped schema, 400 (`AppError`) if `viewKey` is absent, apply the `removeView` transform, write the full definition back, return the removed `ViewDefinition` (so restore/Undo can re-add it).
- `src/app/api/schema/views/route.ts` + `src/app/api/schema/views/schemas.ts` — **NEW**, mirror `src/app/api/schema/columns/route.ts` (+ its `schemas.ts`) exactly (session → zod → `requireAdmin` + `membership.slug === slug` → `resolveWritableOrgIdentity` → mutator; `handleError` envelope). `POST` body `{ slug, action: "remove" | "restore", viewKey?, view? }`: `remove` → `removeView(identity, viewKey)` returns the removed def; `restore` → `addView(identity, { label, sourceTableKey, filters, sort })` returns `{ viewKey }`. Zod validates each action's shape.
- `src/lib/data/schema-chat-client.ts` — `postEditorChat` (→ `/api/schema/edit`), `postSetColumnVisibility` (→ `/api/schema/columns`). **Change:** add `postRemoveView(slug, viewKey)` and `postRestoreView(slug, view)` hitting `POST /api/schema/views`; throw `SchemaChatError` on failure (existing pattern).
- `src/components/dashboard/RecordsView.tsx` — view tabs (L308-369), Admin gate `role === "admin"` (L404), `StatusMessage` region (L383 render / L591-609 impl) driven by `actions.message` / `actions.setMessage`. `src/components/ui/popover.tsx` exists. **Change (with `/web-uiux-architect`):** add an Admin-only per-view overflow menu (Popover) with a "Remove view" item; on select, optimistically remove via `postRemoveView` and show an inline Undo in the `StatusMessage` region whose Undo calls `postRestoreView`; on failure show `removeViewFailed` and keep/restore the tab; `router.refresh()` after apply/undo. Members never see the control.
- `src/components/chat/ChatPanel.tsx` (kind→bubble map L263-281, Undo gating L60-67 / L136-149) + `src/components/chat/MessageBubble.tsx` (variants L27-99, `appliedView` L80-84). **Change (with `/web-uiux-architect`):** gate an Undo on an `appliedView` result carrying `undo: "remove"` + `viewKey`; the Undo calls `postRemoveView` and swaps the bubble to `undone` copy. Reuse the existing Undo button/gating shape from the add-column path.
- `src/lib/i18n/en.json` + `fr.json` — `ChatAssistant` block (L478+, has `successViewAdded` L488, `undo` L491, `columnHidden`/`restored`), `RecordsView` block (has `viewTabLabel` L383). **Add:** `ChatAssistant.viewRemoved` (names the view) + reuse `undone`/`clarifyFallback`/`declineFallback`/`rejection`; `RecordsView.removeView` (control label), `viewRemovedUndo` (banner w/ Undo), `viewRestored`, `removeViewFailed`. All no em-dash.
- Tests: `tests/unit/route-schema-edit.test.ts`, `tests/unit/schema-validator.test.ts`, `tests/unit/schema-mutate*.test.ts` (+ `overrides` test), `tests/unit/records-view.test.tsx`, `tests/unit/schema-chat-client*.test.ts`, and a new `tests/unit/route-schema-views.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/schema/validator.ts` -- add `"remove_view"` to `PERMITTED_OPERATIONS` and refresh the rationale comment; confirm `assertEditorOperationAllowed` admits it through the same allowlist + raw-SQL fence.
- [x] `src/lib/schema/overrides.ts` -- add the pure `removeView(schema, viewKey)` transform (filter the view out of `schema.views`); leave `visibleViews` untouched.
- [x] `src/lib/data/schema-mutate.ts` -- add the guarded `removeView(identity, viewKey, context?)` mutator (read-validate-write, `AppError(400)` on missing view, returns the removed `ViewDefinition`), mirroring `addView`.
- [x] `src/lib/gemini/prompts.ts` -- add a `views` option + `ChatViewSummary` type to `buildEditorPrompt`, render the existing-views list, add the `remove_view` classification rule (exact `viewKey`; ambiguous/none → `needs_clarification`), narrow `out_of_scope`, and add `"remove_view"` + a `viewKey` property to `EDITOR_RESPONSE_SCHEMA` (+ `propertyOrdering`). No em-dash.
- [x] `src/app/api/schema/edit/route.ts` -- pass `visibleViews` summary to the prompt; extend `GeminiEditorOutput` (`remove_view` + `viewKey`) and `EditorChatResult.undo` (`"remove"`); make `add_view` applied carry `undo: "remove"`; add the `remove_view` branch (resolve-before-write guard → `removeView`, graceful `declined`/`degraded`); update the forward-ref comment.
- [x] `src/app/api/schema/views/route.ts` + `schemas.ts` -- NEW direct Admin-gated endpoint (mirror `/api/schema/columns`) supporting `remove` (→ `removeView`) and `restore` (→ `addView`).
- [x] `src/lib/data/schema-chat-client.ts` -- add `postRemoveView` and `postRestoreView` hitting `POST /api/schema/views`.
- [x] `src/components/dashboard/RecordsView.tsx` -- Admin-only view-tab overflow menu with "Remove view" (optimistic remove + inline Undo in the StatusMessage region, `removeViewFailed` on error).
- [x] `src/components/chat/ChatPanel.tsx` + `MessageBubble.tsx` -- render an Undo on the `appliedView` bubble (gated on `undo: "remove"` + `viewKey`) that removes the just-added view.
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add `viewRemoved`, `removeView`, `viewRemovedUndo`, `viewRestored`, `removeViewFailed` (+ `viewUndone`, `viewTabMenu`, and a RecordsView `undo` label); reassuring, non-technical, no em-dash.
- [x] `tests/unit/*` -- cover the I/O matrix (see below): validator admits `remove_view`; the `removeView` transform + mutator remove only the target view (no other view/table/rows touched); the edit-route `remove_view` branch (applied, out-of-summary → declined, raw-SQL → rejected, add_view now carries `undo:"remove"`); the new views route (remove, restore, Member 403, slug mismatch 403, missing view, no raw leak); RecordsView (Admin sees control; Member does not).

**Acceptance Criteria:**
- Given an Admin in the chat editor, when they ask to remove an existing view (e.g. "remove the Unpaid view"), then a validated `remove_view` operation removes the view definition from `org_schemas` and no rows in `records` are affected. (FR97)
- Given the view-tab surface, when an Admin opens a view's overflow menu, then a "Remove view" control is available (Admins only) and removal shows an inline Undo affordance that restores the view unchanged.
- Given a newly applied `add_view` result in chat, when it is shown, then it carries an Undo that removes the just-added view via the same `remove_view` path.
- Given a remove-view request that names no existing view, when it is processed, then the editor asks a clarifying question and removes nothing; no raw JSON/SQL/error is ever exposed.
- Given a Member, when they attempt to remove a view (control hidden; direct endpoint), then the control is absent and the server returns 403 with no write.

## Implementation Notes

- Implemented all Code Map changes as specified. The `remove_view` mutator rejects a missing/unknown view with `AppError(400, "removeViewFailed")` (the error CODE the caller maps; the edit route maps a 400 to a reassuring `declined`, and the direct views route surfaces the CODE via `handleError`). An i18n `removeViewFailed` string backs it.
- The edit route applies the resolve-before-write guard against the `visibleViews` summary the model was shown (mirrors the Story 5.5 hide_field guard): an out-of-summary / stale / hallucinated `viewKey` → `declined`, no mutator call. The `add_view` applied result now carries `undo: "remove"` + the `viewKey` so the chat bubble offers an Undo.
- The new direct endpoint `POST /api/schema/views` mirrors `/api/schema/columns` exactly (session → zod discriminated-union → `requireAdmin` + `membership.slug === slug` → `resolveWritableOrgIdentity` → guarded mutator → `handleError`). `remove` returns the removed `ViewDefinition`; `restore` re-adds it through the existing `addView` (freed key re-derives identically).
- RecordsView: the per-view overflow menu is a Radix `Popover` with a destructive "Remove view" item, Admin-only (`role === "admin"`, view tabs only). Removal is optimistic (the view key is tracked in a local `removedViewKeys` set that filters the tab) with an inline Undo banner (`ViewRemovedBanner`) reusing the same animated region as `StatusMessage` (no toast dependency); on failure the tab is restored and `removeViewFailed` shown. `router.refresh()` runs after remove and undo.
- Added i18n keys beyond the spec's list where needed for complete, non-technical copy: `ChatAssistant.viewUndone` (the chat add-view Undo swap copy), `SlugDashboard.viewTabMenu` (the overflow trigger aria-label), and `SlugDashboard.undo` (the banner's Undo button). All en+fr, no em-dash.

## Spec Change Log

## Review Triage Log

Pass 1 (review_loop_iteration 0) — blind-hunter (10), edge-case-hunter (7), verification-gap (0 gaps + 2 other). No intent_gap / bad_spec → no loopback; 2 patches, 1 defer, rest rejected.

- [blind/edge] **Chat `remove_view` applied renders the add-table glyph** (`ChatPanel.tsx` variant select) — `low → patch`. A chat NL removal returns `{applied, viewKey}` with no `undo`; `isView` is gated on `undo === "remove"`, so `isHide`/`applied`/`appliedView`/`isView` are all false and the variant falls through to `appliedTable` (Table2 glyph). Verified real and hit on every chat-driven removal (the copy is correct, no Undo is correct; only the glyph is wrong). Fix is a small within-diff UI change (a removal-appropriate glyph), so patch.
- [blind] **Restore-failure reuses `removeViewFailed` ("We couldn't remove that view")** (`RecordsView.handleUndoRemoveView` catch) — `low → patch`. A failed Undo-restore shows the remove-error copy, telling the user the opposite of what failed. Rare path (restore only fails on schema drift) but a trivial direct correction (add `restoreViewFailed`), so patch.
- [blind/edge] **Restore re-runs `validateAddView`, so "restores the view unchanged" can fail on schema drift** (`views/route.ts` restore → `addView`) — `low → reject`. Real: if the view's source table/filter-field was hidden between remove and Undo, re-validation 400s and the view stays removed. But the failure is graceful and non-destructive (no data lost; the view can be re-created), the window is narrow, and re-validating the client-supplied restore payload is a deliberate security guard (bypassing it to force an "unchanged" restore would be a regression). Everyday-rare + fix adds complexity → reject.
- [edge] **"Freed key re-derives identically" over-claimed for suffixed/colliding keys** (`validateAddView` disambiguation) — `low → reject`. Round-trips in the common case; only a label-collision created between remove and restore yields a suffixed key. Functionally harmless — `postRestoreView` ignores the returned key and `router.refresh()` reconciles the UI from server data. Fix would be doc-only (edit the spec) → reject.
- [blind] **`activeIndex` not reconciled when a view tab is removed** (`RecordsView` optimistic filter) — `low → reject`. `safeIndex = Math.min(activeIndex, len-1)` clamps (no crash/out-of-range); shifting to a neighbor when the active (or a left-of-active) tab is removed is expected UX, and `router.refresh()` reconciles. Cosmetic wobble; fix adds index-reconciliation complexity → reject.
- [blind] **Multiple status regions can render simultaneously** (`actions.message` / `viewError` / `ViewRemovedBanner` / `ViewNotice`) — `low → reject`. Cosmetic; the "single reassuring line" is a soft intent and mutual exclusion adds state/branches for no named harm → reject.
- [edge] **`result.data!` non-null assertions in `views/route.ts`** — `false`. The guarded mutators always return `{data:{…}, error:null}` or throw `AppError`; they never return `{data:null}`, so the asserted TypeError is unreachable. The edit-route's `if (!result.data)` is belt-and-suspenders, not a contract difference.
- [edge] **`removeView` zero-row UPDATE reports success** — `false`. To reach the UPDATE, `getSchema` already succeeded (row exists, else 500) and the view was found in it (else 400); the RLS client scopes the UPDATE to that same org row, so it always matches. Unreachable. (Mirrors `addView`'s pre-existing pattern.)
- [edge] **Duplicate-key views → restore re-adds only one** — `false`. View keys are disambiguated against existing view keys at creation, so two stored views cannot share a key via the validated path; this requires pre-existing data corruption outside this story's reach.
- [blind/vgap-other] **No component-level test for the add-view/remove-view chat glue** (`ChatPanel.tsx`) — `reject`. The verification-gap layer (the coverage authority) found NO gap: the behavior is covered at the edit-route contract seam (`route-schema-edit.test.ts`) and the chat-client transport seam (`schema-chat-client.test.ts`), matching the repo's established convention (the Story 5.1/5.5 column-Undo dispatch was likewise never component-tested). UI rendering is covered by the mandated post-commit Playwright review.
- [blind] **Spec Code Map says i18n under a `RecordsView` block but keys landed under `SlugDashboard`** — `reject`. Doc-only naming drift with no code impact, and the only fix edits this build's spec (disallowed).
- [vgap-other/blind] **Pre-existing dead view-hide infrastructure** (`visibleViews` filters `!view.hidden`; `ViewDefinition` carries `hidden?`) contradicts the "no view visibility flag" decision — `defer`. Not caused by this story (the `removeView` transform correctly does a true array removal); recorded for a future cleanup to drop the unused view `hidden` field/filter.

## Design Notes

A view is the one removal the append-only guarantee permits, precisely because it holds no rows — so unlike `hide_field` (Story 5.5), the right model is a true delete from `schema.views`, not a visibility flag. Reversibility is provided by Undo re-adding the removed definition through the already-validated `addView` (the freed key re-derives identically), so no view-specific restore logic or `hidden` flag is introduced. `remove_view` joins `PERMITTED_OPERATIONS` (rather than being exempted like the conversational kinds) to keep ONE uniform allowlist + raw-SQL fence over every model-driven operation, and the route re-applies Story 5.5's resolve-the-target-against-the-shown-summary-before-writing guard so a hallucinated or stale `viewKey` can never reach the mutator. The tab control and both Undo flows share one direct, non-LLM endpoint (`POST /api/schema/views`, modeled on Story 3.5's `/api/schema/columns`) because a button click carries no natural language and must not spend a Gemini call. No toast library exists in the app; the established convention is the inline animated `StatusMessage` banner, so the tab-surface Undo reuses that region with an Undo action rather than introducing a toast primitive. Table hide (and add-table Undo) remain out of scope — Story 5.7.

## Verification

**Commands:**
- `npm run test -- route-schema-edit` -- expected: remove_view applied / out-of-summary→declined / raw-SQL→rejected rows pass; add_view applied carries `undo:"remove"`.
- `npm run test -- route-schema-views` -- expected: remove + restore succeed; Member→403; slug mismatch→403; missing view→graceful error, no raw leak.
- `npm run test -- schema-validator schema-mutate overrides records-view schema-chat-client` -- expected: allowlist admits remove_view; `removeView` transform/mutator remove only the target; RecordsView Admin/Member gating + Undo.
- `npm run type-check` -- expected: clean.
- `npm run lint` -- expected: clean.

**Manual checks:**
- As an Admin on `/session-1f4fa453` against the dev app (`localhost:3000`, live Gemini): create a view, then (1) in chat "remove the <view> view" removes it with reassuring copy and the tab disappears; (2) the just-added-view chat bubble's Undo removes it; (3) the view tab's overflow menu "Remove view" removes it with an inline Undo that restores it unchanged; (4) a remove request naming no real view asks a clarifying question; no raw JSON/SQL/stack anywhere; the control is absent for a Member.

**Manual review (Playwright, post-commit) — verified (with one item unit-covered).** On the authed Admin fixture `/session-1f4fa453` against the running dev app on `localhost:3000` with a live Gemini key (two views present: "Unpaid Invoices", "Paid Invoices"):
- **Tab-control remove + Undo (the rich path):** the "Unpaid Invoices" view tab's overflow menu "Remove view" removed it optimistically (tab gone) with an inline banner "Removed the Unpaid Invoices view." + an Undo button. Clicking **Undo** restored it via `POST /api/schema/views` (restore), the tab reappeared, and the neutral confirmation "The Unpaid Invoices view is back." (`viewRestored`) showed.
- **Chat `remove_view`:** "remove the Paid Invoices view" returned `viewRemoved` ("Done. I removed the Paid Invoices view. Your table and all its records are untouched.") with the patched muted **FilterX** glyph (a removal-appropriate icon, not the add-table glyph) and no Undo (correct for a chat removal).
- **Clarify path:** "remove the Overdue Payments view" (no such view) returned a clarifying question naming the real candidate ("I couldn't find a view named Overdue Payments. Did you mean the Unpaid Invoices view?") and removed nothing — confirming the prompt's new existing-views list reaches the model.
- **Guardrails / no raw leak:** invalid editor requests surfaced only the safe "That change isn't allowed." with NO raw JSON/SQL/schema/stack (reasons such as an existing-field collision or a model-emitted invalid filter are logged server-side only). No app console errors.
- **Not exercised live — chat add-view Undo:** the live Gemini model in this session repeatedly produced invalid `add_view` specs (missing filter value / inexact field key — legitimate `validateAddView` rejections, confirmed pre-existing by reproducing on the parent commit's prompt), so a clean chat-created view could not be made to then Undo. This affordance is covered at the unit level (the edit route stamps `undo:"remove"` + `viewKey` on an applied `add_view`; `postRemoveView` and the ChatPanel gating are tested) and by code review. Fixture side effect: the "Paid Invoices" view remains removed (non-destructive; regenerable).
