---
title: 'Story 2.5: Schema Validator — Stop False-Rejecting Legitimate Labels'
type: 'bug-fix'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'f00de61453f526f0e02cdc0b2faa6698e21a3dd0'
story_key: '2-5-schema-validator-keyword-false-reject'
origin: 'Epic 1 retrospective 2026-09-24 — finding F7 (action item 3)'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-retro-2026-09-24.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4-ai-schema-synthetic-data-generation.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The schema safety gate rejects legitimate, common trade labels and silently degrades the user's bespoke generation to the hard fallback template. `containsBlockedKeyword` (`src/lib/schema/validator.ts:77-80`) does a raw case-insensitive **substring** `.includes()` of each `BLOCKED_KEYWORDS` entry (`DROP, GRANT, TRUNCATE, DELETE, EXEC, --, ;, /*`) against the **human-facing, un-normalized `label`** of every table and field (`:134`, `:170`). So a business label whose text merely *contains* one of those letter-runs — e.g. a `"Deleted?"` status column, a `"Grants"` table (nonprofit), a `"Drop-off time"` field (snow removal / delivery) — trips the check. A single tripped label makes `validateGeneratedSchema` return `valid:false`; the route then retries once (the near-deterministic model reproduces the same schema and fails identically), then provisions the universal fallback. The visitor loses the custom dashboard that is the entire point of the epic — with no error, so it is invisible in telemetry and to the green test suite. Surfaced as retrospective finding **F7**.

**Why the current check is the wrong tool:** the blocked-keyword list defends against SQL injection, but this architecture never builds SQL from these strings. Table/field **keys** are normalized to `[a-z0-9_]` by `normalizeTableName` before persistence, so `;`, `--`, `/*` and punctuation can never survive into a key. **Labels** are stored verbatim as JSONB values in `org_schemas.definition` and rendered as auto-escaped React text — never concatenated into SQL. The keyword check therefore provides no real protection on labels while causing real false rejections.

**Approach:** Relax the keyword gate so it no longer false-rejects legitimate labels, while preserving every protection that is actually load-bearing. Remove the blocked-keyword check from the human `label`. On the normalized `key`, replace substring matching with word-boundary matching (a key like `drop` alone is still refused; `dropoff` / `backdrop` are not). Keep — unchanged — the reserved-column collision check, key normalization, the `relation`/type allowlist, the non-empty-string checks, and Sentry rejection logging. Net effect: real generations with ordinary business vocabulary succeed; genuinely malformed or reserved schemas still reject.

## Boundaries & Constraints

**Always:**
- A legitimate label containing a keyword as a substring (`"Deleted?"`, `"Grants"`, `"Drop-off time"`, `"Delete date"`, `"Executive summary"`) MUST pass validation and provision as a real (non-fallback) generation.
- Preserve genuine safety: reserved-column collisions (`RESERVED_KEYS`) still reject; keys still pass through `normalizeTableName`; the `relation`/unsupported-type allowlist still rejects; empty/missing label or key still rejects; every rejection still logs via `reportRejection` with `organization_id`/session id + raw output (FR45).
- Keep the validator synchronous and pure (no I/O beyond the existing rejection logging), and keep the client-facing error generic (`genericError`) — never leak which label tripped a rule.
- Add unit tests that pin both directions: the previously-false-rejected labels now pass, and a genuinely dangerous/reserved schema still rejects.

**Never:**
- No change to the generation prompt, the Gemini response schema, the fallback template, `provision.ts`, `mutate.ts`, or the route's retry-then-fallback control flow.
- No new dependency; no relaxation of the reserved-key, type-allowlist, or normalization protections; no per-label detail leaked to the client.
- Do not weaken key safety: if the key-side check is kept, it must still refuse a bare reserved SQL verb used as a standalone key.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior | Error Handling |
|----------|--------------|-------------------|----------------|
| Legit label w/ keyword substring | table label `"Grants"`, field `"Deleted?"`, `"Drop-off time"` | Validates; provisions as a real generation | N/A (must NOT reject) |
| Reserved key collision | field key normalizes to `id`/`organization_id`/`created_at`/… | Reject (unchanged) | Generic error + Sentry log |
| Unsupported type | field `type: "relation"` or unknown | Reject (unchanged) | Generic error + Sentry log |
| Empty/missing label or key | `label: ""` / key absent | Reject (unchanged) | Generic error + Sentry log |
| Bare SQL verb as key | key normalizes to `drop` / `delete` alone | Reject (word-boundary hit) — or documented accepted if key-check dropped | Generic error + Sentry log |
| Punctuation in key | key `"a; b -- c"` | Normalizes to `a_b_c`, punctuation gone; validates on other rules | N/A |

</frozen-after-approval>

## Code Map

- `src/lib/schema/validator.ts` -- MODIFY. Remove the `containsBlockedKeyword(...label)` calls at `:134` and `:170`. Change `containsBlockedKeyword` (`:77-80`) from substring `.includes()` to word-boundary matching (e.g. build a `RegExp(\`\\b(${verbs.join("|")})\\b\`, "i")` for the alphabetic verbs; the punctuation entries `--`/`;`/`/*` become irrelevant once only the normalized key is checked and can be dropped from the key path). Keep it applied to the normalized `key` only (or drop entirely with a comment justifying that keys are `[a-z0-9_]`-normalized and reserved-checked). Leave `RESERVED_KEYS`, normalization, type allowlist, and `reportRejection` untouched.
- `tests/unit/schema-validator.test.ts` -- MODIFY. Add cases: `"Grants"`/`"Deleted?"`/`"Drop-off time"`/`"Delete date"` labels validate; a reserved-key collision, a `relation` type, and an empty label still reject; a bare `drop` key behaves per the chosen key-side decision.
- NOT TOUCHED: `src/app/api/generate/route.ts`, `src/lib/gemini/*`, `src/lib/generation/*`, `src/lib/data/*`, `src/lib/utils.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/schema/validator.ts` -- drop the label keyword check; convert the key check to word-boundary (or remove with justification) -- stops false-rejecting legitimate labels while keeping real protections.
- [x] `tests/unit/schema-validator.test.ts` -- add the both-directions cases from the matrix -- locks the fix and guards against regression.

**Acceptance Criteria:**
- Given a generated schema whose only "problem" is a label containing a blocked keyword as a substring (`"Grants"`, `"Deleted?"`, `"Drop-off time"`), when it is validated, then it passes and provisions as a real (non-fallback) generation.
- Given a schema with a reserved-key collision, an unsupported/`relation` type, or an empty label/key, when it is validated, then it still rejects with the generic client error and a `reportRejection` log.
- Given `npm run test`, `type-check`, `lint`, `build`, then all pass; the new validator tests cover both the newly-accepted labels and the still-rejected unsafe schemas.

## Implementation Notes

Implemented on branch `main` from baseline `f00de61`.

- `src/lib/schema/validator.ts` — removed both label keyword checks (table `:134` and field `:170`). Replaced substring `containsBlockedKeyword` with `keyIsBlockedVerb`, a whole-word matcher (`BLOCKED_KEYWORD_RE = /\b(DROP|GRANT|TRUNCATE|DELETE|EXEC)\b/i`) applied to the **normalized** key only, after `normalizeTableName`. Chose the preferred "keep the key check, converted to word-boundary" option (satisfies the "never weaken key safety" constraint). Dropped the punctuation entries (`--`, `;`, `/*`) from `BLOCKED_KEYWORDS` — they can never survive normalization into a `[a-z0-9_]` key. `RESERVED_KEYS`, `normalizeTableName`, the type/`relation` allowlist, non-empty-string checks, and `reportRejection` are untouched. Doc comment updated to cite Story 2.5 / retro F7. Because `_` is a regex word char, `drop`/`delete` (bare) reject while `dropoff`/`drop_off`/`backdrop` pass.
- `tests/unit/schema-validator.test.ts` — repurposed the old "blocked keyword in label or key" case into "rejects a key that normalizes to a bare blocked SQL verb"; added a Story 2.5 block pinning both directions (legitimate labels validate; embedded-verb keys validate; reserved-key collision / `relation` type / empty label still reject).
- No changes to the route, prompts, provision/mutate, or fallback control flow.

**Verification:** `npm run test` (validator: 24/24 pass), `npm run type-check`, `npm run lint`, `npm run build` — all pass. Manual browser check (generate a "Grants"/"Drop-off"-style dashboard) not run; validation-layer behavior is covered directly by the unit tests.

## Spec Change Log

## Review Triage Log

### Iteration 0 (2026-09-26)

| Finding (layer) | Verdict | Route | Evidence |
|---|---|---|---|
| Whole-word guard passes multi-word keys (`drop_table`); docstring "oversells" (blind-hunter) | false | — | Intended design: keys are JSONB payload / idempotency-string fragments (`provision.ts:135`), never SQL identifiers. Spec I/O matrix documents "Punctuation in key → validates on other rules." Docstring's concrete examples are all accurate. |
| No test for multi-word key embedding a verb (blind-hunter) | false | — | Already pinned: key-accept test asserts `"Drop-off time"` → `drop_off_time` (verb `drop` as leading `_`-delimited token) validates — structurally identical to `drop_table`. |
| Garbled/self-contradicting inline comment at test lines ~156–158 (blind-hunter) | low | patch | Real clarity defect in the new diff (dangling `?`, contradictory half-sentence); a maintainer meets it; fix is a direct correction. |
| `"Drop-off time"` reused across two tests, grouped misleadingly (blind-hunter) | low | patch | Same test-block clarity root area; grouped with the garbled-comment fix. |
| Dropping label check relies on unverified downstream escaping (blind-hunter) | false | — | Labels are inert JSONB / auto-escaped React text, never concatenated into SQL; no real injection outcome. A test asserting React escaping tests the framework and adds undemonstrated surface. |
| `EXEC`/`GRANT`/`TRUNCATE` unreachable, EXEC untested (blind-hunter) | false | — | Bare-verb reject loop iterates all `BLOCKED_KEYWORDS` (incl. EXEC/GRANT/TRUNCATE) at the field-key site and asserts rejection. |
| Edge-case-hunter | — | — | Empty — all spec/I-O-matrix claims traced and verified. |
| Table-key blocked-verb guard (`validator.ts:155`) has no test — bare-verb reject test only sets the field key (verification-gap) | medium | patch | Pre-verified gap: deleting/inverting the table-key guard leaves every test green. A spec-required protection is untested at the table-key call site. Fix: mirror the bare-verb loop for `tables[0].key`. |

## Design Notes

- The reserved-key check, key normalization, and type allowlist are the load-bearing protections; the keyword list was defense-in-depth against a SQL-injection path this architecture does not have (keys normalized to `[a-z0-9_]`; labels are inert escaped JSONB text). Relaxing the keyword check does not widen the real attack surface.
- Fallback and demo template keys are already ASCII and unaffected by any key-side change.

## Verification

**Commands:**
- `npm run test` -- expected: new validator cases pass; existing suite stays green.
- `npm run type-check` / `npm run lint` / `npm run build` -- expected: all pass.

**Manual checks:**
- Generate with a prompt likely to yield a "Grants"/"Deleted"/"Drop-off" style label; confirm a real (non-fallback) dashboard renders (no `isFallback` banner).
