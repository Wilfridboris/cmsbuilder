---
title: 'Per-Field Public Customization'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: 'd736fd3c1a9e77c5e9eb1f5d8d8fb3ad702cf33b'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A form collects every eligible field of its target table, in schema definition order, with the table's raw field labels and no help text. An Admin cannot choose which fields appear publicly, rename them for the public audience, add guidance, or reorder them. The epic requires the owner to control "exactly what I want, in my words." The stored `field_config` exists and is typed but is populated and read nowhere.

**Approach:** Add a per-field editor card to the form editor (toggle visibility, public label, optional help text, drag/keyboard reorder) that writes the form's `field_config` through a new guarded `updateFormFieldConfig` mutation. Apply that config at the single public resolution authority (`resolvePublicFormTarget` via a new pure `applyFieldConfig` helper over `intakeFields`), so both public rendering and the submission write-allowlist honor visibility, labels, help text, and order from one place. Extend `FormFieldConfig` with `helpText?` (JSONB — no migration).

## Boundaries & Constraints

**Always:**
- **FR78 relation invariant is absolute.** Relationship/lookup fields are never rendered, never writable, and never storable in `field_config`, regardless of any toggle. `applyFieldConfig` operates only over `intakeFields` (which already strips `relation` and `hidden` fields BEFORE config applies), and `updateFormFieldConfig` rejects/filters any `field_config` entry whose key is a relation field or is not a current field of the target table.
- **Candidate field set = the target table's non-hidden, non-relation fields (= `intakeFields`)** (decision). A field hidden via the dashboard column-hide flag is never a candidate and is never reachable on a public form. "Independent of the dashboard column-hide flag" is satisfied because the per-form `included` boolean is separate from the dashboard hide flag: toggling one never changes the other. The editor never surfaces dashboard-hidden fields.
- **Field config is editable while the form is PUBLISHED (live) — no lock** (decision; deliberately unlike the 14.4 target/slug locks). Field config never changes where responses land, so there is no silent-redirect risk; refining labels/help/order/visibility on a live form is a core use. `updateFormFieldConfig` does not reject on `published`, and the editor card is not disabled when published.
- **Backward compatibility: an empty `field_config` means "show all intake fields in definition order"** (today's behavior). Every form created before this story, and any newly created form, keeps rendering unchanged until an Admin saves a config. `applyFieldConfig([...], [])` returns its input unchanged. A field present in the target table but absent from a non-empty config defaults to visible, appended after configured fields (fail-open, scoped to non-hidden fields only so no hidden field can leak).
- **One resolution authority.** Visibility/label/help/order are applied exactly once, inside `resolvePublicFormTarget`, by transforming the `intakeFields(table)` list. The `IntakeTarget.fields` list remains the sole server-side write-allowlist consumed by `submitToTarget`, so excluding a field from the config removes it from both the rendered form and the accepted payload with no change to the submission handler. Public labels override `field.label` in place on the resolved field; help text rides along as a new optional `helpText` property.
- **Server is authoritative; the client is never trusted for the field set.** `updateFormFieldConfig` writes through the existing `form-mutate.ts` guarded layer under the caller's RLS client and identity (`actor_id`/`updated_at` bumped), 404s a form id not in the caller's org, and validates every entry against the current target table before writing. The `/api/forms/[formId]` PATCH route re-runs the writable-admin gate and maps failures to `Forms.error.*` via the `{ data, error }` envelope. The resolver re-derives the field set server-side on every public GET/POST and never trusts a client payload.
- **Editor shows relation fields as locked.** The per-field editor lists the target table's non-hidden fields; relation fields render disabled with a lock affordance and an "excluded from public forms" explanation, are not toggleable or reorderable, and are never emitted into the saved config.
- **WCAG AA.** Reorder is operable by both pointer drag and keyboard (per-row move-up/move-down controls); every control has an accessible label, `>=44px` touch target, visible focus ring. The Save control shows a pending spinner and an inline `role="alert"` error / `role="status"` saved confirmation, matching the rename/slug/target cards. Help text is wired to its input via `aria-describedby`. Mobile-first. All new copy resolves through the `Forms` and `IntakeForm` namespaces (EN + FR); no hardcoded strings; no em-dash.

**Never:**
- Do not add a DB migration. `field_config` is JSONB; `helpText?` is an additive optional TS property on `FormFieldConfig`.
- Do not change the public route/resolver's strict published-only contract, `publishForm`/`updateFormSlug`/`updateFormTarget`/`createForm` behavior, `middleware.ts`, or the core `mutate.ts`. Do not re-run or change the intake heuristic.
- Do not expose, accept, or store relation/lookup fields under any circumstance. Do not add branding/intro (14.6) or abuse protection (14.7).
- Do not add a new drag-and-drop dependency; reuse the existing `framer-motion` `Reorder` primitive.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Save a field config | `PATCH /api/forms/{id}` `{fieldConfig:[{key,included,label?,helpText?,order}]}` for valid non-relation keys | Config persisted (filtered to current non-relation fields); `200 {id,slug}`; public form then renders/accepts per the config | N/A |
| Public render honors config | GET public form; saved config hides field B, relabels A, adds help to A, reorders | Fields shown in config `order`; A shows its public label + help text; B absent; relation fields absent | N/A |
| Submission honors config | POST includes values for A, hidden B, and a relation field | Only included non-relation fields written; B's value dropped; relation value never accepted | N/A |
| Empty config (new/legacy form) | `field_config = []` | All intake fields shown in definition order with raw labels, no help text (unchanged behavior) | N/A |
| Config references a stale/relation key | Saved config contains a key not in the current target table, or a relation key | That entry is filtered out on write; never rendered or accepted | No write of the bad entry |
| All fields excluded on a published form | Saved config sets every field `included:false` | Resolver yields 0 fields → public form is "not available" (same as zero-eligible) | N/A |
| Unknown / cross-org form id | `formId` not in caller's org | `404 Forms.error.notFound` | RLS-hidden |
| Non-admin / cross-org PATCH | Member or cross-org admin | `403`; editor page already redirects non-admins | No internals leaked |

</frozen-after-approval>

## Code Map

- `src/types/db.ts:632-664` -- `FormFieldConfig` (`{key,label?,included?,order?}`) and `FormRow`. ADD optional `helpText?: string` to `FormFieldConfig` (JSONB — no migration). No other change.
- `src/lib/intake/target.ts:69-73` -- `intakeFields(table)` (non-hidden, non-relation, definition order). ADD pure `applyFieldConfig(base: FieldDefinition[], config: FormFieldConfig[]): PublicIntakeField[]` and export `PublicIntakeField = FieldDefinition & { helpText?: string }`. Empty config → return base unchanged; else filter by `included`, sort by `order`, override `label` with the entry's public label, attach `helpText`. Keep it framework-agnostic (node-testable), mirroring `intakeFields`.
- `src/lib/data/forms-public.ts:44-65,147-160` -- `IntakeTarget` + `resolvePublicFormTarget`. CHANGE `fields` type to `PublicIntakeField[]`; set `fields = applyFieldConfig(intakeFields(table), form.field_config)` (the existing `fields.length === 0 → null` guard still applies). No other change to the strict resolver.
- `src/components/intake/IntakeForm.tsx:199-329` -- public render. `IntakeField` renders `field.label` (now the overridden public label — no change needed) and currently wires `aria-describedby` only for errors. ADD optional help-text rendering (`<p id={helpId}>` + merge into `aria-describedby`); widen the `field` prop to `PublicIntakeField`.
- `src/lib/intake/submit.ts:59-111,164` -- submission allowlist + email. Already iterates `target.fields` by `key`/`type`; NO change (excluded fields are gone from `target.fields`; the extra `helpText`/overridden label are harmless).
- `src/lib/data/form-mutate.ts:32-42,359-432` -- guarded mutations; `FormMutateIdentity`, `FormMutateResult`, `updateFormTarget` (drop-stale filter to mirror). ADD `updateFormFieldConfig(identity,{formId,fieldConfig})`: 404 unknown id; validate/filter entries to current non-relation target-table fields (FR78); write `field_config`+`actor_id`+`updated_at`.
- `src/app/api/forms/schemas.ts:34-94` -- Zod bodies + `firstFormErrorKey`. ADD `fieldConfigBodySchema` (`{fieldConfig: z.array(...)}`).
- `src/app/api/forms/[formId]/route.ts:82-131` -- PATCH branch dispatch (publish → target → slug → rename). ADD a field-config branch (discriminated by a `fieldConfig` field), after target and before slug/rename.
- `src/lib/data/forms-client.ts:97-108` -- client wrappers. ADD `updateFormFieldConfig(slug, formId, fieldConfig)` mirroring `updateFormTarget`.
- `src/app/[slug]/forms/_shared.ts:109-164` -- `loadFormForEditor`. CHANGE to also return the target table's editor field list `editorFields: {key,label,type,isRelation}[]` (non-hidden fields of `form.target_table_key`, from the schema it already reads; `[]` when no/invalid target).
- `src/app/[slug]/forms/[formId]/page.tsx` -- pass `editorFields` (and current `form.field_config`) to `FormEditor`.
- `src/components/forms/FormEditor.tsx:350-453` -- insert a new `<FormFieldsEditor>` card AFTER the Target card (line 441) and BEFORE `FormPublishShare` (line 443).
- `src/components/forms/FormFieldsEditor.tsx` -- NEW client component: the per-field editor (see Design Notes). Owns its `useTransition`/error/saved state like the slug/target cards.
- `src/components/ui/switch.tsx`, `input.tsx`, `textarea.tsx` (confirm exists; else use `Input`), `label.tsx`, `button.tsx`, `card.tsx` -- primitives for the editor rows.
- `src/lib/schema/overrides.ts:29` & `src/lib/data/filter-sort.ts` -- `visibleTables`, `eligibleFields` (non-hidden). Source of the editor field list and the resolver base.
- `src/lib/i18n/en.json` & `src/lib/i18n/fr.json` -- `Forms` namespace (+ `IntakeForm` if a help-text a11y string is needed). ADD field-editor copy (card title/help, included toggle, public-label, help-text, move-up/down, locked-relation explanation, save/saved) and any new `error.*` key (EN + FR).

## Tasks & Acceptance

**Execution:**
- [x] `src/types/db.ts` -- add optional `helpText?: string` to `FormFieldConfig` -- typed vocabulary for help text (no migration).
- [x] `src/lib/intake/target.ts` -- add `PublicIntakeField` + pure `applyFieldConfig(base, config)`: empty-config passthrough; filter by `included`; sort by `order`; override `label`; attach `helpText` -- the single config-application helper, node-testable.
- [x] `src/lib/data/forms-public.ts` -- type `IntakeTarget.fields` as `PublicIntakeField[]`; apply `applyFieldConfig(intakeFields(table), form.field_config)` -- render + allowlist both honor config from one authority.
- [x] `src/components/intake/IntakeForm.tsx` -- render optional per-field help text with `aria-describedby`; widen the field prop to `PublicIntakeField` -- public form shows labels + help per config.
- [x] `src/lib/data/form-mutate.ts` -- add `updateFormFieldConfig(identity,{formId,fieldConfig})`: 404 unknown id; filter entries to current non-relation target-table fields (FR78 + drop-stale); write config -- guarded field-config write.
- [x] `src/app/api/forms/schemas.ts` -- add `fieldConfigBodySchema` -- validated field-config body.
- [x] `src/app/api/forms/[formId]/route.ts` -- add a field-config PATCH branch after target, before slug/rename -- route the mutation with the admin gate + envelope.
- [x] `src/lib/data/forms-client.ts` -- add `updateFormFieldConfig(slug, formId, fieldConfig)` -- client wrapper.
- [x] `src/app/[slug]/forms/_shared.ts` + `[formId]/page.tsx` -- return and pass `editorFields` (non-hidden target-table fields, with `isRelation`) and the form's `field_config` -- feed the editor.
- [x] `src/components/forms/FormEditor.tsx` + `src/components/forms/FormFieldsEditor.tsx` -- new per-field editor card (visibility Switch, public-label Input, help-text input, pointer drag via `framer-motion` `Reorder` + keyboard move-up/down, locked relation rows) with pending/error/saved states -- the story's UI.
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add `Forms` field-editor keys + any new `error.*` (EN + FR) -- no hardcoded strings, no em-dash.
- [x] `tests/unit/apply-field-config.test.ts` -- cover the matrix: empty-config passthrough, include/exclude, reorder, label override, helpText attach, relation/stale keys never surface -- lock the resolution invariants.
- [x] `tests/unit/form-field-config-mutation.test.ts` -- cover: valid write, relation-key rejected/filtered (FR78), stale-key filtered, 404 unknown id, identity/`updated_at` bump -- lock the write invariants.
- [x] `tests/unit/forms-route.test.ts` -- add a case asserting `{fieldConfig}` dispatches to `updateFormFieldConfig` (not publish/target/slug/rename) and the branch ordering holds -- route-level dispatch coverage.

**Acceptance Criteria:**
- Given a form's target table, when the Admin toggles field visibility, sets public labels and help text, and reorders fields, then saving persists the `field_config` and the public form renders those fields in that order, with those labels and help text, omitting excluded fields.
- Given a saved field config, when a visitor submits the public form, then only included non-relation fields are written to the owner's table, a posted value for an excluded field is dropped, and no relationship/lookup field is ever rendered or accepted (FR78), regardless of any toggle.
- Given a form with an empty `field_config` (newly created or pre-existing), when its public form renders and accepts a submission, then behavior is unchanged from before this story (all intake fields, definition order, raw labels).

## Implementation Notes

## Spec Change Log

## Review Triage Log

### Iteration 0 (2026-10-04)

- **Unguarded error-key lookup in `FormFieldsEditor.handleSave`** (blind-hunter + edge-case-hunter) — `medium` / **patch**. Verified: `FormEditor.tsx:78-81` sibling cards route server codes through `resolveError` with `ERROR_KEYS.has(short) ? t(\`error.${short}\`) : t("error.genericError")`; the new card at `FormFieldsEditor.tsx:522-527` calls `t(\`error.${short}\`)` unguarded, so a server code not in the `Forms.error.*` vocabulary makes next-intl emit a missing-key marker instead of the generic fallback. Diverges from the frozen "matching the rename/slug/target cards" constraint. Smallest fix: mirror the guarded fallback. Routed patch (direct correction to the established sibling pattern; no new public surface).
- **Resolver wiring of `applyFieldConfig` only ever exercised with an empty config** (verification-gap, pre-verified + blind-hunter) — `medium` / **patch**. Verified: every `formRow` in `forms-public.test.ts` uses `field_config: []`, so the resolver's non-empty branch is untested; dropping the `applyFieldConfig` call would leave the suite green while excluded fields stay renderable AND writable. Covers matrix rows "Public render honors config" and "Submission honors config" at the resolution authority. Smallest fix: add a resolver case with a non-empty config (exclude + relabel + helpText + reorder). Routed patch (test-only).
- **`loadFormForEditor.editorFields` (incl. `isRelation`) is unverified** (verification-gap, pre-verified) — `low` / **patch**. Verified: `form-editor-context.test.ts` never asserts `editorFields` and its schema has no relation field; `form-editor.test.tsx` hardcodes `editorFields: []`. Inverting `isRelation` would ship green, making the editor show a relation field as editable (FR78-presentation regression; data safety is still enforced + tested server-side in `form-field-config-mutation.test.ts`). Smallest fix: add a relation field to the context test's table and assert the `isRelation` flags. Routed patch (test-only).
- **`initialFieldConfig` could be `null` and crash `buildRows`/`applyFieldConfig`** (blind-hunter) — **false**. Refuted: `forms.field_config` is `jsonb not null default '[]'::jsonb` (`20261003120000_forms.sql:43`), created in the 14.1 migration before any form existed, so no row can deliver null; `FormRow.field_config: FormFieldConfig[]` (non-nullable) is accurate. No null reaches the helpers.
- **Editor/allowlist derived from two filters (`eligibleFields` vs `intakeFields`) — latent divergence** (blind-hunter) — **false**. Refuted by edge-case-hunter's trace: `intakeFields(table) = eligibleFields(table.fields).filter(non-relation)`, and the editor's non-relation rows = `eligibleFields(...).filter(!isRelation)`, so the two sets are equal by construction, not coincidence.
- **`moveRow` keyboard reorder + `Reorder` object-identity on edit are untested** (blind-hunter) — `low` / reject. The order a save emits is covered indirectly by the save payload (`order: index`); keyboard move is a thin array swap. Unlikely to be met broken in everyday use and the fix (a jsdom interaction test) is more than a direct correction. Rejected (negligible; partially folded into the editor-UI coverage note).
- **Relations-only target table shows locked list but no Save/empty guidance** (blind-hunter) — `low` / reject. A table with only relation fields is an edge of an edge; the locked group already explains relations are excluded. Adding a third empty-state branch is added complexity for a negligible, self-explanatory case. Rejected.
- **i18n "linked/liés" term consistency for relation fields** (blind-hunter) — `low` / reject. No named harm; the copy is clear and internally consistent. Rejected.
- **Stale doc attribution: `db.ts`/`FormRow` comments say "Story 14.4" owns include/label/order** (blind-hunter) — `low` / **defer**. Pre-existing comment wording (written in 14.1/14.4), not introduced by this change to describe wrong behavior; harmless but inaccurate about which story first populates the vocabulary. Deferred (doc-only, not caused by this story's code).
- **Em-dash in the new `helpText?` code comment in `db.ts`** (blind-hunter + edge-case-hunter noted clean user-facing copy) — `low` / reject. The no-em-dash rule governs user-facing copy; this is a code comment. User-facing i18n copy (EN+FR) is em-dash-free. Rejected (out of scope of the rule).

## Design Notes

- **One application point.** All config semantics live in the pure `applyFieldConfig` (node-testable, no React/Supabase), called once inside `resolvePublicFormTarget`. Because `submitToTarget` already derives its write-allowlist from the resolved `target.fields`, the submission path needs zero changes — excluding a field in the editor removes it from render AND payload automatically. This is the cheapest correct seam and keeps FR78 enforced in one tested place.
- **Label override in place; help text rides along.** `applyFieldConfig` returns shallow-copied fields with `label` replaced by the entry's public label (so `IntakeForm` and the notification email show the public label with no change) and a new optional `helpText`. Only the render component learns the extra property.
- **Reorder = framer-motion `Reorder` + keyboard buttons (no new dependency).** Per the UX review: `framer-motion` (already v12 in the project) provides accessible-enough pointer drag via `Reorder.Group`/`Reorder.Item`; pair it with per-row move-up/move-down icon buttons (`aria-label`ed) so keyboard and screen-reader users can reorder too (WCAG AA). Do NOT add `@dnd-kit`. Keep the project's Card + semantic-token styling; do NOT hand-author `dark:` variants (consistent with 14.3/14.4 cards).
- **Editor row model.** Merge `editorFields` with `field_config`: each non-relation field becomes a row (included default true when absent, label placeholder = schema label, help optional, order by config then definition). Relation fields render in a disabled/locked group and are never emitted. Save sends the full ordered non-relation config array.
- **Mirror `updateFormTarget`.** The mutation/route/client/test shape mirrors the 14.4 target work exactly (same identity, envelope, guard order, drop-stale filter) so the field-config write inherits the proven pattern.

## Verification

**Commands:**
- `npm run lint` -- expected: passes, including `eslint-plugin-i18next` (no hardcoded strings) and the `server-only`/admin-client import gates.
- `npx tsc --noEmit` -- expected: no in-project type errors; `PublicIntakeField`, `helpText`, and `updateFormFieldConfig` resolve at all call sites.
- `npx vitest run apply-field-config form-field-config-mutation forms-route` -- expected: config-application, write, and route-dispatch edge cases green.

**Manual checks:**
- In the editor, open the per-field card: toggle a field off, rename another, add help text, reorder, and save. Open the public form and confirm the order, labels, help text, and omission. Submit and confirm the owner's table receives only the included fields. Confirm relation fields appear locked in the editor and never on the public form. Reorder with the keyboard move buttons and confirm it persists.
