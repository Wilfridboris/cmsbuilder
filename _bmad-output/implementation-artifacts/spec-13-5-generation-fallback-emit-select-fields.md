---
title: 'Generation & Fallback Emit Select Fields'
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '7b45a7124091eba1970902522f5423740c57805b'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Stories 13.1–13.4 built the `select` field type end to end (data model, validator, render/edit, chat creation and value management), but the two surfaces that *originate* a schema still cannot produce one: AI schema generation (Story 1.4) never offers `select` to the model, and the hard-fallback template (Story 1.5) uses a plain `text` "Status" field. So a brand-new app only gets dropdowns if the owner later asks for them in chat.

**Approach:** Teach the generation response schema and prompt to emit `select` where a fixed-choice/status-like field fits (model supplies `options`, validated by the existing 13.1 path), and convert the fallback template's two "Status" fields to `select` with a small fixed option set. Both are additive: the frozen type model, `validateGeneratedSchema`'s already-present `select` branch, and seed provisioning are reused unchanged.

## Boundaries & Constraints

**Always:**
- Generation emits a `select` field ONLY as an additional allowed field type in `GENERATION_RESPONSE_SCHEMA`, composed as `[...GENERATION_FIELD_TYPES_WITH_RELATION, "select"]`. The base constants `GENERATION_FIELD_TYPES` and `GENERATION_FIELD_TYPES_WITH_RELATION` stay unchanged (they must keep excluding `select` — pinned by `schema-validator.test.ts` and `gemini-generation.test.ts`).
- A generated `select` field carries an `options` array (each `{label, value}`) plus the `reason` already required of every field. The prompt instructs the model to use `select` only for a fixed set of choices it can infer (a status, stage, or category), to never invent choices, and to never use `select` as a `displayField`. Every generated `select` is validated by the UNCHANGED `validateGeneratedSchema` → `validateSelectOptions` path; an invalid one sinks the whole generation to retry/fallback exactly as any other invalid field does today.
- Seed values for a `select` field are the option `value` tokens (not labels). In the fallback template this is guaranteed by construction; in generation the prompt instructs it. The fallback `clients.status` and `jobs.status` become `type: "select"` with options derived from their existing seed strings, and `FALLBACK_SEED_ROWS` status values are rewritten to the matching normalized `value` tokens so `formatCell` (13.2) resolves each to its label.
- The fallback template must still pass the exact safety gate it passes today (`validateGeneratedSchema` accepts it unchanged; `filterSeedRows` keeps all 5–8 rows per table).
- Identity-masking system prompt stays on 100% of generation LLM calls (reused unchanged).

**Never:**
- No change to the frozen type model (`src/types/db.ts`), to `validateSelectOptions`, or to `validateGeneratedSchema`'s `select` acceptance branch (all 13.1). No new validator rule, no new schema operation.
- No `select` in the conversational add-table path (`validateAddTable` / `add_table` fields stay scalar — that is Story 5.2 territory, out of scope).
- No archived options, no colored pills/styling, no multi-select, no new i18n copy (generation labels come from the model; fallback labels are hardcoded English by design).
- No DDL, no row migration, no change to existing orgs' stored schemas — only new generations and new fallbacks are affected.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Generation proposes a status picklist | owner describes work with an implied fixed status set | one field `type:"select"` with `options[]` + `reason`; validated and persisted; seed rows store the option `value` tokens | N/A |
| Generated select fails validation | model emits `select` with empty/duplicate/missing options | `validateGeneratedSchema` rejects the whole schema → existing retry, then fallback (unchanged behavior) | retry/fallback, no partial write |
| Generation keeps scalar/relation | no fixed-choice field implied | no `select` emitted; existing scalar/relation generation unchanged | N/A |
| Fallback fires | generation fails twice | `UNIVERSAL_FIELD_SERVICE_TEMPLATE` has `clients.status` & `jobs.status` as `select`; dropdowns render; seed status cells resolve to their labels; passes the safety gate | N/A |
| Fallback seed value | a status seed value | equals one option `value` token so `formatCell` renders its label | N/A |

</frozen-after-approval>

## Code Map

- `src/lib/gemini/prompts.ts` -- **(generation)** `GENERATION_RESPONSE_SCHEMA` (530–607): in the field `type` enum (556–559) change `[...GENERATION_FIELD_TYPES_WITH_RELATION]` to `[...GENERATION_FIELD_TYPES_WITH_RELATION, "select"]`, and add an `options` ARRAY property mirroring the editor schema's shape (`EDITOR_RESPONSE_SCHEMA` options, 411–432: items OBJECT with `label`+`value` STRING, `required`/`propertyOrdering` `["label","value"]`) with a "present only when type is 'select'" description; add `"options"` to the field `propertyOrdering` (581–588). `buildGenerationPrompt` (88–110): add one requirement bullet — use `type:"select"` with an `options` list (each a `label` and a short `value` token) for a field that is a fixed set of choices the owner implies (status/stage/category); never invent choices; a `select` field cannot be a `displayField`; in seed rows a `select` field's value is one of its option `value` tokens. Do NOT edit `GENERATION_FIELD_TYPES`/`GENERATION_FIELD_TYPES_WITH_RELATION` (44–63).
- `src/lib/generation/fallback.ts` -- **(fallback)** `UNIVERSAL_FIELD_SERVICE_TEMPLATE` (36–166): `clients.status` (72–76) → `type:"select"`, `options:[{value:"active",label:"Active"},{value:"prospective",label:"Prospective"},{value:"past",label:"Past"}]`, keep its `reason`; `jobs.status` (112–116) → `type:"select"`, `options:[{value:"scheduled",label:"Scheduled"},{value:"in_progress",label:"In progress"},{value:"quoted",label:"Quoted"},{value:"complete",label:"Complete"}]`, keep its `reason`. `FALLBACK_SEED_ROWS` (181–209): rewrite `clients[].status` `"Active"/"Prospective"/"Past"` → `"active"/"prospective"/"past"`; `jobs[].status` `"Scheduled"/"In progress"/"Quoted"/"Complete"` → `"scheduled"/"in_progress"/"quoted"/"complete"`.
- `tests/unit/fallback.test.ts` -- add `"select"` to the `ALLOWED_TYPES` set (34–45); add an assertion that `clients.status` and `jobs.status` are `type:"select"` with a non-empty `options[]` and that every status seed value equals one of that field's option `value` tokens. The existing safety-gate test (112–139) must still pass unchanged.
- `tests/unit/gemini-generation.test.ts` -- extend the response-schema test (163–179): assert `JSON.stringify(GENERATION_RESPONSE_SCHEMA)` now contains `"select"` and an `options` array shape, and that `buildGenerationPrompt(...)` mentions choices/options for a status-like field. Keep the existing relation/displayField/currency assertions.
- `tests/unit/schema-validator.test.ts` -- the generation-path select tests already exist (`validateGeneratedSchema` accepts a select field, 796–897). Update only the stale rationale comment at 1084 ("model can't emit it until 13.5"); the two assertions (1088–1089: `SCALAR_FIELD_TYPES`/`GENERATION_FIELD_TYPES` exclude `select`) stay and must still pass.
- Reuse UNCHANGED: `validateGeneratedSchema` + `validateSelectOptions` (`src/lib/schema/validator.ts`, 324–367 / 375–637, already accept `select`), `normalizeTableName` (`src/lib/utils.ts`), `SelectOption`/`FieldDefinition` (`src/types/db.ts`), `provisionGeneration`/`filterSeedRows` (seed values stored as-is), `formatCell` select branch (13.2), `callGeminiWithTimeout`/generate route.
- Do NOT touch: `src/types/db.ts`, `validateSelectOptions` body, `validateAddTable` (`add_table` scalar-only), the editor `add_select_option`/rename/archive path (13.4).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/gemini/prompts.ts` -- add `"select"` to the generation response-schema field-type enum, add the `options` array property (+ `propertyOrdering`), and add the prompt requirement bullet for select/options/seed-token usage -- lets the model emit a validated `select` field during generation.
- [x] `src/lib/generation/fallback.ts` -- convert `clients.status` and `jobs.status` to `select` with fixed options, and rewrite their seed values to the matching `value` tokens -- the fallback app ships a real dropdown Status.
- [x] `tests/unit/gemini-generation.test.ts` -- assert the response schema offers `select` + `options` and the prompt guides status-like picklists -- pins the generation contract.
- [x] `tests/unit/fallback.test.ts` -- allow `select` in `ALLOWED_TYPES` and assert the two Status fields are select with seed values matching their option `value` tokens -- pins the fallback template + seed consistency, keeps the safety-gate test green.
- [x] `tests/unit/schema-validator.test.ts` -- refresh the stale 13.5 comment; confirm the existing generation-path select accept test and the base-constant exclusion assertions still pass -- guards the frozen boundary.

**Acceptance Criteria:**
- Given generation runs for an owner whose description implies a fixed status/category set, when the model emits a `select` field with `options`, then it passes the unchanged `validateGeneratedSchema` and is persisted with its options and a reason, and its seed rows store option `value` tokens; when no fixed-choice field is implied, generation output is unchanged (scalar/relation only).
- Given generation fails twice and the hard fallback fires, when the Universal Field Service template provisions, then `clients.status` and `jobs.status` render as dropdowns, every seeded status cell resolves to its option label, and the template still passes `validateGeneratedSchema`/`filterSeedRows` unchanged.
- Given the frozen boundary, when the suite runs, then `GENERATION_FIELD_TYPES` and `SCALAR_FIELD_TYPES` still exclude `select`, and no change is made to the type model, `validateSelectOptions`, or the add-table path.

## Implementation Notes

**Post-merge manual review (Playwright, localhost:3000).** Ran a live generation with a status-implying description ("track jobs and whether each is quoted, scheduled, in progress, or complete"). Generation emitted a well-formed `select` Status field (`isFallback:false`) with options Quoted/Scheduled/In Progress/Complete and value-token seeds — the generation surface works end to end.

The review surfaced one defect this story was the first to expose: the pre-account demo dashboard (`DemoDashboard.renderCell`, the "aha moment" preview) rendered a select cell's raw token (`in_progress`) instead of its label. Root cause: `renderCell` called `<CellText>` without forwarding `field.options`, so the shared `formatCell` could not resolve the label. Latent before 13.5 because neither generation nor the fallback ever produced a `select` on that surface. Fix: forward `field.options` to `CellText` in `src/components/dashboard/DemoDashboard.tsx` (one prop; `CellText` already supported it) and export `renderCell` for a focused unit test (`tests/unit/demo-dashboard-cell.test.tsx`: label resolution, unmatched-token fallback, scalar unchanged). Re-verified in-browser: Status now renders Complete / In Progress / Quoted / Scheduled. The authed dashboard (`RecordsView`) already forwarded options (13.2) and was unaffected.

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

Edge-case-hunter: 0 findings (every behavioral branch traced into the unchanged 13.1 validator path; all claims held). Verification-gap: no gap — the one risky behavioral change (fallback `status` → `select` with `value`-token seeds) is pinned by the new `fallback.test.ts` test and matches the `formatCell` (13.2) `opt.value === value` contract, with the real `validateGeneratedSchema`/`filterSeedRows` run in-suite. Blind-hunter: 6 findings, all false or low → reject.

- **`options` added to the field `required` array, forcing every field (text/relation/scalar) to emit `options`** (blind-hunter; echoed by verification-gap's "other findings") — **false**. Verified at `prompts.ts:595`: `required` is `["key","label","type","reason"]`; `"options"` appears only in `propertyOrdering` (line 602), an ordering hint that never forces emission — identical to the equally-conditional `sensitive`/`relationConfig` already in that list. Two reviewers misread `propertyOrdering` as `required`; edge-case-hunter independently confirmed `options` is not required.
- **Generation test never asserts the field-level `required`/`propertyOrdering` lists `options`; a regression could pass silently** (blind-hunter) — **false → reject**. The stated harm ("breaks every non-select field") presupposes `options` is required, which it is not; dropping it from `propertyOrdering` is a cosmetic ordering change with no functional effect, so there is no regression to guard.
- **No generation-path test for duplicate-value or select-as-`displayField` rejection** (blind-hunter) — **low → reject**. Both invariants live in the UNCHANGED `validateGeneratedSchema`/`validateSelectOptions` path and are already covered by Story 13.1's validator tests (generation-path select accept + empty/duplicate/missing rejections, `schema-validator.test.ts`); re-testing them on the generation surface duplicates existing coverage of unchanged code.
- **Fallback test does not assert every declared option is exercised by a seed row** (blind-hunter) — **low → reject**. Not exercising an option in seed data is not a defect (no named harm); the demo value is served by the options existing and rendering. The assertion would pin incidental seed composition and add churn.
- **Prompt `seedRows` return-format paragraph not reinforced for select tokens** (blind-hunter) — **low → reject**. The select-seed-token rule is already stated in the FIXED SET OF CHOICES bullet; this is speculative LLM-output tuning with no groundable defect (verification skips LLM-output behavior).
- **No generation-path test that a label-instead-of-token select seed cell degrades gracefully** (blind-hunter) — **low → reject**. `filterSeedRows` stores values as-is and `formatCell` (13.2) renders an unmatched token as raw text — pre-existing, already-tested degradation not caused by this story.

## Design Notes

The whole epic's spine (type model + `validateGeneratedSchema`'s `select` branch + seed provisioning) was already landed in 13.1/13.2, so this story only opens the two origination surfaces to it. Generation mirrors the editor's proven pattern exactly: 13.3 already added `[...GENERATION_FIELD_TYPES, "select"]` + an `options` array to `EDITOR_RESPONSE_SCHEMA`; the generation schema gets the same two edits composed onto the with-relation set, so there is nothing novel to validate.

Fallback seed values must be the normalized `value` tokens, not the display labels, because `formatCell` (13.2) resolves a stored token to its option label; a stray `"Active"` would not match option `value:"active"`. Converting both Status fields (not just one) keeps the demo app internally consistent and is within the epic's "includes a generic select Status field" latitude.

Example generated select field:
`{ "key":"status", "label":"Status", "type":"select", "reason":"Where the job stands.", "options":[{"label":"Scheduled","value":"scheduled"},{"label":"Done","value":"done"}] }`

## Verification

**Commands:**
- `npm run test -- tests/unit/gemini-generation.test.ts tests/unit/fallback.test.ts tests/unit/schema-validator.test.ts` -- expected: new select generation/fallback assertions pass; existing relation, safety-gate, and base-constant-exclusion cases still green.
- `npm run type-check` -- expected: clean across the response-schema `options` addition and the fallback template edits.
- `npm run lint` -- expected: clean.

**Manual checks:**
- On localhost:3000 (Playwright MCP): force the hard fallback (generation double-failure) and confirm the provisioned Clients/Jobs tables show a Status dropdown whose seeded rows display their labels (Active, Scheduled, ...). Separately, run a real generation whose description implies a status (e.g. "track jobs and whether each is quoted, scheduled, or done") and confirm a `select` Status field is generated with those options and renders as a dropdown.
