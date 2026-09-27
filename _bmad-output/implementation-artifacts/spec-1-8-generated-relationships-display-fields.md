---
title: 'Story 1.8: Generated Relationships & Display Fields'
type: 'feature'
created: '2026-09-26'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '48550ea26b8934012b29b9843f705272d6890dfc'
story_key: '1-8-generated-relationships-display-fields'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-7-schema-explainability-one-tap-override.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The generated schema (Story 1.4) and the hard fallback (1.5) produce disconnected tables: a Job stores its client as a free-text name, an Invoice re-types it. The generation contract forbids `relation` fields, the Schema Validator rejects them, and no table names a canonical label field. The anonymous demo therefore reads as separate spreadsheets, not "one connected business" — the FR70/FR75/AR14 relations promise the epic goal makes ("linked before ever creating an account") is unmet.

**Approach:** Widen the schema contract to a single-reference `relation` field (`relationConfig { targetTable, cardinality }`) and a table-level `displayField`. Let Gemini propose links (Job→Client, Invoice→Job) with a one-line reason; the Schema Validator accepts a relation only on the strict-JSON generation path and only when its `targetTable` resolves within the same batch (two-pass), rejecting `cardinality:'many'` at MVP. Provisioning defaults each table's `displayField`, orders inserts so referenced tables seed first, and resolves each seed relation value (a target row's display-field value) to the inserted target id — so `records.data` stores the id, never the label. The demo dashboard resolves that id back to the target's `displayField` label for read-only display. Convert the fallback template to the same linked shape.

## Boundaries & Constraints

**Always:**
- A `relation` field stores the target record's UUID in `records.data` — never the label. Labels resolve at read time from the target table's `displayField`, so a target rename never breaks a reference.
- The Schema Validator keeps every existing protection intact (reserved-key collisions, blocked-keyword rejection on keys, hardened prompt, no DDL emitted, Sentry rejection logging). It accepts a `relation` field ONLY when `relationConfig.targetTable` resolves to a table key in the same generation batch — a two-pass check (collect all batch table keys, then validate targets); self-reference and cycles are legal. It rejects `cardinality:'many'` and any non-`llm` `source` unless `phase === 'growth'`.
- Each table records a `displayField` (a non-hidden field key). When generation omits it, provisioning defaults it to the first non-hidden `text` field, else the first non-hidden field of any type.
- Provisioning inserts referenced tables before referencing tables and resolves each seed relation value to the target's inserted id by matching the target row's `displayField` value. An unresolved reference drops that one relation value (the row still writes) — a malformed reference never fails the generation, mirroring the existing `filterSeedRows` tolerance.
- Relation display in the demo is READ-ONLY: the table, card, and detail views show the resolved target label; relation fields expose no free-text editor. All new user-facing strings resolve through next-intl (EN + FR); no em-dash in copy; WCAG AA and the existing 48px/keyboard affordances stay intact. Build any visual surface via the `web-uiux-architect` skill.
- The fallback template and its seed rows convert to the linked shape (Job→Client, Invoice→Job) with a `displayField` per table, and must still pass `validateGeneratedSchema`/`filterSeedRows` unchanged (the existing fallback conformance test stays green).

**Never:**
- No interactive relation editing/creation in this story: no record picker, no typeahead, no relation add/edit affordance, no filter/sort-by-relation, no reverse related-list, no safe-delete guard — all Epic 3 (Stories 3.7–3.9). No multi-select relations or editor-created relations — Epic 9 (`phase: 'growth'`).
- No write-time referential-integrity guard in `src/lib/data/mutate.ts` (provisioning guarantees seed-id validity by construction; the interactive-write guard lands with Epic 3's picker). No `mutate.ts`/`records.ts` signature change.
- No new DB migration and no `jsonb_path_ops` GIN index (the existing `records_data_gin_idx` suffices for the ≤8-row demo; the reverse-lookup index lands with Epic 3). No DB foreign keys — referential integrity is app-layer only.
- No change to the authenticated (post-claim, Epic 3) dashboard's handling of relation fields (`RecordsView`, `AddRecordForm`, `useRecordMutations`); rendering/editing relations there is Epic 3.
- No runtime DDL, no service-role key in any client bundle, no raw stacks/SQL/LLM output leaked to the client.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior | Error Handling |
|----------|--------------|-------------------|----------------|
| LLM emits valid relation | `relation` field, `targetTable` is a batch table key | Accepted + sanitized (`relationConfig` carried through); reason preserved | N/A |
| Relation targets unknown table | `targetTable` not in batch | Rejected (generic user message); logged to Sentry with id + raw output | Retry once → fallback |
| Multi-select at MVP | `cardinality:'many'`, `phase:'generation'` | Rejected | Retry once → fallback |
| Self-reference / cycle | Table relates to itself or A→B→A | Accepted (legal) | N/A |
| displayField omitted | table has no `displayField` | Provisioning defaults it (first non-hidden text field, else first non-hidden field) | Defensive |
| displayField names missing/hidden field | `displayField` not a visible field key | Rejected by validator | Retry once → fallback |
| Seed relation value resolves | seed value equals a target row's `displayField` value | Stored as the target's inserted UUID | N/A |
| Seed relation value unresolved | seed value matches no target row | That relation value omitted; row still inserts | Non-fatal |
| Demo renders relation cell | row holds a target UUID | Target's `displayField` label shown (read-only); no editor | Unresolved id → empty placeholder |

</frozen-after-approval>

## Code Map

- `src/types/db.ts` -- MODIFY. `FieldDefinition.type` (lines 21–29): add `"relation"`. `FieldDefinition` (11–36): add `relationConfig?: { targetTable: string; cardinality: "one" | "many" }`. `TableDefinition` (39–55): add `displayField?: string`. Update the stale line-17 comment that says relation is excluded.
- `src/lib/gemini/prompts.ts` -- MODIFY. `GENERATION_FIELD_TYPES` (41–50): add `"relation"`. `buildGenerationPrompt()` (75–94, esp. line 89 "Do NOT create relationship/lookup fields"): replace with guidance to emit single-reference relations (each with `relationConfig.targetTable` + reason), to name a `displayField` per table, and to reference targets in `seedRows` by the target row's display-field value. `GENERATION_RESPONSE_SCHEMA` (107–155): add `"relation"` to the field `type` enum (line 130); add `relationConfig` object (`targetTable` string, `cardinality` enum `one|many`) to field properties; add `displayField` string to table properties; extend both `propertyOrdering` arrays.
- `src/lib/schema/validator.ts` -- MODIFY. `ValidationContext` (78–83): add `phase?: 'generation' | 'growth'` (default `'generation'`) + `source?: 'llm' | 'ui'` (default `'llm'`). Table loop (139–164): reuse `seenTableKeys` as the pass-1 set; validate `displayField` (if present) names a non-hidden field of that table, else leave unset. Field loop (174–224): after the type check (188–196) now passes `"relation"`, gate it — require `relationConfig.targetTable` ∈ `seenTableKeys`; reject `cardinality:'many'` or non-`llm` source unless `phase==='growth'`; sanitize `relationConfig` onto the output field. Keep RESERVED_KEYS/BLOCKED_KEYWORDS/`reject()` paths unchanged. Two-pass note: table keys must be fully collected before relation targets are checked (collect keys in a first sweep, then validate fields).
- `src/lib/schema/relations.ts` -- CREATE. Pure, node-testable helpers reused by provisioning + display: `displayFieldKey(table)` (the default rule above), `orderTablesByRelations(tables)` (topological order, referenced first; on cycle fall back to declared order), `resolveSeedRelationRefs(...)` (map target `displayField` value → inserted id; rewrite referencing rows; drop unresolved), `buildRelationResolver(schema, records)` → `(field, value) => label | null`.
- `src/lib/generation/provision.ts` -- MODIFY. `upsertSchema` (~92–108, before persisting `definition` at line 100): default each table's `displayField` via `displayFieldKey`. `provisionGeneration` seed loop (115–146): order tables via `orderTablesByRelations`; as each table's rows insert, record inserted ids keyed by that table's `displayField` value; rewrite later tables' relation seed values to those ids (via `resolveSeedRelationRefs`) before calling `mutate`. `mutate` calls stay as-is (values already ids).
- `src/lib/generation/fallback.ts` -- MODIFY. Convert `jobs.client` (82–86) and the invoices client field (118–124) to `relation` fields: `jobs.client` → `targetTable:"clients"`; invoices gains a `job` relation → `targetTable:"jobs"` (FR: "invoices to their job"). Add a `displayField` per table (e.g. `clients:"name"`, `jobs:"service"`, invoices a text label field as its display). Rework `FALLBACK_SEED_ROWS` (160–188) so relation columns carry the target row's display-field value (client name / job service), so provisioning resolves them to ids. Must still pass `validateGeneratedSchema`/`filterSeedRows`.
- `src/components/dashboard/DemoDashboard.tsx` -- MODIFY (via `web-uiux-architect`). Build `buildRelationResolver(schema, records)` (memoized on session schema+records) and thread a `resolveRelation(field, value)` into `TableView`/`CardList`/`RecordDetail`. For `field.type === 'relation'` render the resolved label (fallback to the `cellEmpty` placeholder), not `formatCell`.
- `src/components/dashboard/RecordDetail.tsx` -- MODIFY (via `web-uiux-architect`). `FieldRow` renders the resolved relation label read-only and suppresses the edit (`Pencil`) affordance for `relation` fields; `type.relation` badge label from i18n. Other fields unchanged.
- `src/lib/format.ts` -- MODIFY. Add a defensive `relation` branch (return `String(value)` — a raw id) so a stray relation reaching the scalar formatter degrades gracefully; the display path resolves the label before `formatCell` for relations. Update the stale line-13 comment.
- `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- MODIFY. Add `Dashboard.type.relation` (EN "Link" / FR "Lien"); add any relation-display a11y string if introduced. No em-dash.
- `tests/unit/schema-validator.test.ts` -- MODIFY. The existing "rejects the relation field type" case (≈81–86) must flip: relations are now accepted on the generation path. Add relation cases (below).
- `tests/unit/relations.test.ts` -- CREATE. Cover `relations.ts` helpers + the validator relation gate scenarios from the matrix.
- NOT TOUCHED: `src/lib/gemini/client.ts` (schema flows through), `src/lib/data/mutate.ts`, `src/lib/data/records.ts`, `supabase/migrations/*`, the authenticated-dashboard components.

## Tasks & Acceptance

**Execution:**
- [x] `src/types/db.ts` -- add `"relation"` to the field-type union, `relationConfig?` to `FieldDefinition`, `displayField?` to `TableDefinition`; fix stale comment -- the shared contract every layer reads.
- [x] `src/lib/schema/relations.ts` -- CREATE `displayFieldKey`, `orderTablesByRelations`, `resolveSeedRelationRefs`, `buildRelationResolver` -- one tested source for the relation/display logic reused by provisioning and display.
- [x] `src/lib/schema/validator.ts` -- add `phase`/`source` to context; two-pass relation acceptance + `targetTable` resolution + cardinality/source gating; `displayField` validation; keep all existing rejections -- the safety gate.
- [x] `src/lib/gemini/prompts.ts` -- permit + guide relation fields and `displayField`; add them to the response schema + `GENERATION_FIELD_TYPES`; instruct seed-row references by display value -- lets Gemini propose links.
- [x] `src/lib/generation/provision.ts` -- default `displayField`; order inserts referenced-first; resolve seed relation values to inserted ids -- so `records.data` holds ids.
- [x] `src/lib/generation/fallback.ts` -- convert to Job→Client / Invoice→Job relations + `displayField`; rework seed rows to reference by display value -- the fallback demonstrates links too.
- [x] `src/components/dashboard/DemoDashboard.tsx` + `RecordDetail.tsx` -- resolve + render relation labels read-only across table/card/detail; suppress the editor for relations -- via `web-uiux-architect`.
- [x] `src/lib/format.ts` -- defensive `relation` branch + comment fix.
- [x] `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- add `Dashboard.type.relation` (EN + FR).
- [x] `tests/unit/schema-validator.test.ts` (flip the relation-reject case) + `tests/unit/relations.test.ts` (CREATE) -- cover the I/O matrix rows.

**Acceptance Criteria:**
- Given a prompt implying related entities, when the schema generates, then Gemini can emit single-reference `relation` fields (Job→Client, Invoice→Job) each with a `relationConfig.targetTable` and a one-line reason, and the validator accepts them only when the target resolves within the batch.
- Given a generated or fallback schema persisted to `org_schemas`, when it is read back, then every table has a `displayField` (defaulted when omitted) naming a non-hidden field.
- Given an LLM-proposed relation, when the validator runs with `{ phase: 'generation', source: 'llm' }`, then a relation with an unresolved `targetTable` or `cardinality:'many'` is rejected (logged to Sentry), self-reference/cycles are accepted, and all keyword/reserved/hardened-prompt protections still hold with no DDL emitted.
- Given seeded relation data, when a record is written during provisioning, then `records.data` stores the target record's UUID (never its label), with referenced tables inserted first and unresolved references dropped non-fatally.
- Given the anonymous demo dashboard, when a relation cell renders in the table, card, or detail, then the target's `displayField` label is shown read-only (no free-text editor), falling back to the empty placeholder when the id does not resolve.
- Given `npm run test`, `type-check`, `lint`, `build`, then all pass; the fallback conformance test stays green; no service-role/`GEMINI_API_KEY` in any client bundle; no hardcoded strings; no em-dash in copy.

## Implementation Notes

**Delivered.** All ten tasks complete; full contract → generation → validation → provisioning → display → fallback flow shipped.

- **Types (`db.ts`):** `FieldDefinition.type` widened with `"relation"`; added `relationConfig? { targetTable; cardinality: "one" | "many" }`; `TableDefinition` gained `displayField?`. Optional JSONB fields, backward-compatible, no migration.
- **Prompt (`prompts.ts`):** kept `GENERATION_FIELD_TYPES` scalar-only and added a separate `GENERATION_FIELD_TYPES_WITH_RELATION` that drives the response-schema `type` enum — so the scalar-only reuse elsewhere stays unambiguous. The prompt now guides single-reference links (Job→Client, Invoice→Job), a per-table `displayField`, and seed-by-display-value; the old "Do NOT create relationship fields" line is gone. Response schema gained `relationConfig` + table `displayField` with updated `propertyOrdering`.
- **Validator:** genuine two-pass — pass 1 collects/validates all table keys, pass 2 validates fields (relation targets resolve against the full batch regardless of declaration order) + `displayField`. Relation gate: `relationConfig.targetTable` must resolve in-batch; `cardinality:'many'` and non-`llm` source rejected unless `phase==='growth'`; self-ref/cycles legal; `relationConfig` normalized onto the sanitized field. All reserved/blocked/hardened protections intact. `ValidationContext` gained `phase`/`source` (defaults `generation`/`llm`).
- **`relations.ts` (new):** `displayFieldKey`, `resolvedDisplayFieldKey` (read-time fallback when a stored `displayField` no longer resolves), `orderTablesByRelations` (Kahn topo, referenced-first, self-ref-ignoring, cycle-tolerant), `resolveSeedRelationRefs` (display-value→id rewrite, drop-on-miss), `buildRelationResolver` (id→label `Map`).
- **Provisioning:** defaults omitted `displayField` before persist; inserts referenced tables first; records inserted ids by display value; rewrites later tables' relation seed values to ids before `mutate`. `mutate.ts` untouched (values are ids by the time they're written).
- **Display:** `DemoDashboard` builds a memoized `resolveRelation` and threads it through a shared `renderCell` into table/card and into `RecordDetail`; relations render the resolved label read-only (no editor). `format.ts` gained a defensive `relation` branch. i18n `Dashboard.type.relation` (EN "Link" / FR "Lien").
- **Fallback:** `jobs.client` → relation to `clients`; invoices' text client replaced by a `job` relation to `jobs` plus a new `invoice_number` text display field; `displayField` per table; seed rows reference targets by display value (all values chosen to resolve).

**Verification (all green, re-run orchestrator-side against the diff):** `test` → 306 pass (29 files, incl. fallback conformance + new `relations.test.ts` and validator relation/displayField blocks); `type-check` exit 0; `lint` exit 0 (only the pre-existing eslintrc-deprecation warning); `build` exit 0; `.next/static` scan clean (no `SUPABASE_SERVICE_ROLE_KEY`/`GEMINI_API_KEY`/`service_role`/`GENERATE_SESSION_SECRET`).

**Matrix audit.** All nine matrix rows have covering unit tests that ran and passed. Two notes: (1) the validator rejects a `displayField` that names a *hidden* field in code (`!field.hidden`), but only the "names no field" case has an explicit test — the hidden sub-case is covered indirectly via `resolvedDisplayFieldKey` tests. (2) The demo relation-cell *rendering* row is covered at the resolver level (`buildRelationResolver` unit tests); the DOM itself is manual per the repo's no-jsdom precedent (1.3–1.7).

**Not done / risk.** Manual browser checks (generate a related-entities prompt; force fallback; toggle FR) were not run this session — they need a live dev server + Gemini/Supabase. Pre-existing em-dashes remain in some fallback `reason` strings (Story 1.5 copy, outside this diff); this story introduced none.

## Spec Change Log

## Review Triage Log

### Review pass 1 (2026-09-26)

Three layers (blind-hunter, edge-case-hunter, verification-gap) run in parallel at session (Opus) capability against the diff. Verdicts rendered against the code, not the reviewers' framing.

**Routed to patch (sent to the implementation subagent; verification re-run orchestrator-side):**
- **[low → patch] `displayField` may name a `relation` field, rendering a UUID as a table's reference label** (BlindHunter + VerificationGap-other, `validator.ts` displayField check) — VERIFIED: the check requires only `field.key === displayKey && !field.hidden`; it does not exclude a relation-typed field. `displayFieldKey`'s default prefers text so it never auto-selects a relation, but an explicit LLM `displayField` naming a relation is accepted, and `buildRelationResolver` would then map `id → (raw target UUID)`, so every reference to that table renders a UUID. Reachability is low (prompt guides displayField to text identifiers) but the render is visibly broken. Fix completes the in-scope displayField validation: reject a relation-typed displayField + test.
- **[low → patch] Fallback relation-resolution is not verified end-to-end through provisioning** (BlindHunter + VerificationGap-gap, `fallback.ts` seed values → `provision.ts`) — VERIFIED gap: `fallback.test.ts` runs the template through `validateGeneratedSchema`/`filterSeedRows` only; `provision.test.ts` proves resolution with a synthetic 2-table `LINKED_SCHEMA`, never the real 3-table fallback chain. A future rename desyncing an `invoices.job`/`jobs.client` seed value from its target `displayField` value would silently drop the reference on the "never an error screen" path, undetected. Fix: add a provision test that provisions `UNIVERSAL_FIELD_SERVICE_TEMPLATE` + `FALLBACK_SEED_ROWS` and asserts every relation cell resolves to a real id (also guards the duplicate/uniqueness concern).
- **[low → patch] The `displayField`-names-a-hidden-field rejection branch is untested** (BlindHunter, `schema-validator.test.ts`) — VERIFIED: the validator rejects it (`!field.hidden`), but only the "names no field" case is asserted; the hidden sub-case is covered only indirectly via `resolvedDisplayFieldKey`. Fix: add one validator test case.

**Routed to defer (recorded in deferred-work.md):**
- **[low → defer] Demo relation-cell rendering (read-only label, suppressed editor) has no DOM/component test** (VerificationGap-gap, `DemoDashboard.tsx` `renderCell` + `RecordDetail.tsx` FieldRow) — VERIFIED: no test references these components; a regression dropping the `resolveRelation` branch would render raw UUIDs and the unit suite (which tests `buildRelationResolver` directly) would stay green. The resolver logic is fully unit-tested; only the JSX wiring is unverified, matching the pre-existing untested state of the demo components (1.6/1.7). Manual-check plan covers it. Pre-existing testing posture, not caused by this change.
- **[low → defer] `epic-1-context.md` overstates what Epic 1 ships** (BlindHunter + VerificationGap-other, `epic-1-context.md` Technical Decisions) — VERIFIED: the recompiled context asserts the abstract `validate(op, {phase, source})` signature and an app-layer `mutate.ts` write-time referential-integrity guard, but this story ships neither (the as-built is `validateGeneratedSchema(raw, context)`; the write guard is deferred to Epic 3). The spec itself is correctly scoped; only the compiled context file overstates it. Fix edits an agent-context file → defer.

**Rejected:**
- **[low → reject] Duplicate `displayField` value → first-match-wins mislink** (BlindHunter + EdgeCase, `provision.ts`/`relations.ts`) — real but low: matching is by trimmed value, first match wins, so two target rows sharing a display value mislink the second. Unlikely (the LLM generates distinct entities; all fallback display values are unique) AND the fix (dedup, composite key, or reject-duplicate) adds logic beyond a direct correction. Reject per the low-rule.
- **[false → reject] `CardList` headline uses the first visible field, not `displayField`** (BlindHunter, `DemoDashboard.tsx`) — the card's own-table headline is not a "reference"; 1.8's intent covers how a row appears when *referenced* (handled by the resolver), not the 1.6 card-headline design. No regression: `jobs.client` was the first field before too (as text), so the visible headline is unchanged (now a resolved label). Bad outcome does not occur.
- **[false → reject] `filterSeedRows` runs before `resolveSeedRelationRefs`; key-normalization can drop the relation value** (BlindHunter, `provision.ts`) — within 1.8 the flow is key-consistent: `filterSeedRows` projects onto the sanitized (normalized) field keys and `resolveSeedRelationRefs` reads the same normalized `field.key`. The LLM-emits-a-differently-keyed-seed-row concern is pre-existing (Story 1.4, affects every field type) and unchanged by this diff.
- **[false → reject] `format.ts` relation branch leaks a raw UUID to a user cell** (BlindHunter, `format.ts`) — unreachable in the demo: `renderCell` (table/card) and `FieldRow` (detail) resolve relations before `formatCell` is ever called, so the defensive `String(value)` branch does not surface to the user. Cited leak does not occur.
- **[low → reject] No automated FR-string test for the relation type badge** (BlindHunter, i18n) — negligible: the `fr.json` `Dashboard.type.relation` key is present (verified in the diff) and next-intl throws on a missing message; a test pinning a static JSON key is low-value.
- **[false → reject] `sprint-status.yaml` (`in-progress`) disagrees with the spec (`in-review`)** (BlindHunter) — expected in-flight workflow state; the build advances the spec through in-progress → in-review → done and reconciles sprint-status at present time. Not a defect.
- **[low → reject] Unresolved id and empty relation render identically (no signal)** (BlindHunter, resolver) — the matrix intends the empty placeholder for an unresolved id; dangling-reference handling and the delete-guard are explicitly Epic 3. Out of the frozen intent; fix adds affordance/logging complexity.
- **[low → reject] Cycle-break in `orderTablesByRelations` drops a seed ref with no observability** (BlindHunter, `relations.ts`/`provision.ts`) — cycles are legal by design and the drop is intentionally non-fatal (mirrors `filterSeedRows`); cycles are rare in generated field-service schemas. Unlikely AND the fix (log/counter) is more than a direct correction.
- **[false → reject] A relation without `relationConfig` reaching `resolveSeedRelationRefs` leaves a raw string in `records.data`** (EdgeCase, `relations.ts`) — unreachable: the validator requires `relationConfig` on every accepted relation and the fallback supplies it; both providers guarantee it. Defensive-only, as the EdgeCase layer itself noted.

_No intent_gap or bad_spec entries → no loopback; patches applied in place._

**Patch outcome.** All three patches landed. Notable: while adding the hidden-`displayField` test, the fix revealed the existing hidden-field rejection was **inert** — `hidden` is stripped during field sanitization, so `!field.hidden` against the sanitized list was always true; it now consults a `hiddenFieldKeys` set built from the raw input, so a hidden-named `displayField` is genuinely rejected (a real code fix, not just a test). The relation-typed `displayField` rejection and the fallback end-to-end provisioning test also landed. Full verification re-run green: `test` 309 pass (29 files), `type-check` 0, `lint` 0, `build` 0, `.next/static` secret scan clean.

## Design Notes

- **Validator shape kept (not refactored to `validate(op, {phase, source})`).** AR14 describes the gate abstractly; the as-built is `validateGeneratedSchema(raw, context)`, a whole-batch validator. Thread `phase`/`source` into `ValidationContext` (defaults `generation`/`llm`) rather than restructure the signature — smaller blast radius, and the "op" is implicit in the generation shape (append-only add_table/add_field only), per the existing line-37 comment.
- **Seed references by display value, resolved at provision time.** The LLM cannot know insert-time UUIDs, so it references a target by its human-readable `displayField` value (e.g. a Job's `client` = `"Maple Ridge Dental"`). Provisioning inserts `clients` first, maps `name → id`, then rewrites `jobs.client` to that id before insert. This is exactly why the current fallback seed rows (which already carry the client's name) convert cleanly. Match on trimmed value; first match wins; unresolved → drop that value (non-fatal), consistent with `filterSeedRows`.
- **Cycles are legal, so provisioning must not hard-fail on them.** `orderTablesByRelations` topologically orders where it can and falls back to declared order inside a cycle; unresolved cross-refs within a cycle simply drop that seed value. The validator allows self-ref/cycles by design.
- **Referential integrity deferred to Epic 3.** The demo has no interactive relation writes; provisioning guarantees valid ids by construction. The write-time existence guard belongs where user-driven relation writes first appear (Epic 3's picker, 3.7), so `mutate.ts` is untouched here.
- **Display resolution is client-side + tiny.** ≤8 rows/table in session state; `buildRelationResolver` builds a per-target `Map<id,label>` from `records`. The batched `id IN (...)` server lookup + 50k-row p95 path is the account-dashboard concern (Story 3.8), separate code.

## Verification

**Commands:**
- `npm run test` -- expected: new `relations.test.ts` passes; flipped validator case + existing suite (incl. fallback conformance) green.
- `npm run type-check` -- expected: `tsc --noEmit` passes with the widened union.
- `npm run lint` -- expected: passes; no hardcoded user-facing strings; no service-role/`GEMINI_API_KEY` in client-bundled code.
- `npm run build` -- expected: production build succeeds; `.next/static` free of service-role/`GEMINI_API_KEY`.

**Manual checks:**
- Generate on `/` with a related-entities prompt (e.g. "clients, jobs, invoices"); confirm Job/Invoice tables show the linked client/job by name (not a raw id), in table, card (mobile), and detail; the relation field has no edit control.
- Force the fallback (two failures) and confirm the template shows Job→Client / Invoice→Job links.
- Toggle FR; the relation type badge and any new strings translate; keyboard + 48px affordances intact.
