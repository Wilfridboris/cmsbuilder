---
title: 'Story 5.5: Safe Handling of Unsupported Operations'
type: 'feature'
created: '2026-10-02'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '9fc25745ca362ea5cbcf2301c1f04b0de01f0c9f'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When an Admin asks the conversational editor to do something it cannot safely do (delete a column, delete a table, rename), the request lands as `out_of_scope` today and the user gets a generic "I can only add things" decline. The epic's safety promise (FR17) is stronger: a "delete column" request must be satisfied *non-destructively* by hiding the column via the existing append-only visibility flag (the Story 1.7 / 3.5 mechanism), field definition and data left intact, and the user must get a specific reassuring message. The editor cannot currently express "hide column X on table Y", so it never performs the safe fallback.

**Approach:** Introduce one new editor operation, `hide_field`, that the model returns when the request asks to delete/remove a specific, identifiable column. The route reuses the already-guarded `setFieldVisibility(identity, tableKey, fieldKey, true)` mutator (Story 3.5) — no new data-layer code, no migration. `hide_field` joins the Story 5.4 allowlist fence so the uniform allowlist + raw-SQL discard still covers it, and a hallucinated/missing key is structurally inert (the mutator 400s on an unknown table/field, mapped to a graceful decline). An applied hide is reversible from the chat via a show-again Undo. Every other unsupported request (delete a table, rename, link tables, change/view data, off-topic) stays `out_of_scope` → `declined` with reassuring, non-technical copy and no mutation. All user-facing text is server-side `ChatAssistant` i18n (en + fr), no em-dash, and no raw JSON/SQL/schema/stack is ever shown.

## Boundaries & Constraints

(Epic-5 invariants in `epic-5-context.md` apply; below is specific to or sharpened for this story.)

**Always:**
- A delete/remove-column request for a currently-visible, exactly-identifiable column on a named or unambiguously-current table resolves to `hide_field` and is satisfied by `setFieldVisibility(identity, tableKey, fieldKey, true)` — metadata-only, append-only, reversible; the underlying field definition and all row data stay intact.
- `hide_field` is added to `PERMITTED_OPERATIONS` so it passes through the same Story 5.4 fence (`assertEditorOperationAllowed` = allowlist + raw-SQL discard) as the three add ops; its branch then validates `tableKey` + `fieldKey` are non-empty strings before calling the mutator. A genuinely unknown / out-of-allowlist kind is still rejected + logged exactly as before.
- The applied-hide response carries `tableKey` + `fieldKey` and an undo direction so the chat shows a "show again" Undo that calls `setFieldVisibility(..., false)` (the inverse of the add-column Undo). After apply or undo, `router.refresh()` updates the table/card/add-record views (existing mechanism).
- When the mutator rejects a missing table/field (`AppError(400)`), the route returns a graceful, reassuring `declined` message — never an error screen, never a raw detail.
- A delete/remove request that names a COLUMN but no resolvable table (or several plausible tables) reuses the existing `needs_clarification` → `clarify` flow rather than guessing.
- Delete-a-table, rename, link/relationship, change-or-view-data, and off-topic requests remain `out_of_scope` → `declined` and perform NO mutation. Table and view hide are explicitly OUT of this story (deferred).
- New user-facing copy lives only in `ChatAssistant` (en.json + fr.json), is reassuring and non-technical, contains no em-dash, and never mentions JSON, SQL, schemas, or errors.

**Never:**
- No destructive migration, DDL, SQL generation, column/table drop, or data mutation — hiding is the only state change, and only for a column.
- No new table-visibility or view-visibility mutator/route in this story (deferred to a follow-up).
- Never change Story 5.4's verb/raw-SQL guards, the conversational flows for genuinely out-of-scope requests, auth/role gating (Admin-only, 403 for Members), or the graceful LLM-failure `degraded` path.
- Never expose a relation column or an already-hidden column as a hide target (only visible scalar fields are in the model's context); do not build a fuzzy field resolver — the model returns an exact `fieldKey`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Delete a named column | "delete the Notes column from Jobs" | `hide_field` → `setFieldVisibility(Jobs, notes, true)`; `applied` + reassuring `columnHidden` copy naming the column; show-again Undo offered; column vanishes on refresh; data intact | N/A |
| Delete column, current table | On Jobs, "remove the notes column" | Infers Jobs from current table; hides as above | N/A |
| Delete column, ambiguous table | "remove the notes column" (no current table, 2+ candidates) | `needs_clarification` → `clarify` naming candidate tables; nothing written | N/A |
| Undo a hide | Show-again on a just-hidden column | `setFieldVisibility(..., false)`; column returns on refresh; `restored` copy | N/A |
| Column not found / stale | `hide_field` with a tableKey/fieldKey not in schema | Mutator `AppError(400)`; route returns `declined` reassuring copy; nothing written | Graceful decline, no raw detail |
| Delete a table | "delete the Jobs table" | `out_of_scope` → `declined`; no mutation | N/A |
| Rename | "rename Notes to Comments" | `out_of_scope` → `declined`; no mutation | N/A |
| Off-topic / data change | "delete all my clients", "what's the weather" | `out_of_scope` → `declined`; no mutation | N/A |
| Raw SQL in output | `hide_field` output stringifies to contain `;`/`--`/a SQL verb | Caught by the existing raw-SQL discard in the fence; `rejected` + logged | Rejection is total |

</frozen-after-approval>

## Code Map

- `src/lib/schema/validator.ts` — `PERMITTED_OPERATIONS` (L61-65) + `isPermittedOperation` (L70-75) + the L51-60 rationale comment, and `assertEditorOperationAllowed` (the allowlist + raw-SQL fence). **Change:** add `"hide_field"` to `PERMITTED_OPERATIONS`; update the comment from "three ops" to the permitted set. Leave `BLOCKED_KEYWORDS` / `keyIsBlockedVerb` / `containsRawSql` / reserved-key logic untouched (Story 2.5 + 5.4).
- `src/lib/gemini/prompts.ts` — `buildEditorPrompt` (L204-250): intro L204 ("You CANNOT delete…"), rule 5 `out_of_scope` L246-248. `EDITOR_RESPONSE_SCHEMA` `kind` enum L264-272, properties L274-371, `propertyOrdering` L374+. **Change:** add rule 6 `hide_field` (delete/remove a specific COLUMN on an identifiable table → `{kind, tableKey, fieldKey}` with EXACT keys from the list); narrow rule 5 so column-delete routes to `hide_field` while table-delete / rename / links / data stay `out_of_scope`; add `"hide_field"` to the enum, add a `fieldKey` string property, extend `propertyOrdering`. No em-dash.
- `src/app/api/schema/edit/route.ts` — `GeminiEditorOutput` (L91-107), `EditorChatResult` (L76-88), the 8b fence (L207-225), per-kind branches (L227-432), `out_of_scope` → `declined` (L434-442), `handleMutateError`. **Change:** add `kind: "hide_field"` + `fieldKey` to `GeminiEditorOutput`; after the 8b fence add a `hide_field` branch that validates `tableKey`/`fieldKey` strings, calls `setFieldVisibility(identity, …, true)`, resolves the field + table labels from the `tables` summary for the message, returns `applied` (with `tableKey`, `fieldKey`, undo direction) + `t("columnHidden", …)`; map the mutator's `AppError(400)` to a reassuring `declined`. Add an undo-direction field to `EditorChatResult`. Update the L324-326 / L412-414 forward-ref comments to state table/view hide is deferred.
- `src/lib/data/schema-mutate.ts` — `setFieldVisibility` (L62-110). **Reuse as-is** (returns `{tableKey, fieldKey, hidden}`, 400s on missing table/field, RLS-scoped, append-only). Pure transforms `hideField` / `showField` in `src/lib/schema/overrides.ts` (L107-153) — reuse.
- `src/lib/i18n/en.json` + `fr.json` — `ChatAssistant` block (en L478-497). **Add:** `columnHidden` (reassuring, names the column) and `restored` (show-again confirmation); both no em-dash. Reuse `declineFallback`, `clarifyFallback`, `rejection`, `undo` verbatim.
- `src/components/chat/ChatPanel.tsx` (kind→bubble map L232-247, Undo gating L250-267), `MessageBubble.tsx` (variants L34-88), `src/lib/data/schema-chat-client.ts` (`postUndoHideColumn` L76-102). **Change:** render the hide confirmation and show a show-again Undo driven by the applied response's undo direction; generalize the undo helper to call `setFieldVisibility(false)` for a hide. Do this UI/UX work with the `/web-uiux-architect` skill.
- Tests: `tests/unit/route-schema-edit.test.ts`, `tests/unit/schema-validator.test.ts`, `tests/unit/schema-mutate*.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/schema/validator.ts` -- add `"hide_field"` to `PERMITTED_OPERATIONS` and refresh the rationale comment; confirm `assertEditorOperationAllowed` admits `hide_field` through the same allowlist + raw-SQL fence.
- [x] `src/lib/gemini/prompts.ts` -- add the `hide_field` classification rule, narrow `out_of_scope` to exclude column-delete, and add `"hide_field"` + a `fieldKey` property to `EDITOR_RESPONSE_SCHEMA` (+ `propertyOrdering`). No em-dash.
- [x] `src/app/api/schema/edit/route.ts` -- add the `hide_field` branch calling `setFieldVisibility(..., true)` with graceful 400→`declined` handling; extend `GeminiEditorOutput` and `EditorChatResult` (undo direction); update the L324-326 / L412-414 forward-ref comments to note table/view hide is deferred.
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add `columnHidden` and `restored`; reassuring, non-technical, no em-dash.
- [x] `src/components/chat/*` + `src/lib/data/schema-chat-client.ts` -- render the hide confirmation and a show-again Undo (generalized visibility helper). Use the `/web-uiux-architect` skill for this UI/UX.
- [x] `tests/unit/route-schema-edit.test.ts` + `tests/unit/schema-validator.test.ts` -- cover: `hide_field` → `setFieldVisibility(true)` called, `applied`, no destructive write; show-again → `setFieldVisibility(false)`; missing field → `declined`, no write; `hide_field` passes the allowlist fence; delete-table / rename → `out_of_scope` → `declined`; raw-SQL in a `hide_field` output → `rejected`; Member → 403.

**Acceptance Criteria:**
- Given an Admin requests an unsupported operation (delete column, delete table, or rename), when it is processed, then no destructive migration runs and the assistant replies with a safe, non-technical message. (FR17)
- Given a "delete/hide column" request for an identifiable column, when handled, then the column is hidden via the append-only visibility flag (the Story 1.7 / 3.5 mechanism), the field definition and row data remain intact, and the column disappears from the dashboard on refresh. (FR17)
- Given a just-hidden column, when the Admin uses the show-again Undo, then the column becomes visible again with no data change.
- Given any unsupported request, when handled, then no raw JSON, SQL, schema object, or error stack is ever shown to the user.
- Given a `hide_field` output whose table/field does not exist, when processed, then the user sees a reassuring decline and nothing is written.

## Implementation Notes

- `hide_field` rides the Story 5.4 fence (added to `PERMITTED_OPERATIONS`), so `assertEditorOperationAllowed` covers it with the same allowlist + raw-SQL discard and zero new guard code. The route's `hide_field` branch then validates non-empty `tableKey`/`fieldKey` (shapeless → `rejected`), calls `setFieldVisibility(identity, …, true)`, and maps the mutator's `AppError(400)` (missing table/field) to a reassuring `declined` and a 5xx to `degraded` — no raw detail ever reaches the user.
- `EditorChatResult` gained an `undo: "hide" | "show"` direction. Add-field applied sets `undo: "hide"` (Undo hides the just-added column); hide-field applied sets `undo: "show"` (Undo shows it again). The client helper `postUndoHideColumn` was generalized to `postSetColumnVisibility(…, hidden)` so one path drives both directions via the existing `POST /api/schema/columns` (Story 3.5).
- UI (built with `/web-uiux-architect`): new `MessageBubble` `hidden` variant with an amber `EyeOff` glyph (distinct from the emerald "created" states), carrying the inline show-again Undo; `ChatPanel` renders `columnHidden` and swaps `undone`/`restored` copy by direction.
- `restored` copy is intentionally label-free (the client Undo payload carries only keys, not labels); the server-side `columnHidden` message does name the column and table.
- Verification (pre-review): `npx vitest run route-schema-edit schema-validator schema-chat-client` → 88/88 pass; full `npm run test` → 1178 pass (105 files); `type-check` clean; `lint` clean (only the pre-existing eslintrc deprecation warning). Manual Playwright review pending post-commit per repo convention.
- Review pass 1 patches (applied directly — the implementation subagent was not re-engageable in this runtime): (1) the `hide_field` branch now resolves `targetTable`/`targetField` from the visible-scalar `tables` summary BEFORE the write and returns a reassuring `declined` (no mutator call) when the target is not in it — enforcing the frozen relation/already-hidden invariant route-side and guaranteeing label resolution; (2) route tests now assert the `undo` contract (add_field → `"hide"`, add_table/add_view → undefined); (3) added tests for a relation/already-hidden target → declined, the in-summary mutator-400 race → declined, and the mutator 5xx → degraded with no raw-detail leak. Post-patch verification: `route-schema-edit` 27/27; full `npm run test` → 1181 pass (105 files); `type-check` clean; `lint` clean. The I/O matrix "Column not found / stale" row is covered by both the pre-guard (not-in-summary) and the catch (in-summary race).

## Spec Change Log

## Review Triage Log

Pass 1 (review_loop_iteration 0) — blind-hunter (9), edge-case-hunter (1 gap, 2 lenses), verification-gap (1 gap + 1 other):

- [edge/blind] **hide_field target not validated against the visible-scalar summary** (`route.ts` hide_field branch) — `low → patch`. The branch checks only non-empty `tableKey`/`fieldKey`, then calls `setFieldVisibility`, which looks up the FULL schema (all fields incl. relation/already-hidden). So a `fieldKey` outside the summary the model was shown (relation, already-hidden, or hallucinated) is hidden anyway, and the post-write label lookup misses → the user message falls back to a raw key. Real but low-harm/low-probability (non-destructive, reversible); patched because it enforces the frozen "Never expose a relation/already-hidden column as a hide target" invariant route-side (matching Story 5.4's distrust-the-model posture) and the fix is a direct reorder (resolve label from `tables` before the write; out-of-summary → reassuring `declined`), not added complexity.
- [vgap] **add_field applied `undo:"hide"` is untested** — `low → patch`. The client gates the add-column Undo on `result.undo`; removing the `undo:"hide"` line would silently drop the Undo and no test fails. Add `expect(body.data.undo).toBe("hide")` to the existing add_field applied test.
- [blind] **No regression test that add-table / add-view applied carry no `undo`** — `low → patch`. The no-Undo signal moved from "absent fieldKey" to "absent undo"; a stray `undo` would resurrect an Undo on a table/view bubble. Cheap assertion locks the contract.
- [vgap-other] **hide_field 5xx → degraded path untested** — `low → patch`. The hide branch has its own catch (distinct from `handleMutateError`); a `setFieldVisibility` `AppError(500)` should map to `degraded` with no raw-detail leak. Bundle a one-line sibling test (mirrors the add_field 5xx test).
- [blind] Real `hideField`/`showField` transforms untested on the hide path — `false`. The mutator is reused UNCHANGED and is covered by existing `tests/unit/schema-mutate.test.ts` + `overrides.test.ts`; the route unit test correctly mocks it. "Data intact / append-only" is pinned by those suites.
- [blind] Code Map / Tasks reference `schema-mutate*.test.ts` but the diff touches none — `false`. Same reason: the mutator is unchanged, so its existing tests still cover it; the reference is a pointer, not a required edit. (A fix here would edit the spec — disallowed.)
- [blind] Ambiguous-table → needs_clarification (and current-table inference) untested for column-delete — `false`. The `needs_clarification → clarify` route path is already tested and is identical regardless of trigger; the new ambiguous→clarify routing lives in the prompt (LLM-steering), which is not unit-testable.
- [blind] `fr`/`en` copy tone + em-dash check — `false`. Verified: no em-dash (or stray `—`) in either `columnHidden`/`restored` addition. Tone alignment is cosmetic with no named harm.
- [blind] `columnHidden` is three sentences and may wrap awkwardly — `low`, reject. `whitespace-pre-wrap` handles wrapping; the multi-sentence reassurance is a deliberate product choice; no named harm and no direct-correction fix.
- [blind] Amber `EyeOff` glyph is color-only / AA contrast unverified — `false`. The icon is `aria-hidden` (like the other glyphs) and the message text is self-describing (color is not the sole information carrier, WCAG-acceptable); the informational text uses the normal bubble text color, so icon contrast does not gate it.
- [blind] `EditorChatResult.undo` ⇔ `fieldKey` invariant not enforced by type/test — `low`/`maybe-false`, reject. The client requires `undo` + `tableKey` + `fieldKey` together, so the Undo defaults off safely; only speculative future (deferred) branches could cause a cosmetic `isHide` mismatch, and the fix (discriminated union) adds public surface.
- [blind] `declined` on a missing field reuses `declineFallback` (same copy as rename) — `low`, reject. The frozen spec explicitly accepts `declineFallback` here; intent does not require differentiated copy.

Routing: no intent_gap or bad_spec (the code faithfully implements the frozen spec; the one real finding enforces a frozen invariant the code under-enforced), so no loopback. Four entries route to **patch** (target-summary guard; three test-contract pins). All others rejected/false.

## Design Notes

Reframing "delete column" as `hide_field` keeps the highest-risk surface additive-only: the editor still never deletes anything, it reuses a mutator that is already guarded, already tested, and structurally incapable of touching an unknown field (it 400s). Adding `hide_field` to `PERMITTED_OPERATIONS` (rather than exempting it like the conversational kinds) is deliberate — it keeps ONE uniform allowlist + raw-SQL fence over every operation the model can drive, which is exactly the "clean seam for a future action allowlist" the epic calls for. Table and view hide (and Undo on add-table / add-view) are deferred to a follow-up story to keep this one single-goal.

## Verification

**Commands:**
- `npm run test -- route-schema-edit` -- expected: hide_field applied, show-again, 400→declined, and out_of_scope rows pass.
- `npm run test -- schema-validator` -- expected: hide_field admitted by the allowlist; existing allowlist/blocklist/collision rows still pass.
- `npm run type-check` -- expected: clean.
- `npm run lint` -- expected: clean.

**Manual checks:**
- As an Admin on `/session-1f4fa453` against the dev app (`localhost:3000`, live Gemini): "delete the Notes column from Quotes & Jobs" hides the column (gone from table + add-record form, data intact) with reassuring copy and a working show-again Undo; "delete the Jobs table" and "rename Notes to Comments" return a reassuring decline with no change; no raw JSON/SQL/stack anywhere.
