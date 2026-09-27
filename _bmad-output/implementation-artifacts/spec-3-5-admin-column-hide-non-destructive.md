---
title: 'Story 3.5: Admin Column Hide (Non-Destructive)'
type: 'feature'
created: '2026-09-27'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '7afc3ff8fe65d1070e5c4d0d3a30ef91b15fa05d'
story_key: '3-5-admin-column-hide-non-destructive'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-7-schema-explainability-one-tap-override.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-4-filter-sort-records.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An Admin on the claimed org's real dashboard has no way to declutter a table by removing a column from view. The read path already respects a field's `hidden` flag everywhere (table, cards, add-form, filter/sort), and the pure `hideField` transform exists (Story 1.7), but nothing lets an authenticated Admin toggle that flag and persist it — there is no authenticated schema-write path at all; the flag is only ever set session-only in the anonymous demo (FR11).

**Approach:** Add an Admin-only column visibility control on the authenticated dashboard that hides/unhides a field for the whole org by persisting an append-only `hidden` flag to `org_schemas.definition`. A new `POST /api/schema/columns` route (mirroring `api/records`) authenticates the session, enforces Admin via `requireAdmin`, and applies the change server-side through the pure `overrides` transforms under the caller's RLS-scoped client — never a destructive migration, never trusting a client-supplied full schema. On success the client calls `router.refresh()` so the server component re-reads the schema and the field drops out of (or reappears in) every view with its definition and stored values intact.

## Boundaries & Constraints

**Always:**
- Persist to `org_schemas.definition` (one row per org): the change applies to every member's views, survives reload, and is fully reversible (unhide flips `hidden` back to `false`; the field definition and all `records.data` are always preserved — append-only flag, no migration, no destructive change).
- Admin-only, enforced in **two layers**: (1) server — the route calls `requireAdmin(user, adminClient)` and rejects a Member with `403 forbidden` before any write; (2) client — `RecordsView` receives the caller's `role` as a prop and renders the control only when `role === "admin"`. Server enforcement is the real security boundary. (Decision.)
- The endpoint accepts a **targeted patch** `{ slug, tableKey, fieldKey, hidden: boolean }` only. The server reads the current definition, verifies the table+field exist, applies the pure `overrides` transform, and writes back the full definition — so the mutation is restricted to the `hidden` flag by construction; a client can never post an arbitrary schema. (Decision.)
- The write runs under the caller's RLS-scoped server client (as `api/records` does); the service-role admin client is used ONLY to read `org_members` inside `requireAdmin` (exactly as `api/invite` does). No new RLS policy — the existing `org_schemas_tenant_isolation` (`for all`, membership check) already permits a member's UPDATE.
- The control is a single Admin-only "Columns" manager (a popover) in the toolbar row that lists **every** field of the active table, including already-hidden ones, each with a show/hide toggle — so it works identically on desktop and mobile (cards have no headers) and unhide is always reachable. Toggling is one action, no confirmation dialog (reversible, non-destructive — mirrors 1.7). Build every visual/interaction surface via the `web-uiux-architect` skill. (Decision.)
- After a successful toggle the client calls `router.refresh()` to re-pull the server-rendered schema; there is no client-side optimistic schema cache (schema is a server prop, not TanStack state — the epic's optimistic mandate covers record CRUD, not rare admin schema edits). A failed toggle surfaces a translated non-technical message (reuse the existing API error-code→string mapping) and changes nothing. (Decision.)
- New user-facing strings resolve through `useTranslations("SlugDashboard")` in `en.json` + `fr.json` (i18n CI gate), no em-dashes. Controls are keyboard-operable, `focus-visible`, ≥48×48px on touch, with ARIA (a hidden field is announced as hidden).
- Pure hide/unhide logic stays in `src/lib/schema/overrides.ts` and is node-unit-tested; the DB read-modify-write wrapper and the interactive DOM are verified by the post-commit Playwright review, per the 3.1–3.4 precedent (repo has no jsdom).

**Never:**
- No destructive migration, column drop, data deletion, or runtime DDL. No new `org_schemas.version` column and no schema migration — concurrency is last-writer-wins (accepted: admin schema edits are rare and non-destructive; the server read-modify-write minimizes the window). (Decision.)
- No table hide/rename or field rename (Story 1.7 owns those; out of scope here). No add/remove field or table (Epic 5). No relationship-field handling and no `displayField` guard — 3.5 does not special-case the table `displayField`, because no relation consumer exists yet; the "cannot hide a targeted displayField" guard belongs to Story 3.7 when targeting is introduced. (Decision.)
- No service-role key on the write path; never trust a client-supplied org id or full schema. Do not modify `DemoDashboard.tsx`, the claim/provision schema path (`provision.ts`, `claim.ts`), `mutate.ts`, or the records read/write path.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior | Error Handling |
|----------|--------------|-------------------|----------------|
| Admin hides a visible column | Admin toggles a field off | `hidden: true` persisted to `org_schemas`; column drops from desktop table, mobile cards, add-form, and filter/sort options for all org members after refresh; definition + stored values intact | N/A |
| Admin unhides a hidden column | Admin toggles a hidden field on | `hidden: false` persisted; the column and its previously stored data reappear unchanged | N/A |
| Member views dashboard | Session role = member | The Columns control is not rendered | N/A |
| Member/non-member calls endpoint directly | Authenticated non-admin POSTs a valid body | `403 forbidden`, no write | Translated forbidden message |
| Unauthenticated call | No/invalid session | `401 unauthorized`, no write | Translated unauthorized message |
| Unknown table/field | Body references a missing `tableKey`/`fieldKey` | `400`, no write | Translated generic message |
| Hide the last visible column of a table | Only one visible column remains | Allowed; the table renders with no columns but is fully recoverable — the Columns manager still lists the hidden field for unhide (deliberate; mirrors 1.7's last-field decision) | N/A |
| Concurrent hides by two admins | Two admins toggle different fields at once | Both writes succeed; last write wins on the full definition (accepted limitation) | N/A |

</frozen-after-approval>

## Code Map

- `src/lib/schema/overrides.ts` -- MODIFY. `hideField(schema, tableKey, fieldKey)` (sets `hidden: true`) exists and is reused. ADD `showField(schema, tableKey, fieldKey)` mirroring it (sets `hidden: false`), pure and immutable. Do not change `hideTable`/`renameField`/`renameTable`/`visibleTables`/`canHideTable`.
- `src/lib/data/schema-mutate.ts` -- NEW guarded wrapper. `setFieldVisibility(identity, tableKey, fieldKey, hidden)` where `identity = { client, actorId, orgId }` (same shape as `mutate.ts`): read current schema via `getSchema(identity.client, identity.orgId)`; if the table/field is absent → `AppError(400, "genericError")`; apply `hideField`/`showField`; UPDATE `org_schemas` `{ definition, updated_at }` `.eq("organization_id", identity.orgId)` under the RLS client; return `ApiResponse`.
- `src/app/api/schema/columns/route.ts` -- NEW. `POST` handler modeled on `src/app/api/records/route.ts`: `getCurrentUser()` → 401; parse body with the new zod schema; `requireAdmin(user, createAdminClient())` → 403 for a member (as `api/invite/route.ts` does); `resolveIdentity(slug, user.id)` (copy the helper from `records/route.ts`) → RLS client + orgId; call `setFieldVisibility`; return `{ data, error }`; `handleError` maps `AppError`/unknown to the envelope, `reportError` on 5xx.
- `src/app/api/schema/columns/schemas.ts` -- NEW. Zod body: `{ slug: string, tableKey: string, fieldKey: string, hidden: boolean }` (mirror `src/app/api/records/schemas.ts`).
- `src/app/[slug]/page.tsx` -- MODIFY. Resolve the caller's `role` (mirror `src/app/[slug]/layout.tsx`'s `resolveUserOrgMembership` usage) and pass `role={role}` into `<RecordsView>` (L97-103). Nothing else changes; `tables` already carries each table's full `fields` (incl. hidden) because `visibleTables` filters only tables.
- `src/components/dashboard/RecordsView.tsx` -- MODIFY. Add a `role: MemberRole` prop. When `role === "admin"`, render `<ColumnVisibilityControl>` in the toolbar region alongside `RecordsToolbar` (~L374-385), passing `activeTable` (full `fields`), `slug`, and an `onToggled` callback that runs `router.refresh()` (import `useRouter` from `next/navigation`) and surfaces a translated error on failure. Do not change the existing `!field.hidden` filters in `RecordsTable`/`RecordsCards` (L618/L738) or the add/edit/sort/filter wiring.
- `src/components/dashboard/ColumnVisibilityControl.tsx` -- NEW via `web-uiux-architect`. Admin-only popover: lists every `activeTable.fields` entry (including hidden) with its `label`, a hidden badge, and a show/hide toggle; on toggle POSTs to `/api/schema/columns` and calls `onToggled(hidden)`; pending + error states; shadcn `Popover`/`Button`/`Switch` + Lucide (`Columns3`/`Eye`/`EyeOff`); ≥48×48px, `focus-visible`, translated ARIA.
- `src/lib/auth/rbac.ts` -- REFERENCE. `requireAdmin(user, adminClient)` (reads `org_members`, throws 401/403); `resolveUserOrgMembership` for the role prop; `MemberRole` re-exported from `@/types/db`.
- `src/lib/data/records.ts` -- REFERENCE. `getSchema(client, orgId)` (L58-81) returns `ApiResponse<SchemaDefinition>`; reuse to read the current definition server-side.
- `src/lib/supabase/{server,admin}.ts`, `src/lib/auth/session.ts`, `src/types/api.ts` -- REFERENCE. RLS client, admin client (org_members read only), `getCurrentUser`, `ApiResponse`/`AppError`.
- `src/types/db.ts` -- REFERENCE. `FieldDefinition.hidden?`, `SchemaDefinition`, `MemberRole = "admin" | "member"`.
- `src/components/ui/{popover,button,switch}.tsx` -- shadcn primitives (add `switch` via CLI New York/zinc if absent).
- `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- MODIFY. Add `SlugDashboard` keys (see Tasks).
- `tests/unit/overrides.test.ts` -- MODIFY. Add `showField` + hide/unhide round-trip + immutability cases.
- NOT TOUCHED: `DemoDashboard.tsx`, `provision.ts`, `claim.ts`, `mutate.ts`, records read/write, `supabase/migrations/*` (no schema change).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/schema/overrides.ts` -- add pure immutable `showField` (set `hidden: false`); reuse existing `hideField` -- one tested source of hide/unhide logic.
- [x] `tests/unit/overrides.test.ts` -- add cases: `showField` unhides, hide→show round-trip restores exactly, input never mutated, unknown table/field is a no-op.
- [x] `src/lib/data/schema-mutate.ts` -- NEW `setFieldVisibility(identity, tableKey, fieldKey, hidden)`: guarded read-modify-write on `org_schemas` under the RLS client; 400 on unknown table/field; returns `ApiResponse`.
- [x] `src/app/api/schema/columns/schemas.ts` + `src/app/api/schema/columns/route.ts` -- NEW `POST` route: session → 401; `requireAdmin` → 403; `resolveIdentity(slug)`; call `setFieldVisibility`; `{ data, error }` envelope with reused error codes; `reportError` on 5xx.
- [x] `src/app/[slug]/page.tsx` -- resolve the caller `role` and pass it to `RecordsView`.
- [x] `src/components/dashboard/RecordsView.tsx` -- accept `role`; render `ColumnVisibilityControl` for admins in the toolbar row; wire `router.refresh()` on success and a translated error on failure.
- [x] `src/components/dashboard/ColumnVisibilityControl.tsx` -- NEW (via `web-uiux-architect`): Admin-only popover listing all fields (incl. hidden) with show/hide toggles, pending/error states, a11y, 48×48px, translated. Add shadcn `switch` if missing.
- [x] `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- add `SlugDashboard` keys in both locales: columns-manager button/label, per-field show/hide toggle label + ARIA, hidden badge, and a toggle-failure fallback message. No em-dashes.

**Acceptance Criteria:**
- Given an Admin viewing a table, when they hide a column, then it disappears from all table and card views for the org and the underlying field definition and all stored values remain intact (append-only flag, no destructive migration) (FR11).
- Given a hidden column, when an Admin unhides it, then the column and its previously stored data reappear unchanged.
- Given a Member, when they view the dashboard, then the hide/unhide control is not available to them, and a direct call to the endpoint by a non-admin is rejected with `403` before any write (per Epic 2 RBAC).
- Given the change is persisted, when any other org member loads the dashboard, then they see the same hidden/visible column state.
- Given `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, then all pass, including the new `overrides` cases; no service-role key reaches the write path or a client bundle; no hardcoded user-facing strings; controls are keyboard-operable and screen-reader labelled (WCAG AA).

## Implementation Notes

**Delivered.** All eight execution tasks complete; `type-check`, `lint`, and `vitest run` (344 pass) all green.

- **`overrides.ts`** — added pure, immutable `showField` (sets `hidden: false`), the exact inverse of the existing `hideField`. `tests/unit/overrides.test.ts` gains a `showField` block: unhide sets the flag, hide→show round-trip preserves the field definition (key/label/type) exactly, the input is never mutated, and an unknown table/field is a no-op.
- **`schema-mutate.ts`** (NEW) — `setFieldVisibility({ client, actorId, orgId }, tableKey, fieldKey, hidden)`: reads the org's current definition via `getSchema` under the RLS client, 400s (`genericError`) if the table/field is absent, applies `hideField`/`showField`, then UPDATEs `org_schemas` `{ definition, updated_at }` `.eq("organization_id", orgId)`. Identity-agnostic like `mutate.ts`; never touches the service-role key. Throws `AppError` on failure (route maps it), returns `{ data, error: null }` on success.
- **`api/schema/columns/{schemas,route}.ts`** (NEW) — `POST` modeled on `api/records`: `getCurrentUser()` → 401; Zod-validate `{ slug, tableKey, fieldKey, hidden }`; `requireAdmin(user, createAdminClient())` → 403 (admin client used ONLY for the `org_members` read, exactly as `api/invite`); `resolveIdentity(slug)` builds the RLS client + org id; `setFieldVisibility` runs the write; `{ data, error }` envelope with `reportError` on 5xx.
- **`[slug]/page.tsx`** — resolves the caller's `role` via `resolveUserOrgMembership` (mirrors the layout), defaulting to `"member"` when membership doesn't resolve to this slug, and passes `role` to `RecordsView`.
- **`RecordsView.tsx`** — new `role` prop; renders `<ColumnVisibilityControl>` beside `RecordsToolbar` only when `role === "admin"`; `onToggled` clears any message and calls `router.refresh()` (from `next/navigation`), `onError` surfaces a translated message via the existing `StatusMessage`.
- **`ColumnVisibilityControl.tsx`** (NEW) — Admin-only shadcn `Popover` listing every `activeTable.fields` entry (including hidden) with an Eye/EyeOff icon, label, a "Hidden" badge, and a `Switch`; per-row pending spinner; POSTs the targeted patch and reports errors through the reused `RecordApiError` code→string mapping. 48×48px switch cell, `focus-visible`, translated ARIA (`columnsShowAria`/`columnsHideAria`), New York/zinc baseline, CSS-first motion.
- **shadcn `switch`** — added `src/components/ui/switch.tsx` (radix-ui unified `Switch`, mirrors the existing `checkbox.tsx` convention); no `package.json` change (radix-ui already present).
- **i18n** — new `SlugDashboard` keys in EN + FR (211/211 parity, valid JSON, no em-dashes): `columnsManager`, `columnsManagerBody`, `columnsHiddenBadge`, `columnsShowAria`, `columnsHideAria`, `columnsToggleFailed`, `columnsToggleForbidden`.
- **Test wiring** — `records-view.test.tsx` gains a `next/navigation` `useRouter` mock (now called unconditionally) and `role="member"`; `slug-dashboard-page.test.tsx` mocks `@/lib/supabase/admin` + `@/lib/auth/org.resolveUserOrgMembership`.

**web-uiux-architect pass (orchestrator-side).** Per the explicit story request, the `/web-uiux-architect` skill was run over `ColumnVisibilityControl.tsx` + its `RecordsView` integration. The implementation subagent had already built the surface within the shadcn New York/zinc baseline (semantic theme tokens → dark-mode safe, Lucide icons, `cn()`, CSS-only motion via `animate-spin`, `useId` ARIA, `size-12` tap cells, translated `aria-label`s). The skill pass added the missing micro-interaction feedback: a CSS `transition-colors hover:bg-muted/50` on each field row and `cursor-pointer` + `transition-colors` on the field label (which toggles its switch), so every row now signals interactivity. No FM introduced (CSS-first rule); baseline unchanged.

**Test strengthening.** Added two `records-view.test.tsx` assertions covering the RBAC render gate (matrix row "Member views dashboard"): the `Columns` control is absent for `role="member"` and present for `role="admin"` (verified via the mocked-key markup in the node SSR renderer). Suite now **344 pass** (30 files); `tsc` and `lint` re-run clean after the UI refinements.

**Review patches applied (pass 1).** Three findings routed to `patch` and were applied in place (no intent_gap/bad_spec → no loopback):
- **Security:** `route.ts` now captures `requireAdmin`'s membership and 403s unless `membership.slug === slug`, closing the slug-agnostic gate (an Admin of another org can no longer edit this org's schema). Mirrors the check `page.tsx` already applies.
- **Route test:** added `tests/unit/route-schema-columns.test.ts` (mirrors `route-invite`/`route-records`) — 401 / 400 (bad body, non-boolean) / 403 (member) / 403 (no membership) / 403 (admin-of-other-org slug mismatch) / 200 happy path with RLS identity / 500 writeFailed / 400 genericError.
- **Data-layer test:** added `tests/unit/schema-mutate.test.ts` (mirrors `mutate.test.ts`) — hide/unhide re-derived UPDATE payload + org scoping, unknown table/field → 400 no write, read failure → 500, DB error → 500 writeFailed with no raw-message leak.

**Verification after patches.** `tsc` clean, `lint` clean, `vitest run` **359 pass** (32 files).

**Automated vs manual.** Route auth/RBAC HTTP behavior (401/403/400/500) is now unit-tested through the real `requireAdmin`; the pure hide/unhide transforms and the client-side RBAC render gate are unit-tested. Only the live popover/switch DOM interaction remains manual (no jsdom), verified by the post-commit Playwright review (3.1–3.4 precedent); it is logged in deferred-work.md.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-09-27) — blind-hunter, edge-case-hunter, verification-gap:

**Patched:**
- **medium → patch** — Slug-agnostic Admin gate (blind #1, edge #1/#4). VERIFIED against `rbac.ts:43-46` + `org.ts:89-99`: `requireAdmin` resolves the caller's MOST-RECENT `org_members` row (`created_at DESC`, slug-agnostic) and the route discards its return (`route.ts:154`); `resolveIdentity(slug)` then scopes the write under RLS, and `org_schemas_tenant_isolation` is membership-based, not admin-based. So a user who is Admin of org A (most-recent) but only Member of org B could POST `slug=org-B` and edit org B's schema — contradicting the matrix "non-admin → 403" and the "requireAdmin is the real security boundary" claim, and inconsistent with `page.tsx` which does check `membership.slug === slug`. Latent today (single-org membership only, per `org.ts`), hence medium. Fix: capture `requireAdmin`'s membership and 403 unless it resolves to the requested `slug`.
- **medium → patch** — New route `/api/schema/columns` has no route test (verif #1, blind #4). VERIFIED: repo convention locks sibling routes in node without jsdom (`route-invite.test.ts`, `route-records.test.ts` cover 401/403/400/200/500); none exists here. Add `route-schema-columns.test.ts` covering those rows, including the member-of-target case that pins the security fix.
- **medium → patch** — `setFieldVisibility` has no data-layer test (verif #2). VERIFIED: sibling guarded layer `mutate.ts` has `mutate.test.ts` (fake Supabase client); `schema-mutate.ts` has none. Add `schema-mutate.test.ts`: missing field → 400 no write; happy-path re-derived UPDATE payload + org scoping; DB error → 500 `writeFailed` with no raw-message leak.

**Deferred (see deferred-work.md):**
- **low → defer** — Interactive client toggle behavior (`postFieldVisibility`/`handleToggle`/error mapping) unverified (verif #3). The repo test env is node/`renderToStaticMarkup` with no jsdom, so client-interaction tests aren't in the project's verification path; covered by the post-commit Playwright review. Pre-existing tooling limitation, not introduced by this story.

**Rejected:**
- **false** — French `columnsHiddenBadge` "Masquée" gender (blind #7): correct feminine agreement with "colonne"; the standalone badge form is intended.
- **low → reject** — `resolveErrorMessage` explicit `writeFailed` case duplicates `default`, and a 400 `genericError` maps to the transient "try again" message (blind #2): the 400 (unknown table/field) and parse-failure paths are unreachable from the UI (it only offers existing fields), so the mislabel never surfaces in everyday use; the dead branch is cosmetic.
- **low → reject** — All switches disable during any single in-flight toggle vs the "that one switch" comment (blind #3): the global lock is a safe single-flight guard preventing concurrent `router.refresh()` races; behavior is correct, only the comment is loose. Tied to the frozen `router.refresh` design.
- **low → reject** — Pending spinner clears before `router.refresh()` settles (blind #5): brief cosmetic gap; awaiting refresh completion adds complexity for negligible everyday impact.
- **low → reject** — `slug` accepted in the request body widens the trust surface (blind #6): mirrors the records route pattern; `resolveIdentity`'s RLS membership check plus the patched slug/admin cross-check make the body `slug` safe.
- **decision** — Last-visible-field has no backstop (edge #2): explicitly allowed by the frozen matrix ("Hide the last visible column → Allowed"; recoverable via the manager). Not a defect.
- **decision** — Concurrent-write last-writer-wins (edge #3): explicitly accepted in the frozen Boundaries/matrix (no version column). Not a defect.
- **low → reject** — `page.tsx` role slug-mismatch fallback branch untested (verif "other"): the branch is unreachable today (single-org) and fail-safe (defaults to "member" = least privilege); the server route is the gate.

## Design Notes

- **Read side is already done.** `[slug]/page.tsx` loads the schema server-side and `RecordsView`/`RecordsTable`/`RecordsCards`/`AddRecordForm`/`filter-sort` already drop `hidden` fields. 3.5 only adds the *write + Admin gate + refresh*; do not re-implement filtering.
- **Why server-side read-modify-write, not a client full-schema POST.** Restricting the endpoint to `{tableKey, fieldKey, hidden}` and re-deriving the definition from the stored schema means a compromised/buggy client can never rewrite arbitrary schema; the mutation surface is exactly one boolean flag on one existing field.
- **Why `router.refresh()` and not TanStack.** The schema is a server-component prop, not a query — records are the only TanStack-cached server state. `router.refresh()` re-runs `[slug]/page.tsx`, which re-reads `org_schemas`; the field then drops/reappears through the existing `!hidden` filters. No optimistic schema cache is warranted for a rare admin op.
- **Admin gate mirrors invite.** `requireAdmin(user, createAdminClient())` reads `org_members` (the DB source of truth, not JWT) exactly as `api/invite`; the RLS client handles the actual `org_schemas` UPDATE, and `org_schemas_tenant_isolation` scopes it to the caller's org.

## Verification

**Commands:**
- `npm run lint` -- expected: passes, incl. the i18n/no-hardcoded-strings and no-service-role-in-client gates.
- `npx tsc --noEmit` -- expected: no new type errors (pre-existing `api/claim` typed-route blocker is logged in deferred-work; `next dev` runs).
- `npx vitest run` -- expected: all pass, incl. the new `overrides` hide/unhide cases.

**Manual checks:**
- Signed-in Admin on a populated table: open the Columns manager, hide a column (it vanishes from desktop table + mobile cards + add-form + filter/sort choices), reload → still hidden; unhide it → column and data return. As a Member (second session), the control is absent and the hidden state matches. EN/FR toggle renders all new strings; touch targets ≥48×48px; keyboard-operable. Post-commit Playwright review on the authed fixture per 3.1–3.4 precedent.
