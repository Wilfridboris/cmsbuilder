---
title: 'Loud Alert on Unresolvable Gemini Model'
type: 'bugfix'
created: '2026-10-07'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '2901baa8ce1d529a0bc9544e5e8ba9e6267cc8f0'
context:
  - '_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `GEMINI_MODEL` is a hardcoded id (`"gemini-3.8-flash"`, already bumped once from the retired `gemini-2.0-flash`). If Google retires it, `callGeminiWithTimeout` returns model-not-found on every call, so `/api/generate` fails both attempts and silently provisions the Story 1.5 hard-fallback template for 100% of generations — the core generative "aha" is dead, yet it is logged only at ordinary `reportError` level, indistinguishable from a transient timeout. Nothing pages a human (epic-1 retro item 2, FR45).

**Approach:** Make a retired/unresolvable model fail loud at runtime (decision: runtime critical alert, not a CI smoke test — CI has no `GEMINI_API_KEY` and a gated live test self-skips green like the RLS test, the false-safety trap retro item 6 flagged; the real failure mode is a model retired after deploy, which only a runtime signal catches). Add a pure, testable classifier for a Gemini model-not-found error and, in the generation failure path, escalate that specific case to `reportCritical` (the existing Sentry `level:"fatal"` paging seam used by tier-reconciliation) instead of ordinary `reportError`. User-facing behavior is unchanged — the fallback template is still served (never an error screen); "fail loud" is an ops signal only.

## Boundaries & Constraints

**Always:**
- Detection is a pure, exported, node-testable classifier `isModelNotFoundError(err: unknown): boolean` in the gemini module — a tolerant heuristic over the SDK error (a numeric `404` status/code, or a message indicating a not-found model), returning `false` for anything it cannot positively identify.
- Only a model-not-found failure escalates to `reportCritical` (carrying the offending `GEMINI_MODEL` id and a stable reason marker so the alert is actionable). Every other generation failure (timeout, invalid JSON, Schema Validator rejection) stays at the existing ordinary `reportError` severity — no false paging.
- User-facing behavior is unchanged: the retry-once-then-fallback flow and the 200 fallback-template reveal are untouched; a retired model still degrades to a working starter template, never an error screen. Reuse the existing `reportCritical` seam — add no new alerting system.

**Never:**
- No CI/live smoke test, no `GEMINI_API_KEY` CI secret, no change to CI workflows (decision B; a gated live test self-skips green without the secret and does nothing for a post-deploy retirement).
- No change to the `GEMINI_MODEL` value, the prompt, the Schema Validator, the fallback template, `callGeminiWithTimeout`'s throw-on-failure contract, or the client's retry/validation split. No user-facing copy or UI change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| SDK 404 model-not-found | error with `status`/`code` `404` (message names the missing model) | `isModelNotFoundError` → `true` | N/A |
| Message-only model-not-found | `Error("... model ... not found ...")` (no numeric status) | `true` | N/A |
| Timeout | `Error("Gemini timeout")` | `false` (stays ordinary `reportError`) | N/A |
| Validator rejection | `AppError(422, ...)` | `false` | N/A |
| Unknown / null error | `Error("boom")`, `null`, `undefined` | `false` (never a false page) | N/A |
| Generation fails on a retired model | both attempts throw model-not-found | `reportCritical` (paging) with the model id; fallback template still provisioned + 200 | ops paged, user unaffected |
| Generation fails transiently | both attempts time out | ordinary `reportError` (unchanged); fallback template + 200 | user unaffected |

</frozen-after-approval>

## Code Map

- `src/lib/gemini/client.ts` -- ADD exported pure `isModelNotFoundError(err: unknown): boolean` (tolerant duck-type: numeric `404` on `err.status`/`err.code`, or a `/not[\s_-]?found/i` + model/`models/` message match; `false` otherwise). `GEMINI_MODEL` already lives here. `callGeminiWithTimeout` unchanged.
- `src/app/api/generate/route.ts` -- at the two attempt-failure report sites (`reportError(firstErr, { attempt: 1 })` ~line 213 and `reportError(secondErr, { attempt: 2 })` ~line 217), branch on `isModelNotFoundError(err)`: if true call `reportCritical(err, { ...ctx, reason: "gemini-model-unresolved", model: GEMINI_MODEL })`, else keep `reportError`. Import `reportCritical`, `isModelNotFoundError`, `GEMINI_MODEL`. No change to the retry/fallback/return flow.
- `tests/unit/gemini-client-errors.test.ts` (NEW, or extend `tests/unit/gemini-generation.test.ts`) -- unit cover `isModelNotFoundError` across the matrix.
- `tests/unit/route-generate.test.ts` -- extend: a double model-not-found failure → `reportCritical` called (with the model id), `reportError` not used for it, and the response is still the 200 fallback reveal; a generic double failure → `reportError` (not `reportCritical`), still 200 fallback. Follow the file's existing mocks for `callGeminiWithTimeout` and the observability module.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/gemini/client.ts` -- add the pure `isModelNotFoundError` classifier per the Always rules.
- [x] `src/app/api/generate/route.ts` -- escalate a model-not-found attempt failure to `reportCritical` (with the `GEMINI_MODEL` id + reason marker); leave all other failures on `reportError` and the retry/fallback/return flow unchanged.
- [x] `tests/unit/gemini-client-errors.test.ts` (NEW) or `gemini-generation.test.ts` -- cover the `isModelNotFoundError` matrix (404 status/code → true; message-only model-not-found → true; timeout / AppError / unknown / null → false).
- [x] `tests/unit/route-generate.test.ts` -- assert the severity branch: model-not-found double failure → `reportCritical` (model id present), not `reportError`, still 200 fallback; generic double failure → `reportError`, not `reportCritical`, still 200 fallback.

**Acceptance Criteria:**
- Given the configured Gemini model is retired/unresolvable so the API returns model-not-found, when a generation attempt fails on it, then the failure is reported at CRITICAL/paging severity (`reportCritical`) identifying the model, rather than silently logged at ordinary level (epic-1 item 2, FR45).
- Given a transient generation failure (timeout, invalid JSON, Schema Validator rejection), when it is reported, then it stays at the ordinary `reportError` severity (no false page) and the retry/fallback behavior is unchanged.
- Given any generation failure, when it occurs, then the user-facing result is unchanged: the hard-fallback template is still provisioned and returned 200 — never an error screen; the loud alert is an ops-only signal.

## Implementation Notes

- `isModelNotFoundError` (src/lib/gemini/client.ts) duck-types: numeric/stringified `404` on `err.status` or `err.code`, OR a `/not[\s_-]?found/i` message that also mentions a model (`/\bmodels?\b|models\//i`). Returns `false` for non-objects, `null`, and anything else — no false page.
- The route escalation is centralized in a `reportAttemptFailure(err, context)` helper (src/app/api/generate/route.ts) applied at BOTH attempt-failure sites (attempt 1 and 2), replacing the two bare `reportError` calls. It calls `reportCritical(err, { ...context, reason: "gemini-model-unresolved", model: GEMINI_MODEL })` only when `isModelNotFoundError` is true. The retry/fallback/return flow is byte-for-byte unchanged.
- The route test mocks only `callGeminiWithTimeout`; it uses the REAL `isModelNotFoundError` + `GEMINI_MODEL` via `vi.importActual` so the severity decision is exercised, not stubbed.

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **low -> reject** — The 15s timeout race in `callGeminiWithTimeout` could mask a slow 404 so the classifier sees `"Gemini timeout"` not the model-not-found (blind-hunter). A model-not-found 404 is a fast API response, not a hang, so it settles the `Promise.race` well before 15s and propagates intact; the "slow 404 / abort-as-timeout" path is implausible, and preserving the underlying rejection would modify `callGeminiWithTimeout`, which the frozen "Never" keeps unchanged.
- **low -> reject** — `reportCritical` fires per-attempt with no app-side dedup, so a retired model floods the pager under traffic (blind-hunter). Sentry groups by fingerprint and rate-limits alert rules (one actionable issue, not thousands of pages), and this mirrors the pre-existing per-attempt `reportError` pattern the route already used; an app-side throttle is the "new alerting system" the frozen "Never" excludes.
- **low -> reject** — Message heuristic is over-broad (pages on any "model" + "not found" with no 404) and the `models\/` alternation is dead (blind-hunter). The loose message match is the frozen I/O-matrix behavior ("The requested model was not found" -> true), so tightening would renegotiate frozen intent; within the only errors that reach this path (Gemini SDK + validator `AppError(422)`) a false "model not found" is implausible; and `models\/` is not actually dead (it matches a path-style `models/` lacking a word boundary, e.g. `xmodels/`).
- **false -> reject** — The new `reportAttemptFailure` regressed validator rejections from `reportRejection` to `reportError` (blind-hunter). No regression: the pre-existing code already routed every attempt failure (including the `AppError(422)` validator rejection) through `reportError`; the helper preserves that path byte-for-byte. Whether validator rejections should use the purpose-built `reportRejection` is a pre-existing routing choice outside this story's intent (the model-not-found escalation).
- **low -> reject** — No test for a mixed 404-then-timeout across the two attempts (blind-hunter). `reportAttemptFailure` is invoked independently per attempt and both branches (model-not-found -> `reportCritical`; other -> `reportError`) are unit-covered; the mixed case is their composition with correct behavior (a single 404 across the attempts still pages), not a distinct code path.
- **low -> reject** — `reportAttemptFailure` spreads `...context` before `reason`/`model`, so a future caller passing those keys would be silently shadowed (blind-hunter). No current collision — the only callers pass `{ id, attempt }`; guarding a hypothetical future caller adds type machinery (reserved-key exclusion) for negligible gain.

## Design Notes

**Why runtime, not CI (decision B).** CI has no `GEMINI_API_KEY`; a gated live smoke test would self-skip green when the secret is absent (the same false-safety the RLS test shows and retro item 6 flagged), and it would do nothing for a model retired *after* deploy — the actual production failure mode. A runtime `reportCritical` on the first model-not-found pages a human immediately while users stay on the working fallback.

**Classifier is a heuristic.** The exact `@google/genai` error shape for a 404 is duck-typed (numeric `404` status/code or a not-found-model message). A false positive merely pages on a rare unrelated 404; a false negative degrades to today's ordinary `reportError` — no worse than the status quo. Keeping it pure makes the decision node-testable without the SDK or network.

## Verification

**Commands:**
- `npm run type-check` -- expected: no NEW errors (note: a pre-existing `.next/dev/types/app/api/claim/route.ts` typed-routes error is tracked in deferred-work and unrelated).
- `npm run lint` -- expected: clean.
- `npx vitest run tests/unit/gemini-client-errors.test.ts tests/unit/route-generate.test.ts` -- expected: new classifier + severity-branch cases pass. Full `npx vitest run` green.

**Manual checks:**
- Not practically forceable without retiring the live model; the classifier and the route severity branch are unit-covered. Optional: temporarily point `GEMINI_MODEL` at a bogus id in local dev, run one generation, and confirm a `reportCritical` (`[observability] reportCritical ...`) line is logged while the UI still reveals the fallback template.
