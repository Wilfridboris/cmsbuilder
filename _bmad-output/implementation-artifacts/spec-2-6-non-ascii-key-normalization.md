---
title: 'Story 2.6: Key Normalization — Preserve Accented / Non-ASCII Names (French Path)'
type: 'bug-fix'
created: '2026-09-24'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '35509373cf08aaea6ed9b4839f2f165d75840c06'
story_key: '2-6-non-ascii-key-normalization'
origin: 'Epic 1 retrospective 2026-09-24 — finding F8 (action item 4)'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-retro-2026-09-24.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4-ai-schema-synthetic-data-generation.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `normalizeTableName` (`src/lib/utils.ts:17-24`) lowercases the input, then `.replace(/[^a-z0-9]+/g, "_")` — collapsing every non-ASCII run to `_`. So accented keys the French-generation path produces get mangled or emptied: `"numéro"` → `num_ro`, `"coût"` → `co_t`, and a key written purely in a non-Latin script normalizes to the empty string. In the validator (`validator.ts:138,186`) an empty normalized key rejects the whole schema (`"table/field key normalized to empty"`), and two distinct accented names can collapse to the same key and trip the duplicate-key rejection — either way the real generation is thrown out and the visitor lands on the universal fallback. This directly undercuts a headline Epic 1 promise: a French prompt generates French table/field names (epic-1-context.md "Requirements & Constraints"; FR35). Surfaced as retrospective finding **F8**.

**Approach:** Fold diacritics to their ASCII base *before* stripping, so Latin-accented names survive as readable keys: Unicode-decompose (`NFD`), drop combining marks, then apply the existing lowercase + `[^a-z0-9]+ → _` collapse. `"numéro"` → `numero`, `"coût"` → `cout`, `"région"` → `region`. For keys with no Latin fold (Cyrillic, Arabic, CJK) that would still normalize to empty, fall back to a deterministic synthetic key (e.g. `table`/`field` + an index/short hash of the original) so the schema never rejects on an un-fold­able key — the human-readable original is preserved in the untouched `label`. Keys stay `[a-z0-9_]`, stable, and collision-free.

## Boundaries & Constraints

**Always:**
- Accented Latin names (French especially) MUST normalize to readable ASCII keys (`numéro→numero`, `coût→cout`, `réf. client→ref_client`) and MUST NOT reject or collapse into false duplicate collisions.
- A key that has no Latin fold and would otherwise normalize to empty MUST yield a deterministic, unique, `[a-z0-9_]` synthetic key rather than rejecting the schema.
- Output remains `[a-z0-9_]`, lowercased, no leading/trailing `_`; ASCII inputs normalize **identically to today** (the demo template, fallback template, and existing tests must be unaffected).
- Keep the function pure and dependency-free (use built-in `String.prototype.normalize`); it is consumed by the validator, provisioner, and mutation layer, so behavior must stay deterministic.

**Never:**
- No change to ASCII-input behavior (regression-guard the existing keys); no new runtime dependency; no change to the label text (the accented original stays in `label` for display).
- No change to the generation prompt, response schema, fallback template, or route control flow; the fix is confined to normalization + its tests.
- The synthetic-key fallback must be deterministic (no `Math.random`/timestamp) so the same input always yields the same key.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected key | Notes |
|----------|-------|-------------|-------|
| French accented field | `"numéro"` | `numero` | fold, not `num_ro` |
| French accented field | `"coût"` | `cout` | |
| French accented label | `"Réf. client"` | `ref_client` | fold + punctuation collapse |
| Two accented siblings | `"région"`, `"regionalisation"` | `region`, `regionalisation` | distinct keys, no false duplicate |
| ASCII (unchanged) | `"Client Name"` | `client_name` | identical to today — regression guard |
| Non-Latin only | `"顧客"` / `"العميل"` | deterministic synthetic (e.g. `field_<hash>`) | never empty, never reject |
| Mixed | `"Coût 2024 (CAD)"` | `cout_2024_cad` | |

</frozen-after-approval>

## Code Map

- `src/lib/utils.ts` -- MODIFY `normalizeTableName`. Insert a diacritic-fold step before the strip: `.normalize("NFD").replace(/[̀-ͯ]/g, "")`, then the existing `.toLowerCase().replace(/['"]/g,"").replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"")`. If the result is empty, return a deterministic synthetic key derived from the original (documented; e.g. a short stable hash) — decide the exact shape in implementation, keep it `[a-z0-9_]`. Note the emptiness-fallback contract so validator callers (`validator.ts:138,186`) know an empty result no longer reaches them (or keep the validator's empty-check as defense-in-depth).
- `tests/unit/` -- ADD a `normalize.test.ts` (or extend an existing util test) covering every matrix row, including the ASCII-unchanged regression guard and the non-Latin synthetic-key determinism.
- NOT TOUCHED: `src/lib/schema/validator.ts` logic (only its *inputs* improve), `provision.ts`, `mutate.ts`, `records.ts`, the generation prompt/response schema.

## Tasks & Acceptance

**Execution:**
- [ ] `src/lib/utils.ts` -- add NFD diacritic-fold before the strip; add a deterministic synthetic-key fallback for otherwise-empty results -- preserves accented/French keys, removes the empty-key rejection cliff.
- [ ] `tests/unit/normalize.test.ts` -- cover the matrix incl. ASCII-unchanged regression + non-Latin determinism -- locks the fix.

**Acceptance Criteria:**
- Given an accented French field/table name (`"numéro"`, `"coût"`, `"Réf. client"`), when normalized, then it yields a readable ASCII key (`numero`, `cout`, `ref_client`) and the schema validates as a real generation.
- Given two distinct accented names, when normalized, then they yield distinct keys (no false duplicate-key rejection).
- Given an ASCII input, when normalized, then the key is byte-identical to the pre-change output (no regression to demo/fallback keys or existing tests).
- Given a purely non-Latin key, when normalized, then it yields a deterministic non-empty `[a-z0-9_]` key and the schema does not reject on emptiness.
- Given `npm run test`, `type-check`, `lint`, `build`, then all pass.

## Implementation Notes

_Pending — not yet implemented. Carried from Epic 1 retrospective (F8 / action item 4)._

## Spec Change Log

## Review Triage Log

## Design Notes

- French/Ontario is the epic's actual localization scope, so diacritic folding is the high-value core; the non-Latin synthetic-key fallback is a safety net against the empty→reject cliff, not a full internationalization of keys (the readable original always survives in `label`).
- Because all Epic 1 generation is pre-account throwaway demo data (regenerated on reload, cleared at claim), changing key derivation for *new* generations carries no migration risk. ASCII stability keeps the committed demo/fallback fixtures and their tests green.

## Verification

**Commands:**
- `npm run test` -- expected: new normalize cases pass; existing suite stays green (ASCII regression guard).
- `npm run type-check` / `npm run lint` / `npm run build` -- expected: all pass.

**Manual checks:**
- Submit a French prompt that yields accented column names; confirm a real (non-fallback) dashboard renders with readable French labels and no `isFallback` banner.
