---
title: 'Story 5.1: Add a Column via Chat'
type: 'feature'
created: '2026-10-01'
status: 'done'
route: 'dispatch'
baseline_commit: 'beafc83a9a181cffeaa5032e0158c8258ad9aedf'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After claiming an app, an Admin has no way to evolve its structure conversationally. Adding a column means there is no screen for it at all, and the only schema-shaping path (the generation pipeline) is a one-shot at creation time. Epic 5's whole premise is "grow your app by chatting," and the first, safest increment of that is adding a column.

**Approach:** Introduce an Admin-only floating "AI Assistant" chat on the dashboard. An Admin types a plain-language request ("add a warranty date to Jobs"); the server routes it through the existing hardened Gemini client, turns it into a structured `add_field` operation, runs it through the Schema Validator, and persists it as an append-only metadata edit to `org_schemas.definition`. Existing record rows are never touched. The LLM is never a dependency for core CRUD.

## Boundaries & Constraints

**Always:**
- Every LLM call goes through `callGeminiWithTimeout` with `HARDENED_SYSTEM_PROMPT` injected (100% of calls).
- Every operation passes synchronous Schema Validation before any write; in this story only a single `add_field` (scalar type) is accepted.
- Changes are append-only metadata edits to `org_schemas.definition`. Existing `records` rows are never migrated, mutated, or deleted; new fields simply start absent from existing rows' `data`.
- Admin-only: the chat is hidden for Members, and the endpoint enforces `requireAdmin` server-side (never trust the client).
- When the target table is not named and cannot be unambiguously inferred from the currently-viewed table, the editor asks a clarifying question and writes nothing until the target is confirmed. It never silently guesses.
- On an unambiguous request the field is applied immediately once it validates; the success message carries a one-tap Undo that hides the just-added column (reusing the append-only hide flag). Undo never deletes: the field definition is retained, only marked `hidden`.
- On LLM timeout/failure the editor degrades gracefully with a translated message; record view/add/edit/delete remain fully available.
- No raw JSON, SQL, schema object, error, or stack is ever shown to the user — on success, clarification, decline, or failure.
- All user-facing copy is translated (en + fr) and contains no em-dash.

**Never:**
- No `add_table`, `add_view`, delete, rename, or any non-`add_field` operation in this story (deferred to Stories 5.2 / 5.3 / 5.5). Such requests get a friendly, non-technical decline.
- No relation-type fields via chat (relation fields have a dedicated flow in Story 3.7). Scalar types only.
- No server-side persistence of chat conversation history; the conversation is ephemeral per browser session and sent with each request.
- No raw SQL generated or executed; any SQL in LLM output is treated as a validation rejection.
- Do not touch `organization_id`, auth tables, or RLS; do not weaken tenant isolation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add column, explicit table | Admin: "add a warranty date to Jobs"; `jobs` exists | Validated `add_field` (key `warranty_date`, type `date`) persisted to `org_schemas`; chat confirms in plain language with a one-tap Undo; dashboard schema refreshes to show the new column | N/A |
| Add column, target inferred | Admin viewing `jobs`: "add a price field" | Target inferred as `jobs` (current table, unambiguous); field applied (type inferred, e.g. `currency`) with Undo offered | N/A |
| Undo a just-added column | Admin taps Undo on the success message | The field is hidden via the append-only visibility flag (reusing `setFieldVisibility`); definition and any data retained; column disappears from view | N/A |
| Ambiguous target | Admin: "add a price field"; no current table or multiple plausible | Chat asks "Which table should Price go on — Jobs, Invoices, or Clients?"; nothing written; next answer resolves and applies | Nothing persisted until confirmed |
| Duplicate / reserved / keyword name | Field collides with existing field, a reserved key (`id`, `data`, ...), or contains a blocked keyword/SQL | Validator rejects; user sees the fixed plain-language rejection copy; nothing written; rejection logged to Sentry with `organization_id` + raw LLM output | Rejection is total |
| Out-of-scope request | Admin: "delete the status column" / "add a table" | Friendly non-technical decline naming what the chat can do now (add a column); nothing written | N/A |
| LLM timeout / unavailable | Gemini times out (15s) or errors | Translated "assistant unavailable, try again" message; no write; CRUD unaffected | Caught; no raw error shown |
| Member opens dashboard | Current user role is `member` | Chat pill not rendered; direct endpoint call returns 403 | 403 `forbidden` |

</frozen-after-approval>

## Code Map

Reuse (do not change behavior):
- `src/lib/gemini/client.ts` — `callGeminiWithTimeout<T>(userPrompt, responseSchema, timeoutMs=15000)`: injects `HARDENED_SYSTEM_PROMPT`, enforces JSON, hard 15s timeout.
- `src/lib/gemini/prompts.ts` — `HARDENED_SYSTEM_PROMPT` (always injected; do not edit). Add `buildAddFieldPrompt(...)` here.
- `src/lib/schema/validator.ts` — `validateGeneratedSchema`; blocked-keyword list (`DROP|GRANT|TRUNCATE|DELETE|EXEC`); reserved-keys (`id, organization_id, table_key, data, created_at, updated_at, deleted_at`). Add the scalar `add_field` validator here, reusing those lists.
- `src/lib/utils.ts` — `normalizeTableName(input)` to derive the field `key`.
- `src/types/db.ts` — `FieldDefinition` (key, label, type, reason?, hidden?, sensitive?), `TableDefinition`, `SchemaDefinition`. Allowed scalar types: `text|number|date|datetime|boolean|currency|email|phone` (exclude `relation`).
- `src/lib/schema/overrides.ts` — pure transforms (`hideField`, `addRelationField`). Add pure `addField(schema, tableKey, field)` mirroring `addRelationField`.
- `src/lib/data/schema-mutate.ts` — `setFieldVisibility`, `addRelationField(identity, tableKey, input)`: the read-validate-transform-write-under-RLS pattern. Add `addField(identity, tableKey, input)`.
- `src/lib/data/records.ts` — `getSchema(client, orgId)`.
- `src/lib/auth/rbac.ts` `requireAdmin(user, adminClient)`; `src/lib/auth/session.ts` `getCurrentUser()`; `src/lib/api/route-helpers.ts` `requireUser`, `resolveWritableAdminIdentity`, `json`, `handleError`.
- `src/lib/supabase/server.ts` `createServerSupabaseClient` (RLS); `src/lib/supabase/admin.ts` `createAdminClient` (membership check only).
- `src/lib/observability/report.ts` — `reportRejection(reason, { organization_id, raw_llm_output })` for rejections; `reportError` for 5xx.
- `src/lib/i18n/{en,fr}.json` — add a `ChatAssistant` namespace (`useTranslations`/`getTranslations`).
- `src/components/ui/*` — Button, Input, Dialog (Radix + Tailwind v4 + CVA); Framer Motion + Lucide available.
- `src/app/[slug]/layout.tsx` — resolves role server-side; mount point for the admin-gated chat. `src/components/dashboard/RecordsView.tsx` holds the selected table (the "currently-viewed table").
- `src/app/api/schema/columns/route.ts`, `src/app/api/generate/route.ts` — reference route shape, zod `safeParse`, `export const dynamic = "force-dynamic"`.

New files: `src/app/api/schema/add-field/{route.ts,schemas.ts}`; `src/components/chat/{ChatAssistant,ChatPanel,MessageBubble}.tsx`; `src/components/dashboard/ActiveTableProvider.tsx`; `src/lib/data/schema-chat-client.ts`; `tests/unit/schema-add-field.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/schema/validator.ts` -- add `validateAddField(schema, tableKey, input): { valid: true; field: FieldDefinition } | { valid: false; reason }` -- validates table exists, derives `key` via `normalizeTableName`, rejects reserved keys, existing-field collisions, blocked keywords/SQL, and non-scalar/unknown types; reuses existing blocklist + reserved-key lists.
- [x] `src/lib/schema/overrides.ts` -- add pure `addField(schema, tableKey, field)` returning a new `SchemaDefinition` with the field appended; input never mutated.
- [x] `src/lib/data/schema-mutate.ts` -- add `addField(identity, tableKey, input)` -- read schema (`getSchema`), run `validateAddField`, apply `overrides.addField`, write full `definition` back under the RLS client; return `ApiResponse`.
- [x] `src/lib/gemini/prompts.ts` -- add `buildAddFieldPrompt(message, { tables, currentTableKey, conversation })` and the response schema -- instruct the model to return a discriminated result: `add_field` (tableKey, label, type) | `needs_clarification` (question) | `out_of_scope` (reply). Scalar types only; infer target only when unambiguous.
- [x] `src/app/api/schema/add-field/schemas.ts` -- zod schema for the request body (`slug`, `message`, `currentTableKey?`, `conversation?`), mapping errors to translated keys.
- [x] `src/app/api/schema/add-field/route.ts` -- `POST`: `requireUser` -> `requireAdmin` -> load schema -> `callGeminiWithTimeout` with `buildAddFieldPrompt` -> branch on model result: validate+persist (`schema-mutate.addField`), return clarification, or return decline. Validator rejections -> `reportRejection` + fixed rejection copy. LLM failure -> graceful degraded response. `export const dynamic = "force-dynamic"`.
- [x] `src/lib/data/schema-chat-client.ts` -- client fetch wrapper posting to the endpoint and returning the typed envelope.
- [x] `src/components/dashboard/ActiveTableProvider.tsx` -- client context exposing `activeTableKey` + setter; wraps dashboard content and the chat.
- [x] `src/components/dashboard/RecordsView.tsx` -- publish the currently-selected table key into `ActiveTableProvider`.
- [x] `src/components/chat/*` -- floating admin-only pill + iMessage-style panel: user/assistant bubbles, "thinking…" bubble, clarifying-question turn, success (with one-tap Undo), degraded/decline states (see Design Notes). Reads `activeTableKey`; holds ephemeral conversation; on success invalidates the schema query so the new column appears; Undo calls the existing column-hide path (`setFieldVisibility` via `src/app/api/schema/columns/route.ts`) for the just-added `tableKey`/`fieldKey`, then re-invalidates.
- [x] `src/app/[slug]/layout.tsx` -- mount `ActiveTableProvider` + `ChatAssistant`, rendering the chat only when `role === 'admin'`.
- [x] `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- add `ChatAssistant` strings (pill label, placeholder, thinking, rejection copy, decline, degraded, success template, clarification scaffolding). No em-dash.
- [x] `tests/unit/schema-add-field.test.ts` -- cover the I/O matrix validator rows: happy scalar add, reserved key, existing-field collision, each blocked keyword (incl. mixed-case/embedded), non-scalar/unknown type, nonexistent table; plus the pure `overrides.addField` transform (append + immutability).

**Acceptance Criteria:**
- Given an Admin on the dashboard, when the page renders, then a floating AI Assistant chat pill is fixed bottom-right; given a Member, then no pill renders and a direct endpoint call returns 403.
- Given an Admin submits "add a warranty date to Jobs", when processed, then the request passes through `callGeminiWithTimeout` with `HARDENED_SYSTEM_PROMPT`, yields a validated `add_field`, is validated before persistence, and a "thinking…" bubble shows during processing.
- Given a validated `add_field` is applied, when it persists, then `org_schemas.definition` gains the field and every existing `records` row is unchanged, and the new column becomes visible in the dashboard without a full reload; given the Admin then taps Undo, the column is hidden (definition retained) and disappears from view.
- Given a request without a resolvable target table, when processed, then the chat asks a clarifying question and nothing is written until the target is confirmed.
- Given the LLM is unavailable or times out, when the editor is used, then it degrades with a translated message and all Epic 3 CRUD remains available.

## Review Triage Log

Pass 1 (review_loop_iteration 0):

- [verification-gap] `schema-mutate.addField` write contract untested — **patch**. Pre-verified: the only persistence path for the editor; its siblings `setFieldVisibility`/`addRelationField` have write-contract tests but `addField` has none (route test mocks it; pure tests don't reach the DB write). A dropped `.eq("organization_id", orgId)` or write-on-rejection would ship green. Fix: add an `addField` block to `tests/unit/schema-mutate.test.ts`.
- [edge-case] Conversation >20 turns sent untrimmed → zod `.max(20)` → 400 → permanent "degraded" — **medium → patch**. Verified: `ChatPanel.tsx:86` maps all messages, no trim; `schemas.ts` caps at 20. Reachable after ~10 exchanges in one open session (recoverable by close/reopen, which clears ephemeral state). Fix: client sends `messages.slice(-20)`.
- [blind] Reserved-key test uses a local 7-element literal instead of the exported `RESERVED_KEYS` — **low → patch**. Direct, test-only correction that keeps coverage honest if the constant grows. Fix: iterate the imported `RESERVED_KEYS`.
- [blind] Stale `last_updated` format in sprint-status.yaml — **low, reject**. No harm; the new `DD-MM-YYYY (note)` form matches the file's own top-comment convention (`2026-09-30 (epic-7 done)`); it is a human note, not a parsed timestamp.
- [blind] Route test asserts `addField` called with `{actorId,orgId}` the route may not produce — **false**. The route tests run green (verified); `resolveWritableOrgIdentity` is the REAL (unmocked) helper and yields `actorId: user.id`, `orgId` from the RLS org read.
- [blind] Code Map names `resolveWritableAdminIdentity` but code uses `resolveWritableOrgIdentity` — **reject** (fix edits this build's spec). Code is correct and admin is enforced by the separate `requireAdmin` call.
- [blind] Duplicated scalar-type allowlist (`SCALAR_FIELD_TYPES` vs `GENERATION_FIELD_TYPES`) — **low, reject**. Continues the codebase's existing pattern (generation already mirrors the type union as a runtime array); the clean dedup needs a new shared module (adds surface / crosses schema→gemini layering) and the drift risk is low.
- [blind] Hardened system prompt injection untested — **false**. `client.ts:65` sets `systemInstruction: HARDENED_SYSTEM_PROMPT` unconditionally on every call; asserted in `tests/unit/gemini-generation.test.ts`. The route correctly mocks the client for isolation.
- [blind] Prompt injection via forged `conversation` assistant turns — **low, reject**. The caller is the authenticated Admin acting on their own org; any model output still passes `validateAddField` (allowlist, scalar type, reserved/blocked/collision, existing visible table). No trust boundary is crossed and nothing escapes the validator.
- [blind] Undo can hide any column, not only the just-added one — **false**. Undo reuses the existing Admin-gated `/api/schema/columns` hide path; an Admin can already hide any column there. No new capability or privilege.
- [blind] `successApplied` interpolation untested (route mocks `getTranslations`) — **low, reject**. Code is correct (`{field}`/`{table}` match the call site); the verification-gap layer did not flag it; fix only re-tests already-correct simple interpolation.
- [blind] No "no tables yet" handling — **low, reject**. Safe degradation (model returns clarify/decline, no write); near-unreachable since generation/fallback always provisions tables.
- [blind] `messageCounter` module-level global in `ChatPanel` — **low, reject**. Client-only component rendered after mount (no SSR of these ids → no hydration mismatch); monotonic ids are correct.
- [edge-case] Message >2000 chars → generic 400 → opaque "degraded" — **low, reject**. Uncommon for an add-a-column phrase; fix adds a branch + new copy for a rare input.
- [edge-case] Unreachable `if (!key)` empty-key branch; punctuation-only label accepted as `field_<hash>` — **low, reject**. The dead branch is harmless defensive code; a punctuation-only label is near-unreachable and reversible via Undo.
- [edge-case] `SELECT/INSERT/UPDATE/UNION` not in blocklist — **false / pre-existing**. `BLOCKED_KEYWORDS` is the Epic 1 list (not introduced here); keys are inert JSONB by design (the validator is structural, not SQL-injection defense). Owned by Story 5.4.
- [edge-case] Redundant double-normalize of `tableKey` — **false**. `normalizeTableName` is idempotent; no bad outcome.
- [edge-case claim] Task says `requireUser`; route uses `getCurrentUser()` + manual 401 — **reject** (fix edits this build's spec; behavior is identical).

Routing: no intent_gap or bad_spec entries, so no loopback. Three entries route to **patch** (distinct root causes: missing write-contract test; client does not cap conversation length; test uses a literal reserved-key list). All others rejected/false as above.

## Design Notes

Chat UI direction (from the web UI/UX architect pass; Tailwind v4, Radix, Framer Motion, Lucide, WCAG AA):
- **Collapsed pill:** `fixed bottom-6 right-6 z-50`, `size-14` rounded-full, glass treatment (`bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl border border-white/40`), soft lift (`shadow-xl shadow-black/5`), Lucide `Sparkles`/`MessageCircle` icon, `aria-label` + `sr-only` text, `focus-visible:ring-2`. Tap target ≥ 44px.
- **Expand:** panel ~`w-[22rem] max-h-[70vh]` anchored bottom-right. Use Framer Motion `AnimatePresence` for the open/close (exit animation is the justified FM use); spring `{ bounce: 0.2, duration: 0.5 }`. All in-panel hover/active/focus microstates are CSS (`transition-*`), not FM.
- **Panel:** header with title + close (Radix dialog semantics / `role="dialog"` + `aria-modal`, Esc to close, focus trap). Scrollable message list (8pt rhythm, `gap-3`, `p-4`). Composer = the "Smart Input" pattern (rounded-2xl input + send button, `Loader2 animate-spin` while pending, disabled during a send).
- **Bubbles:** user right-aligned (`bg-primary text-primary-foreground rounded-2xl rounded-br-sm`), assistant left-aligned (`bg-zinc-100 dark:bg-zinc-800 rounded-2xl rounded-bl-sm`), `text-pretty`, max-width ~85%. **Thinking bubble:** assistant-side three-dot CSS `@keyframes` pulse (no FM). **Clarification:** assistant bubble + optional quick-reply chips for the candidate tables. **Success:** assistant bubble with a subtle check accent and an inline one-tap **Undo** button (`focus-visible:ring-2`, ≥44px target) that hides the just-added column. **Decline / degraded:** assistant bubbles. Never render raw JSON or errors.

Server result contract (model -> route -> client): `{ kind: 'applied' | 'clarify' | 'declined' | 'rejected' | 'degraded', tableKey?, fieldKey?, label?, assistantText }`. On `applied`, the client keeps `tableKey`+`fieldKey` to drive Undo. Client maps `kind` to the bubble treatment; `assistantText` is always a translated, human string.

## Verification

**Commands:**
- `npm run test -- schema-add-field` -- expected: all new unit tests pass.
- `npm run type-check` -- expected: no type errors.
- `npm run lint` -- expected: clean.

**Manual checks:**
- As an Admin on the dashboard, open the pill, send "add a warranty date to Jobs", confirm the column appears in the Jobs table/card view and existing rows are intact. As a Member, confirm no pill renders.
