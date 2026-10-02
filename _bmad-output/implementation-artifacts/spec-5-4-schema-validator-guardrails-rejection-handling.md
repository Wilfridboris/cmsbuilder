---
title: 'Story 5.4: Schema Validator Guardrails & Rejection Handling'
type: 'feature'
created: '2026-10-01'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'ba5681904697c78abc757a920ecbc15f68da9d75'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Conversational Editor (Stories 5.1–5.3) already routes every request through `src/lib/schema/validator.ts`, but Story 5.4's guardrails are only partially met. The operation allowlist is enforced *implicitly* (by Gemini's `kind` enum plus three route branches) with no explicit, auditable allowlist seam; the blocklist covers only 5 of the 8 tokens the ACs name (`--`, `;`, `/*` and "any raw SQL" are not rejected); and the required CI test coverage for the full allowlist/blocklist/reserved-collision surface is incomplete. This is the product's highest-risk surface (the only place LLM output drives tenant-structure changes), so the fence must be explicit, literal, and pinned by tests.

**Approach:** Harden the existing validator seam without regressing prior decisions. Add an explicit `PERMITTED_OPERATIONS` allowlist + guard (reject+log anything outside the three ops); add a raw-SQL discard guard on the **raw LLM output** (not user labels) covering `;`/`--`/`/*` + SQL-shaped verbs, per the epic's "any LLM response containing SQL is discarded" rule; keep the whole-word, case-insensitive verb match on normalized keys unchanged so Story 2.5's false-reject fix survives (`dropoff`/`Drop-off time` still pass); reuse the already-wired `reportRejection` Sentry path (AC3 met, pin with tests); and backfill comprehensive validator unit tests for the full allowlist, all 8 blocklist tokens, and reserved collisions (CI already runs them). The specifics are enumerated under Boundaries.

## Boundaries & Constraints

(Epic-5 invariants in `epic-5-context.md` apply; below is specific to or sharpened for this story.)

**Always:**
- `PERMITTED_OPERATIONS = ["add_field", "add_table", "add_view"]` is the single source of truth for the operation allowlist; the guard lives in `validator.ts` (the clean seam the epic names as the template for a future real-world action allowlist) and is invoked on the editor path before any metadata write.
- The raw-SQL discard guard runs against the **raw LLM output** (the model's returned operation object / its stringified JSON), never against the human-typed display `label`. It rejects when the raw output contains `;`, `--`, `/*`, or any `BLOCKED_KEYWORDS` verb as a SQL-shaped token. Decision (2026-10-01): this surface, not labels, so Story 2.5's label-is-free-text and `dropoff`-passes behavior is preserved.
- Verb matching on normalized keys stays exactly as today: whole-word (`\b…\b`), case-insensitive, after `normalizeTableName` strips to `[a-z0-9_]`. `dropoff`, `backdrop`, `Drop-off time` continue to PASS; `DrOp`, a bare `drop` token, and `status DROP` continue to REJECT.
- Every rejection (allowlist, raw-SQL, keyword, reserved collision) calls `reportRejection(detail, { id: orgId, rawOutput })` and surfaces to the user as the single fixed i18n copy `ChatAssistant.rejection` ("That change isn't allowed. Try describing what you'd like to add instead.") — never a raw detail, SQL, JSON, or stack.
- `organization_id` and the record store's own columns stay in `RESERVED_KEYS`; a proposed key colliding with a reserved key is rejected (not silently disambiguated).
- New validator unit tests run under the existing `npm run test` (Vitest, node env) and therefore in `.github/workflows/ci.yml` with no CI changes.

**Never:**
- No new destructive operation, migration, SQL generation, or DDL — this story only tightens validation and adds tests; it changes no mutation behavior for valid operations.
- Never revert Story 2.5: do not switch verb matching to substring, and do not keyword-check user display labels. `dropoff`/`Drop-off time` must keep passing.
- No new user-facing copy: the fixed rejection message already exists and is reused verbatim (en + fr). No new i18n keys, no em-dash.
- No change to the Gemini `kind` enum, the hardened system prompt, auth/role gating (Admin-only, 403 for Members), or the `out_of_scope` → friendly `declined` / `needs_clarification` → `clarify` conversational flows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Permitted op | LLM returns `add_field`/`add_table`/`add_view`, well-formed | Passes the allowlist guard; proceeds to the existing per-op validation + write | N/A |
| Out-of-allowlist op | LLM output `kind` is not a permitted op and not `needs_clarification`/`out_of_scope` | Rejected before any write; fixed rejection copy; `reportRejection` with org id + raw output | Rejection is total |
| Raw SQL in output | Raw LLM output contains `DROP TABLE x;`, `-- `, or `/* */` | Discarded as security violation; nothing written; fixed rejection copy; logged with org id + raw output | Rejection is total |
| Punctuation token in output | Raw output contains `;`, `--`, or `/*` anywhere | Rejected; fixed copy; logged | Rejection is total |
| Verb as whole-word key | Proposed key normalizes to contain a bare `drop`/`delete`/… token, or mixed-case `DrOp` | Rejected (unchanged behavior); fixed copy; logged | Rejection is total |
| Embedded substring (2.5) | `dropoff`, `backdrop`, `Drop-off time` as a label | PASSES — not a blocked token; normal add proceeds | N/A |
| Reserved-key collision | Proposed key equals `organization_id`, `id`, `data`, a timestamp col, etc. | Rejected (not disambiguated); fixed copy; logged | Rejection is total |
| Conversational kinds | `needs_clarification` / `out_of_scope` | Unchanged: `clarify` question / friendly `declined` — NOT a validator rejection, NOT logged as one | N/A |

</frozen-after-approval>

## Code Map

Reuse / extend (keep existing behavior unless noted):
- `src/lib/schema/validator.ts` — `RESERVED_KEYS` (L60-68), `BLOCKED_KEYWORDS` (L79-85, 5 verbs), `BLOCKED_KEYWORD_RE`+`keyIsBlockedVerb` (L116-123, whole-word/`/i` — **do not change**), `normalizeTableName` (strips to `[a-z0-9_]`), `validateAddField` (L531-587, `reportRejection` L538), `validateAddTable` (L636-744, L642), `validateAddView` (L810-967, L816). Comments at L51-54 (shape allowlist rationale) and L70-77 (why punctuation was removed from key checks) — update them to reflect the new raw-output guard. **Add here:** `PERMITTED_OPERATIONS` constant + an exported `isPermittedOperation`/`assertPermittedOperation` guard; an exported raw-SQL detector (e.g. `containsRawSql(rawOutput)`) covering `;`/`--`/`/*` + verb tokens, operating on the raw LLM output.
- `src/app/api/schema/edit/route.ts` — dispatch L189-414 (`needs_clarification` L190; `add_field` L200-257; `add_table` L259-317; `add_view` L319-405; fallthrough→`declined` L407-414); `handleMutateError` L427-443 maps `AppError(400)`→`{kind:'rejected', assistantText: t('rejection')}`; auth `getCurrentUser` L111, `requireAdmin` L132. **Change:** invoke the allowlist guard + raw-SQL discard on the parsed LLM output before dispatch; out-of-allowlist/raw-SQL → `rejected` + `reportRejection(... {id: orgId, rawOutput: output})`. Keep `out_of_scope`→`declined`, `needs_clarification`→`clarify`.
- `src/lib/data/schema-mutate.ts` — `addField`/`addTable`/`addView` (L201-393) thread `{ id: orgId, rawOutput }` into validation context; the raw-SQL guard may alternatively run at the top of this shared path if cleaner — pick the seam that keeps one checkpoint, not three copies.
- `src/lib/observability/report.ts` — `reportRejection(reason, {id, rawOutput})` (L98-108) → `Sentry.captureMessage(level:'warning', extra)` with console fallback. **Reuse as-is** (AC3 already satisfied).
- `src/lib/gemini/prompts.ts` — `EDITOR_RESPONSE_SCHEMA` `kind` enum (L264-272: the 5 kinds), `HARDENED_SYSTEM_PROMPT` (L30-36). **Do not change.**
- `src/lib/i18n/en.json` / `fr.json` — `ChatAssistant.rejection` (en L492). **Reuse verbatim.**

Tests (Vitest, node env; `npm run test -- <pattern>`):
- `tests/unit/schema-validator.test.ts` — dedicated validator suite (39 tests). **Primary target** for the comprehensive allowlist/blocklist/collision coverage.
- `tests/unit/schema-add-field.test.ts`, `tests/unit/schema-add-table.test.ts`, `tests/unit/schema-add-view.test.ts` — per-gate suites; fill the identified per-verb gaps (GRANT mixed-case; DELETE/EXEC punctuation variants; EXEC in field/table loops).
- `tests/unit/route-schema-edit.test.ts` — route branches; add out-of-allowlist + raw-SQL rejection cases.
- `.github/workflows/ci.yml` (L32-33 `npm run test`) — **no change**, confirms AC4 "run in CI".

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/schema/validator.ts` -- add `PERMITTED_OPERATIONS = ["add_field","add_table","add_view"]` + exported `isPermittedOperation(kind)`; add exported `containsRawSql(rawOutput)` detecting `;`/`--`/`/*` and `BLOCKED_KEYWORDS` verb tokens in the raw LLM output; export a single `assertEditorOperationAllowed(output, context)` (or equivalent) that rejects+`reportRejection` on out-of-allowlist or raw-SQL. Leave `keyIsBlockedVerb`/`BLOCKED_KEYWORD_RE`/normalized-key verb matching unchanged (Story 2.5). Update the L51-54/L70-77 rationale comments.
- [x] `src/app/api/schema/edit/route.ts` -- before the per-kind dispatch, run the allowlist + raw-SQL guard against the parsed model output; on violation return `{kind:'rejected', assistantText: t('rejection')}` and log via `reportRejection({id: orgId, rawOutput: output})`. Preserve `out_of_scope`→`declined` and `needs_clarification`→`clarify`. (If the shared `schema-mutate` path is the cleaner single checkpoint, place the guard there instead — exactly one checkpoint, not duplicated per op.)
- [x] `tests/unit/schema-validator.test.ts` -- comprehensive rows: (a) **allowlist** — each permitted op passes the guard; a non-permitted/unknown op rejects + calls `reportRejection`; `needs_clarification`/`out_of_scope` are NOT treated as validator rejections. (b) **full blocklist** — all 5 verbs as bare/mixed-case/embedded-as-token keys → reject; `;`, `--`, `/*`, and a raw-SQL string (`DROP TABLE x;`) in the raw output → reject; embedded-as-substring (`dropoff`, `backdrop`, `Drop-off time`) → PASS (pins Story 2.5). (c) **reserved collisions** — all 7 `RESERVED_KEYS` → reject. (d) assert each rejection path invokes `reportRejection` with `{ id, rawOutput }`.
- [x] `tests/unit/schema-add-field.test.ts` + `tests/unit/schema-add-table.test.ts` + `tests/unit/schema-add-view.test.ts` -- fill per-gate keyword gaps so all 5 verbs are exercised (bare + mixed-case) in each gate; keep existing passing cases.
- [x] `tests/unit/route-schema-edit.test.ts` -- add route cases: out-of-allowlist `kind` → `rejected`, no write, `reportRejection` called; raw-SQL in output → `rejected`, no write; `add_field`/`add_table`/`add_view` still applied; `out_of_scope`→`declined`, `needs_clarification`→`clarify` unchanged; Member → 403.

**Acceptance Criteria:**
- Given any editor request, when processed, then it is checked against `PERMITTED_OPERATIONS` and any operation outside `add_field`/`add_table`/`add_view` (including attempts whose key targets `organization_id` or a reserved column) is rejected before any write, with no raw detail leaked. (FR42)
- Given a request whose raw LLM output contains a restricted keyword (`DROP`, `GRANT`, `TRUNCATE`, `DELETE`, `EXEC`) or a SQL token (`--`, `;`, `/*`) or any raw SQL, when validated, then it is rejected 100% of the time and the user sees exactly "That change isn't allowed. Try describing what you'd like to add instead." (FR43, NFR-S4)
- Given a legitimate name whose key merely contains a blocked verb as a substring (`dropoff`, `Drop-off time`), when validated, then it is NOT rejected (Story 2.5 preserved).
- Given any Schema Validator rejection, when it occurs, then it is logged via `reportRejection` to Sentry with the user's `organization_id` and the raw LLM output. (FR45)
- Given the validator unit tests, when `npm run test` runs in CI, then they cover the permitted-operations allowlist, the full 8-token blocklist (mixed-case and embedded-as-token), and reserved-column collisions, and all pass.

## Implementation Notes

- Fence placed in `route.ts` as the single checkpoint (not per-op in `schema-mutate`): it runs once after `needs_clarification` (which returns `clarify` first) and is skipped for `out_of_scope` (which falls through to `declined`), so conversational kinds structurally never call `reportRejection`.
- The raw-SQL verb detector (`RAW_SQL_VERB_RE`) is whitespace/quote-bounded, deliberately distinct from the `\b`-bounded normalized-key guard (`BLOCKED_KEYWORD_RE`, untouched). Consequence worth noting for review: a model-generated label like `"Drop-off time"` passes (hyphen boundary, Story 2.5 preserved), but a verb-led phrase bounded by whitespace (`"Drop shipment"`, `"please DELETE the row"`) is treated as SQL-shaped and rejected. This is the accepted Option A posture (stricter on raw model output); it is not a matrix-row violation (the matrix only pins hyphen/substring labels as must-pass).
- `schema-add-view.test.ts` was left unchanged: it already exercised all 5 verbs (`drop`, `DELETE`, `Truncate`, `exec`, `GRANT!`), so it had no per-gate gap to fill.
- Verification (orchestrator, judged against the staged diff): full suite 1169/1169 pass (105 files); `type-check` clean; `lint` clean (only the pre-existing eslintrc deprecation warning). Manual Playwright review not yet run — pending post-commit per the repo convention.

## Spec Change Log

## Review Triage Log

Pass 1 (review_loop_iteration 0) — blind-hunter (6 + 2 extra), verification-gap (0 gaps + 1 other), edge-case-hunter (1 + notes):

- [blind/vgap/edge] `containsRawSql` over-rejects a benign permitted op whose raw output embeds `;`/`--`/`/*` or a whitespace/quote-bounded verb in a free-text filter value or label (e.g. a filter value `"a; b"`, a label `"Overdue; Urgent"`) — **low → reject**. This is the approved Option A posture: the frozen Boundaries + I/O matrix row "Punctuation token in output" explicitly specify "contains `;`, `--`, or `/*` anywhere → Rejected". Not a spec deviation. Everyday-use likelihood is low (CRM filter values are statuses/dates/names/amounts), the rejection is non-destructive and the fixed copy invites a rephrase, and the narrowing fix (scope the scan to structural fields / token-boundary the punctuation) adds branches and would contradict the frozen matrix. Surfaced to the human as the known trade-off they chose.
- [blind] `RAW_SQL_VERB_RE` omits other SQL verbs (`UPDATE`/`INSERT`/`ALTER`/`CREATE`/`SELECT`/…) so `"UPDATE records SET …"` without punctuation passes — **false**. AC2 enumerates exactly 8 tokens (DROP/GRANT/TRUNCATE/DELETE/EXEC + `;`/`--`/`/*`); the spec intentionally scopes to those. Adding verbs like `UPDATE`/`SELECT` would false-reject common labels (`"Last Update"`) and the data layer generates no SQL regardless (defense-in-depth, not an injection barrier). Out of the spec's enumerated scope.
- [blind] The `JSON.stringify` throw `catch` (returns `true`) and the `typeof text !== "string"` guard in `containsRawSql` are untested — **low → patch**. Fail-closed behavior of a security fence; pinning it is a cheap, test-only guard against a future refactor flipping it fail-open.
- [blind] No test asserts the `reportRejection` detail string / the `reason` discriminant — **false**. The unit tests DO assert the discriminant: `{ allowed: false, reason: "operationNotAllowed" }` (diff L498) and `{ reason: "rawSqlRejected" }` (diff L589). The first-arg human-readable detail string is negligible to pin.
- [blind] `needs_clarification` fence ordering is load-bearing but untested; fence comment doesn't mention it — **false**. Route test "clarify: needs_clarification → 200 clarify" (`route-schema-edit.test.ts` L445) pins the ordering — moving the fence before that branch would fail it, so a reorder is not silent. Comment nicety is cosmetic and test-guarded.
- [blind] The `context.rawOutput ?? output` fallback is untested — **false**. The allowlist unit tests (diff L462-485) call `assertEditorOperationAllowed(output)` with no context, exercising the `?? output` fallback (and expecting `allowed: true`).
- [blind-extra] No route test for an output containing only `--` or `/*` (vs `;`/a verb) — **low → reject**. Redundant: the route merely delegates to `containsRawSql`, whose unit test loops all three punctuation tokens (diff L523-529). A per-token route test adds nothing.
- [blind-extra] Duplicate `import type` lines for `SchemaDefinition` and `TableDefinition` from `@/types/db` in the validator test — **low → patch**. Pure tidy (merge into one import); fix removes, not adds, complexity.
- [edge] Stale fallthrough comment in `route.ts` ("out_of_scope (or any unexpected kind)") — after the 8b fence only `out_of_scope` can reach the final `declined` branch — **low → patch**. No runtime effect; a one-line comment accuracy fix in production code.

Routing: no intent_gap or bad_spec (the code implements the frozen spec faithfully; the dominant finding describes approved behavior), so no loopback. Three entries route to **patch** (fail-closed test; duplicate-import merge; stale-comment fix). All others rejected/false.

## Design Notes

Layering: hardened prompt → `PERMITTED_OPERATIONS` allowlist → raw-SQL discard (raw model output) → whole-word verb check (normalized key) → reserved-key collision → RLS → Sentry audit log. Splitting the raw-SQL guard (model output) from the verb check (normalized key) is deliberate — it gives literal 8-token + raw-SQL coverage while leaving Story 2.5's label behavior untouched. Since the data layer never generates SQL (JSONB metadata store), this blocklist is defense-in-depth + audit trail, not an injection barrier; its load-bearing output is the `reportRejection` log, which the tests must pin.

## Verification

**Commands:**
- `npm run test -- schema-validator` -- expected: all allowlist/blocklist/collision rows pass, including the Story 2.5 `dropoff`-passes pins.
- `npm run test -- schema-add-field` / `schema-add-table` / `schema-add-view` -- expected: per-gate keyword gaps now covered; all pass.
- `npm run test -- route-schema-edit` -- expected: out-of-allowlist + raw-SQL rejection cases pass; valid ops still applied.
- `npm run type-check` -- expected: no type errors.
- `npm run lint` -- expected: clean.

**Manual checks:**
- As an Admin on the dashboard, confirm a normal "add a column to Jobs" / "add a table for timesheets" / "show me unpaid invoices sorted by date" still succeed unchanged. Confirm a benign label like "Drop-off time" still adds successfully (no false reject). No raw JSON/SQL/error is ever shown.

**Manual review (Playwright, post-commit) — verified.** On the authed Admin fixture `/session-1f4fa453` against the running dev app on `localhost:3000` with a live Gemini key:
- **Story 2.5 pin (benign verb-adjacent label, through the new fence):** "add a drop-off time to Quotes & Jobs" returned "Done. I added Drop-off time to Quotes & Jobs." with an Undo button. The **Drop-off time** column really landed on Quotes & Jobs (add-record field + sortable column header + data-row cell). No false reject.
- **Blocked-keyword rejection (AC2, end-to-end):** "add a column named DROP to Customers" returned exactly the fixed copy "That change isn't allowed. Try describing what you'd like to add instead." with **no Undo** and **no raw JSON/SQL/stack**. Switching to Customers confirmed its 5 original columns are unchanged — **no `DROP` column written** (rejected before any write, AC1).
- **Zero console errors or warnings** across the session.
