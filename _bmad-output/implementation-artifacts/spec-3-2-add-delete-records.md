---
title: 'Add & Delete Records (authenticated dashboard)'
type: 'feature'
created: '2026-09-26'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: 'ae8e1537423f1863b563e38c106a64b25100b6ae'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The authenticated dashboard (`/[slug]` → `RecordsView`) is read-only after Story 3.1: a team member can browse their org's real records but cannot add a new one or remove an obsolete one. That fails FR7 (add via a schema-typed form) and FR9 (delete), the core of Epic 3's "daily driver" promise, and leaves the mandated TanStack Query optimistic-write layer (explicitly deferred from 3.1) unbuilt.

**Approach:** Wire the app-wide TanStack Query provider (the 3.1 seam), then add two guarded, optimistic mutations against the active table in `RecordsView`: an add-record flow whose inputs are generated from the table's visible `FieldDefinition`s (available both as an inline quick-add row/card and, via an expand control, as the same form inside a focused modal), and a per-record delete gated by a confirmation dialog. Both call a new `/api/records` route family that resolves the caller's org + RLS-scoped client server-side and writes through the existing `mutate.ts` guarded layer (`actorId` set, soft-delete via `deleted_at`, `version` concurrency). The UI follows the mandatory optimistic sequence (cancel in-flight → optimistic cache update → roll back on error → invalidate on settle); every failure rolls back and surfaces a translated, non-technical message.

## Boundaries & Constraints

**Always:**
- All record writes go through `mutate.ts` via a new server route. The route resolves `orgId` by looking up the organization for the acting `slug` **under the caller's RLS-scoped client** (RLS returns the org only if the caller is a member — mirrors `[slug]/page.tsx`); it never trusts a client-supplied org id and never uses the service-role/admin client for record writes. It builds `MutateIdentity` = `{ client: rlsClient, actorId: user.id, orgId }`.
- The add form is generated from the active table's *visible* fields (`visibleTables(...)` then `.filter(f => !f.hidden)`). Each field renders an input control matching its `type`, and each has a real associated `<label htmlFor>` (never placeholder-only, NFR-A4). Mapping: `boolean` → two-choice toggle; `number`/`currency` → text input with `inputMode="decimal"`; `email` → email; `phone` → tel; `date` → date; `datetime` → datetime-local; `text` → text. There is **no** enum/dropdown field type in the schema — do not invent one (the AC's "dropdown" is illustrative).
- The add form is presented two ways over ONE shared form body and ONE lifted draft state (the user picks per-add): an inline quick-add row (desktop) / card (mobile) at the top of the active table for fast entry, and an "expand / open full form" control that reopens the same form inside a focused modal (existing Radix `dialog`). Switching inline → modal preserves the in-progress draft (single source of draft state). Both paths submit through the same `useAddRecord` mutation.
- Delete is gated by a confirmation dialog (existing Radix `dialog`): the per-record delete control opens a translated confirm/cancel dialog, and only confirming triggers the optimistic soft-delete. There is no restore/trash/undo UI in this story.
- CRUD uses the TanStack Query optimistic sequence: `cancelQueries` → snapshot previous → optimistic `setQueryData` → roll back to snapshot on error → `invalidateQueries` on settle. No spinner on CRUD; the add-submit button shows a disabled/pending state instead.
- The active table's records are read on the client via `useQuery(['records', slug, tableKey])` seeded with the server-fetched rows as `initialData`; a new `GET /api/records` supplies the authoritative refetch on invalidate.
- Each add submit carries a client-generated `idempotencyKey` (dedupes retried inserts in `mutate.ts`). Each delete sends the record's current `version` as `expectedVersion`.
- Any authenticated org member (Admin or Member) may add and delete records — there is no role gate on record CRUD (role gating begins at Story 3.5 column-hide).
- All new user-facing strings resolve through next-intl under the `SlugDashboard` namespace in BOTH `en.json` and `fr.json`. All new interactive controls are keyboard-operable, screen-reader labelled, and ≥48×48px.

**Never:**
- No inline edit-on-blur, filter/sort, column hide, real-time sync, or record-detail modal — those are Stories 3.3–3.6. Add/delete only.
- Delete is soft only (`deleted_at`). Do NOT hard-delete, and do NOT build any restore/trash/undo-history UI (out of scope).
- Do not modify the write/read logic of `mutate.ts`, `records.ts` (`listRecords`/`getSchema`), `overrides.ts`, `format.ts`, or `types/db.ts`. Do not add a new field `type` or a `required` flag to the schema.
- Do not reuse or modify `DemoDashboard.tsx` or `RecordDetail.tsx` (the pre-auth demo, Story 1.6); mirror their field-input pattern only.
- Never expose raw errors, stacks, SQL, or LLM output to the client; every failure resolves to a translated code via the `{ data, error }` envelope.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open inline quick-add | active table with N visible fields | an inline new row (desktop) / card (mobile) appears at the top with one labelled input per visible field, control matching each `field.type` | N/A |
| Expand to modal | inline quick-add in progress | "expand / open full form" reopens the same form in a Radix modal with the in-progress draft preserved | N/A |
| Submit valid add (either path) | all/most fields filled | `POST /api/records` inserts via `mutate`; row appears optimistically, then reconciles to server `id`/`version` on settle | N/A |
| Submit add with blank fields | some fields left empty | blank fields are omitted from `data` (no value written); the record is still created | N/A |
| Submit add, invalid number | non-numeric text in a `number`/`currency` field | inline `role="alert"` under that field; no POST until corrected | client-side pre-POST validation |
| Delete a record | user triggers delete, then confirms in the dialog | on confirm, record is removed from the view optimistically (soft-delete), settles on server confirm; cancel closes the dialog with no write | N/A |
| Add or delete rejected by server | POST/DELETE returns an error envelope | optimistic change rolls back; a translated non-technical message is shown; query is invalidated | rollback + message |
| Stale delete (version conflict) | record changed since load → 409 | delete rolls back; translated "record changed" message; query invalidated so the view shows current state | rollback + refetch |
| Unauthenticated API call | request with no valid session | `401 { data:null, error:'unauthorized' }` (API backstop; middleware already redirects the page) | envelope 401 |
| Non-member slug | valid session, slug the caller can't access | org lookup under RLS returns nothing → `403/404` envelope; no write attempted | envelope error |

</frozen-after-approval>

## Code Map

- `src/app/[slug]/page.tsx` -- MODIFY (minimal). Server component; keep all auth/redirect + slug→org RLS resolution + per-table `listRecords` fan-out into `recordsByTable` (~L41–75). Pass the route `slug` down to `<RecordsView slug={slug} ... />` so the client can key queries and call the API. Everything else unchanged.
- `src/components/dashboard/RecordsView.tsx` -- MODIFY. Client component; keep `activeIndex`, switcher, desktop `Table`/mobile card split, `react-swipeable`, and exported `clampTableIndex`. Add: `slug` prop; read the active table's rows via `useQuery(['records', slug, tableKey], ..., { initialData: recordsByTable[tableKey] })`; own the add-draft state + "expanded" flag; render the inline quick-add row/card (with the expand control) and the modal (`Dialog`) around the same `AddRecordForm`; render a per-record delete control (a new actions column on desktop `Table`, an action on each mobile card) that opens `DeleteConfirmDialog`; wire add/delete via the mutations hook.
- `src/components/dashboard/AddRecordForm.tsx` -- NEW. Presentation-agnostic schema-typed form body for the active table's visible fields: controlled `draft` + `onChange` (draft owned by `RecordsView` so inline↔modal preserves it), one input per visible field via the field-input helpers, real `<label htmlFor>`, inline `role="alert"` field errors, submit calling `useAddRecord` with a pending/disabled state. Rendered both inline (row/card) and inside the modal.
- `src/components/dashboard/DeleteConfirmDialog.tsx` -- NEW. Radix `dialog` confirming a soft-delete (translated title/body, confirm + cancel ≥48×48px); confirm calls `useDeleteRecord`, cancel closes with no write.
- `src/components/dashboard/useRecordMutations.ts` -- NEW. `useAddRecord(slug, tableKey)` and `useDeleteRecord(slug, tableKey)` hooks encapsulating the TanStack Query optimistic sequence (cancel → snapshot → optimistic → rollback → invalidate) against key `['records', slug, tableKey]`, calling the client fetch wrappers.
- `src/lib/forms/field-input.ts` -- NEW pure helpers (node-testable): `inputModeFor(type)` (mirror `RecordDetail`), `coerceAddValue(type, raw)` (empty → omit; number/currency must parse finite else error code; else trimmed text), `blankDraftForFields(fields)`, and pure cache updaters `applyOptimisticAdd(list, record)` / `applyOptimisticDelete(list, id)`.
- `src/lib/data/records-client.ts` -- NEW. Client-side fetch wrappers: `fetchRecords(slug, tableKey)` (GET), `createRecord(slug, tableKey, data, idempotencyKey)` (POST), `deleteRecord(slug, id, expectedVersion)` (DELETE). Each parses the `{ data, error }` envelope and throws a typed error carrying the server error code.
- `src/app/api/records/route.ts` -- NEW. `GET` (list by `slug` + `table`) and `POST` (create). Mirror `api/invite/route.ts`: `getCurrentUser()` → 401; Zod-validate body/query; `createServerSupabaseClient(await cookies())`; resolve org by slug under that RLS client (→ 403/404 if none); `mutate(identity, 'insert', tableKey, data, { idempotencyKey })`; `{ data, error }` envelope; `reportError` on 5xx; `export const dynamic = 'force-dynamic'`.
- `src/app/api/records/[id]/route.ts` -- NEW. `DELETE` — same auth/org resolution; `mutate(identity, 'delete', <tableKey?>, {}, { recordId: id, expectedVersion })`; map the mutate 409 to a `versionConflict` code.
- `src/app/providers.tsx` -- NEW client component. `QueryClientProvider` with a `QueryClient` held in `useState` (stable across renders). This is the 3.1-deferred provider seam.
- `src/app/layout.tsx` -- MODIFY. Wrap `children` with `<Providers>` (inside `NextIntlClientProvider` so query components still see translations). ~L30–42.
- `src/lib/data/mutate.ts` -- REFERENCE (do not modify). `mutate(identity, op, tableKey, data, opts?)`; `MutateIdentity = { client, actorId, orgId }`; `insertRecord` (idempotency, version 1), `deleteRecord` (soft-delete `deleted_at`, `expectedVersion`, 409 on mismatch).
- `src/lib/data/records.ts` -- REFERENCE. `listRecords(client, orgId, tableKey): ApiResponse<RecordData[]>` (excludes soft-deleted). Reuse in the GET route.
- `src/lib/auth/session.ts`, `src/lib/supabase/server.ts` -- REFERENCE. `getCurrentUser()`, `createServerSupabaseClient(cookieStore)`.
- `src/components/dashboard/RecordDetail.tsx` -- REFERENCE ONLY (do not import/modify). `inputModeFor` (~L372), `validateAndCoerce` (~L398), boolean radiogroup (~L238) — mirror for the add form's inputs.
- `src/types/api.ts` -- REFERENCE. `AppError(status, code)`, `ApiResponse<T> = { data, error }`.
- `src/components/ui/{dialog,input,label,button,form}.tsx` -- shadcn primitives present. (No `alert-dialog`, `switch`, or toast library — do not assume them.)
- `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- MODIFY. Add `SlugDashboard` keys (see Tasks) in both locales.

## Tasks & Acceptance

**Execution:**
- [x] `src/app/providers.tsx` -- create the client `Providers` wrapper holding a stable `QueryClient` via `useState`; wrap `QueryClientProvider`.
- [x] `src/app/layout.tsx` -- render `<Providers>` around `children` inside `NextIntlClientProvider`.
- [x] `src/lib/forms/field-input.ts` -- create the pure helpers: `inputModeFor`, `coerceAddValue`, `blankDraftForFields`, `applyOptimisticAdd`, `applyOptimisticDelete`.
- [x] `src/app/api/records/route.ts` -- implement `GET` (list by slug+table) and `POST` (create) mirroring the invite route (auth → Zod → RLS client → org-by-slug resolution → `mutate` insert → envelope).
- [x] `src/app/api/records/[id]/route.ts` -- implement `DELETE` (soft-delete via `mutate` with `recordId`+`expectedVersion`; map 409 → `versionConflict`).
- [x] `src/lib/data/records-client.ts` -- implement `fetchRecords`, `createRecord`, `deleteRecord` client wrappers parsing the envelope and throwing typed error codes.
- [x] `src/components/dashboard/useRecordMutations.ts` -- implement `useAddRecord` / `useDeleteRecord` with the optimistic sequence against `['records', slug, tableKey]`.
- [x] `src/components/dashboard/AddRecordForm.tsx` -- implement the presentation-agnostic schema-typed form body (controlled draft, real labels, per-field inline validation, pending submit) rendered both inline and in the modal.
- [x] `src/components/dashboard/DeleteConfirmDialog.tsx` -- implement the Radix confirm dialog gating the soft-delete.
- [x] `src/components/dashboard/RecordsView.tsx` -- add `slug` prop; switch the active table to `useQuery` (seeded with `initialData`); own the add-draft + expanded state; render the inline quick-add (row/card) with an expand control that opens the modal around `AddRecordForm`; render the per-record delete control (desktop actions column + mobile card action) that opens `DeleteConfirmDialog`.
- [x] `src/app/[slug]/page.tsx` -- pass `slug` to `<RecordsView>`; no other change.
- [x] `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- add `SlugDashboard` keys in both locales: add-entry/quick-add + expand-to-full-form labels, submit/cancel, delete control label, delete confirmation copy (title/body/confirm/cancel), invalid-number/empty field messages, and the write-failure + version-conflict messages. (Per-field input labels come from schema `field.label`, no new keys.)
- [x] `tests/unit/field-input.test.ts` -- unit-test every I/O & Edge-Case Matrix row reachable via the pure helpers: `coerceAddValue` (empty→omit, valid/invalid number, currency, text trim), and `applyOptimisticAdd`/`applyOptimisticDelete` cache updaters.
- [x] `tests/unit/records-api.test.ts` -- unit-test the route Zod body/query schemas (valid + rejected shapes) as pure schema checks (node env; no HTTP harness).

**Acceptance Criteria:**
- Given a logical table, when the user opens "Add Entry", then a form is generated from the table's visible `org_schemas` fields with a control matching each field's `type` and a real associated label (no placeholder-only labels).
- Given a completed add form, when the user saves, then the record is written through `mutate.ts` under the caller's RLS-scoped client with `actorId` set, appears optimistically in the active table, and reconciles to the server's id/version on confirmation.
- Given an existing record, when the user deletes it (per the chosen confirmation UX), then it is removed from the view via soft-delete (`deleted_at`) through `mutate.ts`, reflected optimistically.
- Given a failed write or delete, when the server rejects it, then the optimistic change rolls back and a translated, non-technical message is shown (never a raw error), and the query is invalidated.
- Given the dashboard, when it mounts, then the TanStack Query provider is active and the active table hydrates from server `initialData` with no extra initial fetch.

## Implementation Notes

- All 14 tasks implemented. After the Pass-1 review patches: `vitest run` 270/270 pass across 28 files (incl. `field-input.test.ts`, `records-api.test.ts`, the new `route-records.test.ts`, and the updated `records-view.test.tsx` wrapped in a `QueryClientProvider`); `npm run lint` clean; 3.2 code is type-clean.
- Pass-1 review patches (see Review Triage Log): optimistic add now appends to match `created_at`-asc order (no row-jump); added `tests/unit/route-records.test.ts` covering the handler 401/403/`versionConflict`/`writeFailed` branches; removed the orphan `collapseForm` i18n key (and an em-dash in `modalSubtitle`); delete control now ignores not-yet-settled optimistic rows via `isOptimisticId`.
- Route validators live in `src/app/api/records/schemas.ts` (a plain module, not the route files) so Next's typed-routes generator doesn't reject them as non-handler exports — and so the pure schema-shape tests can import them without an HTTP harness.
- DELETE route: `mutate`'s delete branch targets the row by id + org + version and ignores `tableKey`, so the route passes a `"record"` placeholder to satisfy the shared "valid table" guard. The guarded layer's 409 concurrency message is matched and remapped to the `versionConflict` code for a translated client message.
- `RecordsView` resets the lifted add-draft (and closes the modal) on active-table change via the render-time "adjust state on prop change" pattern (`draftTableKey` tracking), not an effect. Optimistic add prepends a temp-id row reconciled on invalidate; `refetchOnWindowFocus:false` avoids a redundant fetch over the seeded `initialData`.
- **Pre-existing build blocker (NOT introduced by 3.2, out of scope):** `npm run build` / `npx tsc --noEmit` fail only at the generated `.next/dev/types/app/api/claim/route.ts` because `src/app/api/claim/route.ts` exports a non-handler const (`CURRENT_POLICY_VERSION`, present at baseline `ae8e153`). `next dev` still runs. Logged to `deferred-work.md`; the fix (move that export to a helper module, the same pattern used here) belongs to a separate Epic-2 hygiene change.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-09-26) — blind-hunter, edge-case-hunter, verification-gap:

**Patched:**
- **medium → patch** — Optimistic add prepended the new row, but `listRecords` orders `created_at` ascending (records.ts:34), so the post-settle refetch moved it to the bottom — a visible top→bottom jump on every add (blind BH1). Fixed: `applyOptimisticAdd` now appends to match the authoritative order; test + docstring updated.
- **medium → patch** — The new `/api/records` handlers had only Zod-schema tests while every sibling route (`route-invite/claim/login/generate`) tests the handler; the 401 / 403-non-member / 409-`versionConflict`-remap / `writeFailed` branches were unverified, and the DELETE concurrency detection is an exact-string match against `mutate.ts` with no test pinning it (verification-gap VG1/VG2, blind BH6, edge EC4/EC5). Fixed: added `tests/unit/route-records.test.ts` (route-invite pattern) covering all those branches incl. the concurrency remap.
- **low → patch** — `SlugDashboard.collapseForm` was added to en/fr but referenced nowhere (the modal closes via the Dialog's built-in control) (blind BH8). Fixed: removed from both locales (also removed an em-dash in `modalSubtitle` per the project copy rule).
- **low → patch** — The per-record delete control rendered on not-yet-settled optimistic rows (`optimistic-*` id); confirming a delete before settle sent a temp id/version and surfaced a misleading "record changed" message (wider window on mobile LTE) (blind BH7, edge EC1). Fixed: `requestDelete` ignores optimistic rows via a centralized `isOptimisticId` in `useRecordMutations`.

**Deferred (see deferred-work.md):**
- **medium (unverified) → defer** — POST reconstructs `{ id, version, data }` from the *request* `data`, not the stored row; on an idempotency-key replay with different values, `mutate` returns the existing row's id/version while the route echoes the new data (blind BH3/BH4, edge EC3, verification-gap other). Transient — masked by the `onSettled` invalidate+refetch. Settling it needs `mutate` to return the stored row (out of scope).
- **low → defer** — No server-side validation of `data` against the table schema; `createBodySchema` accepts any keys/types and `mutate` stores verbatim (blind BH2). Low harm — own-tenant JSONB under RLS + `actorId`, no cross-tenant risk; `mutate` never validated payload shape (pre-existing). Schema-aware server validation is a larger hardening item.
- **low → defer** — `useQuery` destructures `data` only, so a failed authoritative background refetch leaves stale rows with no surfaced error (edge EC2). Non-destructive given `initialData` + optimistic writes; surfacing load errors is a nice hardening.

**Manual review (Playwright, post-commit) — patched:**
- **low → patch** — After a successful *modal* add reset the shared draft, the *inline* `AddRecordForm` kept a stale per-field validation error (`aria-invalid` + "Please enter a valid number." alert) on the now-empty field (its local `errors` state wasn't cleared by the external draft reset). Fixed: `RecordsView` bumps a `formResetKey` on add success (and on table change) passed as the React `key` of both `AddRecordForm` instances, so error state remounts fresh. Re-verified end-to-end in the browser (fail-inline → expand → correct-in-modal → submit → inline form clean).

**Rejected:**
- **low → reject** — Boolean fields write `false` when untouched, unlike blank scalars which are omitted (edge EC6). A boolean defaulting to `false` is a conventional valid value, not "blank"; omitting it would need touched-tracking state for negligible benefit.
- **low → reject** — A fully-blank submit creates an empty record (blind BH9). The record is deletable and empty-is-allowed follows from "all fields optional"; blocking it adds a guard for a minor, self-correctable action.
- **low → reject** — A garbage delete `id` is reported as `versionConflict` rather than not-found (blind BH10). Not reachable via the UI (ids come from the cache); distinguishing the two needs a `mutate.ts` change (out of scope) — its soft-delete inherently returns 0 rows for both.
- **false → reject** — `parseEnvelope` treats `data === null` as failure, rejecting a legitimate null-data 200 (edge EC7). No records route returns a success envelope with `data: null` (GET → `[]`, POST → the row, DELETE → `{ deleted: true }`); unreachable for the current contract.
- **low → reject** — The render-time draft/modal reset on active-table change fires while an add is pending (edge EC8). The in-flight add is bound to its original slug/tableKey and settles against the correct table; the reset is cosmetic and guarding it adds complexity for no correctness gain.
- **defer (noted)** — Interactive DOM (dialog open/submit/confirm/swipe) and the node-testable client wrappers/optimistic hooks remain unit-untested (verification-gap other). Consistent with the 3.1 no-jsdom precedent already in deferred-work; the route-handler portion is now closed by `route-records.test.ts`.

## Design Notes

- Build the add form (inline + modal) and the delete confirmation dialog with the `/web-uiux-architect` skill (per the build request): control styling, dialog composition, inline-adder layout across the responsive table+card split, mobile ergonomics, pending/disabled states, and motion — within the Boundaries. Respect `useReducedMotion` (framer-motion is available); keep parity with Story 3.1's tokens and the demo's field-input feel.
- Reuse the `RecordDetail` field-input shapes (boolean two-choice radiogroup; scalar text input with `inputMode` hint) but do not import that demo component — factor the shared, testable logic into `src/lib/forms/field-input.ts`. `coerceAddValue` differs from the demo's `validateAndCoerce` in one way: empty is allowed (the field is simply omitted from `data`), since the schema has no `required` flag.
- Keep `RecordsView` lean: the switcher/layout/swipe stays; per-table data + mutations move behind `useQuery`/the mutations hook. Server-fetched `recordsByTable` becomes `initialData`, preserving fast first paint (NFR-P3) with a clean seam for Story 3.3 (inline edit) and 3.6 (real-time invalidate) to build on the same query keys.
- No jsdom in this repo (Vitest node env). Interactive DOM (dialog open, submit, swipe, confirm) is verified by manual/Playwright review, not unit tests — matching the 3.1 precedent. Unit tests cover the extracted pure helpers and the route Zod schemas.

## Verification

**Commands:**
- `npm run lint` -- expected: passes, including the i18n/no-hardcoded-strings gate.
- `npx tsc --noEmit` -- expected: no type errors.
- `npm run build` -- expected: succeeds.
- `vitest run` -- expected: all pass, including the two new test files.

**Manual checks:**
- Signed-in member on a claimed org with a table: "Add Entry" opens a schema-typed form; saving shows the row instantly and it persists after refresh. Deleting a record removes it instantly (and stays gone after refresh). A forced server failure rolls the change back with a translated message. EN/FR toggle renders all new strings in both locales. Touch targets ≥48×48px on mobile.
