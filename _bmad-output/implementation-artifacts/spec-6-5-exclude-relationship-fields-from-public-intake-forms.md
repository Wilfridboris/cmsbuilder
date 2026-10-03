---
title: 'Exclude Relationship Fields from Public Intake Forms'
type: 'chore'
created: '2026-10-03'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 6.5 / FR78 requires relationship (lookup) fields to be excluded from the public intake form: not rendered, not accepted in the submission payload, and never leaking target-table ids/labels/counts into markup or any network payload. Investigation confirmed this invariant is already fully enforced and tested — it was delivered ahead of itself during Stories 6.1/6.2 (render-path filter `intakeFields` at `src/lib/intake/target.ts:69-73`, whose comment says "pre-aligns with Story 6.5"; payload allowlist at `src/app/api/intake/[slug]/route.ts:74-109` that drops any non-allowlisted key). The existing coverage lives in separate suites (`intake-target`, `intake-data`, `intake-submit-route`), so no single artifact is attributable to Story 6.5 or asserts the whole FR78 invariant in one place.

**Approach:** Add one explicit, Story-6.5/FR78-named regression guard test that pins the full invariant end-to-end in a single file — (a) the render-path field derivation drops `relation` fields, and (b) the submission allowlist silently drops a relation-shaped key an attacker injects into the raw POST body, so it never reaches the written record. No production code changes. Then mark story `6-5` done in sprint-status. This is a belt-and-suspenders guard: if a future change ever reintroduces a relation branch on the public surface, this test fails.

</frozen-after-approval>

## Implementation Notes

- No production code changed. FR78 was already enforced in two independent places built during 6.1/6.2: the render-path derivation `intakeFields` (`src/lib/intake/target.ts:69-73`, which filters `field.type !== "relation"` and whose comment says "pre-aligns with Story 6.5"), and the submission allowlist in `src/app/api/intake/[slug]/route.ts:74-109`, which iterates `target.fields` and silently drops any non-allowlisted key. Fields carry no "required" flag, so AC2 ("required relation left unset, linked later") holds by design — a relation is simply never collected.
- Added `tests/unit/intake-relation-exclusion.test.ts` (3 tests) pinning both FR78 layers against one relation-bearing fixture (a `one` relation, a `many` relation, and a hidden scalar): (AC1/AC3) the real `intakeFields` yields only the visible scalars in order, no `relation` type and no `relationConfig` survive at either cardinality, the hidden scalar is dropped too, and neither relation target-table name appears in the derived field set; (AC2/AC3) the route resolver's `fields` is set to the REAL `intakeFields` output so the derivation feeds the real allowlist — injected `client`/`crew` keys never reach the written record, the scalar submission still succeeds with both relations left unset, and no injected id appears anywhere in the mutate call; and a relation-only submission is rejected as an empty write.
- Scope (from review): this guard exercises the field derivation and the payload allowlist. It does not exercise production's `getIntakeTarget` wiring (covered in `intake-data.test.ts`) or the `IntakeForm` component JSX (no relation branch by design, no jsdom env). Target-RECORD labels/counts are not asserted because the public path never fetches related records, so there is nothing of that kind to leak.
- Verified: `npx vitest run` across the 5 intake suites (51 passed); `npm run lint` clean (src, test-only change); `npx tsc --noEmit` exit 0.

## Review Triage Log

Blind Hunter pass (floor N=4). Verified production wiring in `src/lib/data/intake.ts:6,57` and the absence of a relation branch in `src/components/intake/IntakeForm.tsx` before classifying.

- **Group A (prose overclaimed what the test verifies) — patched.** The original header/comments implied the test proved production's resolver wiring and "the render path" (component), and that AC3 positively checked record labels/counts. Reality: the resolver wiring is covered by `intake-data.test.ts`, the `IntakeForm` component has no relation branch by design (not exercised here, no jsdom), and record labels/counts cannot leak because the public path never fetches related records. Rewrote the docblock and per-test comments to state exactly what is and is not covered. (F1, F4, F5, F7, F8.)
- **Group B (single narrow fixture) — patched.** Added a `cardinality: "many"` relation and a hidden scalar to the fixture so AC1 asserts relations are dropped at BOTH cardinalities and the hidden-scalar exclusion co-exists; the payload test now injects both `client` (one) and `crew` (many) keys. (F2, F3.)
- **Group C (redundant dead mock) — patched.** Removed the duplicate `createAdminClient.mockReturnValue(...)` in `beforeEach` (the `vi.fn` factory already returns the same value). (F9.)
- **F6 (nested-structure smuggle of a relation value) — low, rejected.** A relation key is dropped by allowlist *membership* (`for (const field of target.fields)`), independent of its value shape, and non-primitive scalar values are already rejected with a 400 in `tests/unit/intake-submit-route.test.ts:211`. A duplicate assertion here adds no coverage.
