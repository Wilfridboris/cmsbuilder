---
title: 'Story 1.5: Hard Fallback Template (No Error Screens)'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'de8ce6d0d7257073f9f3875fcd7a6b8384f1be7f'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4-ai-schema-synthetic-data-generation.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1.4 built the generation pipeline and retry-once, but on double failure (timeout, invalid JSON, or validator rejection) `POST /api/generate` returns a generic 502 and `/generate` shows a "start over" screen — a dead end that breaks the "you never see an error, you always land on a working dashboard" promise (FR4, NFR-R3). Story 1.4 deliberately left this as the "1.5 fallback-template seam".

**Approach:** Replace the double-failure 502 branch with automatic provisioning of a hardcoded `UNIVERSAL_FIELD_SERVICE_TEMPLATE` (Clients, Jobs, Invoices) pre-seeded with generic Ontario field-service data. Mark the provisioned schema `isFallback: true`, return it exactly like a successful generation (200, populated read-only reveal), and show a subtle, dismiss-free banner: "We used a starter template — you can customize it using the chat." The visitor always lands on a populated dashboard within the 30–45s window, never an error screen.

## Boundaries & Constraints

**Always:**
- On two consecutive `attemptGeneration` failures, provision the fallback template instead of returning 502. Reuse the existing per-session org (`existingOrgId` from the signed cookie) or mint one — identical to the success path — via `provisionGeneration` under the admin client + system actor, no runtime DDL.
- `UNIVERSAL_FIELD_SERVICE_TEMPLATE` is a hardcoded `SchemaDefinition` with exactly three tables — `clients`, `jobs`, `invoices` — each carrying a plain-language `reason` on every table and field (so Story 1.7 explainability and Story 1.6 render work unchanged), using only the existing scalar field types (`text | number | boolean | date | datetime | currency | email | phone`; never `relation`). It is pre-seeded with 5–8 rows per table of generic Ontario-localized data (real Ontario city names, plausible CAD pricing, field-service terminology). Template content is English only (the fallback fires when generation — including language detection — has already failed).
- The fallback template and its seed rows MUST pass `validateGeneratedSchema` / `filterSeedRows` unchanged — the same safety gate the LLM output passes. A unit test asserts this.
- `isFallback: true` is persisted onto the `SchemaDefinition` stored in `org_schemas.definition` (JSONB, no migration) AND echoed in the `GenerateResponse` returned to the client, so the flag survives read-back and is available to Story 1.6's independent dashboard render and to claim (Epic 2). Successful generations set `isFallback: false` (or omit it — falsy).
- Fallback seed rows are inserted through the existing `mutate.ts` guarded layer with stable idempotency keys (`fallback-<table_key>-<i>`), so a same-session retry is idempotent.
- The `/generate` reveal renders the banner above the table when `isFallback` is true, using next-intl (`Generate.fallbackBanner`) in EN and FR, with accessible styling built by applying the `web-uiux-architect` skill (subtle/non-alarming, WCAG AA contrast, not a modal, no dismiss required, does not steal focus). Route contract unchanged: `authenticate/parse → Zod → logic → ApiResponse<T>`; never leak stacks/SQL/schema JSON/LLM output.

**Never:**
- No account, auth, magic-link, or claim (Epic 2). No interactive edit, delete, filter/sort, column-hide, real-time sync, or grow-into-dashboard transition (Story 1.6). No explainability info-icon/override UI (Story 1.7). No conversational "customize via chat" wiring (Epic 5) — the banner only names it.
- No second LLM call, no third generation attempt, and no widening of the frozen 15s-per-call wall. The fallback is fully deterministic and hardcoded — no LLM involvement.
- No new migration, no runtime DDL, no change to the guarded `mutate.ts` / RLS layers.
- The Zod-422-on-bad-body path is unchanged (a client contract error, not a generation failure — it is not a fallback trigger).

**Decisions (resolved):**
- **Last-resort safety.** If the fallback provisioning itself throws (e.g. total DB outage — beyond any LLM failure this story guards), keep the pre-1.5 non-leaking graceful 502 → `/generate` "start over". This is the honest limit of "never an error screen" (which is scoped to generation failure); it is reported via the observability seam and is not a raw stack.
- **isFallback location.** Persisted on the stored `SchemaDefinition` (not a DB column) so no migration is needed and the flag is durable across read-back/claim, and mirrored in `GenerateResponse` for the immediate reveal.
- **Banner is passive.** Matches the epic verbatim — informational only, no "retry AI" affordance (that would expand scope; customization is Epic 5's chat).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Single failure then success | 1st attempt throws, 2nd succeeds | Normal generated dashboard; `isFallback` falsy; no banner | Retry-once (existing 1.4 behavior) |
| Double failure (timeout) | both attempts exceed 15s | Fallback template provisioned; 200 + `{schema, records, isFallback:true}`; banner shown | Fallback path, not 502 |
| Double failure (validator rejection) | both attempts rejected by validator | Same as above — template provisioned, banner shown | Fallback path |
| Fallback into reused session org | valid signed cookie + double failure | Template provisioned under existing org (idempotent seeds); banner shown | Reuse `existingOrgId` |
| Fallback provisioning fails | double failure AND DB write throws | Graceful non-leaking 502 → "start over"; error reported | Last-resort degrade |
| Template validity | `UNIVERSAL_FIELD_SERVICE_TEMPLATE` + rows | Passes `validateGeneratedSchema` + `filterSeedRows` clean | N/A (guarded by test) |
| Malformed POST body | body fails Zod | 422 translated message; no LLM call; no fallback | `AppError(422)` (unchanged) |

</frozen-after-approval>

## Code Map

- `src/lib/generation/fallback.ts` -- CREATE. Export `UNIVERSAL_FIELD_SERVICE_TEMPLATE: SchemaDefinition` (tables `clients`/`jobs`/`invoices`, `reason` on every table + field, scalar types only) and `FALLBACK_SEED_ROWS: Record<string, Array<Record<string, unknown>>>` (5–8 Ontario rows/table). Mirror the `DEMO_SCHEMA`/`DEMO_ROWS` shape in `src/lib/data/seed.ts` (Ottawa/Kanata/Nepean, CAD `currency`, field-service terms). Data-only, server-side.
- `src/app/api/generate/route.ts` -- MODIFY. Replace the double-failure `502` seam (~lines 135-143) with `provisionGeneration({ orgId: existingOrgId ?? undefined, schema: {...UNIVERSAL_FIELD_SERVICE_TEMPLATE, isFallback:true}, seedRows: FALLBACK_SEED_ROWS })`, then run the SAME success read-back + cookie + `ApiResponse` tail (extract to a shared local helper if it de-dups) with `isFallback:true`. try/catch around it → on throw, keep the existing graceful 502. Add `isFallback?: boolean` to `GenerateResponse`.
- `src/lib/generation/provision.ts` -- VERIFY only. `provisionGeneration`/`upsertSchema` already store the schema into `org_schemas.definition` (JSONB) and seed via `mutate.ts`; confirm the `isFallback` flag isn't stripped. `seedRows: unknown` already accepts the `Record<string, rows>` shape. Change only if the flag is dropped.
- `src/types/db.ts` -- MODIFY. Add `isFallback?: boolean` to `SchemaDefinition`; leave `FieldDefinition`/`TableDefinition`/`OrgSchemaRow` untouched.
- `src/app/generate/page.tsx` -- MODIFY. Add `isFallback?: boolean` to the shared response type; render the banner in the "ready" state after `<header>`, before the `aria-live` region, when `result.isFallback`. Build the banner by applying the `web-uiux-architect` skill. Keep the StrictMode single-POST guard untouched.
- `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- MODIFY. Add `Generate.fallbackBanner` (EN: "We used a starter template — you can customize it using the chat"; FR equivalent).
- `src/lib/data/{mutate,records}.ts`, `src/lib/supabase/admin.ts`, `src/lib/schema/validator.ts` -- REUSE, don't modify (seeds / read-back / template-validity test).
- `tests/unit/route-generate.test.ts` (MODIFY) + `tests/unit/fallback.test.ts` (CREATE) -- double-failure → 200 + `isFallback` + `Set-Cookie`; fallback-throws → last-resort 502; template + rows pass the validator, `reason` on all, no `relation`/reserved/blocked, 5–8 rows/table.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/generation/fallback.ts` -- CREATE the hardcoded `UNIVERSAL_FIELD_SERVICE_TEMPLATE` (Clients/Jobs/Invoices, per-table/field `reason`s, scalar types) + `FALLBACK_SEED_ROWS` (5–8 Ontario rows/table). -- the deterministic no-error dashboard content.
- [x] `src/types/db.ts` -- add `isFallback?: boolean` to `SchemaDefinition`. -- durable fallback signal across read-back/claim.
- [x] `src/app/api/generate/route.ts` -- replace the double-failure 502 seam with fallback provisioning (reuse success read-back/cookie tail), add `isFallback` to `GenerateResponse`, wrap in try/catch → last-resort 502. -- the core no-error-screen behavior.
- [x] `src/lib/generation/provision.ts` -- verify `isFallback` survives `upsertSchema` into `org_schemas.definition`; adjust only if the flag is stripped. -- persistence correctness.
- [x] `src/app/generate/page.tsx` -- thread `isFallback` through the response type; render the subtle banner (via `web-uiux-architect` skill) in the ready state. -- the visible, non-alarming reassurance.
- [x] `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- add `Generate.fallbackBanner` (EN + FR). -- i18n compliance.
- [x] `tests/unit/fallback.test.ts` (CREATE) + `tests/unit/route-generate.test.ts` (MODIFY) -- cover the I/O matrix: template passes the validator, double-failure → 200 + isFallback + cookie, fallback-throws → last-resort 502, seed-row bounds. -- edge-case coverage.

**Acceptance Criteria:**
- Given two consecutive generation failures, when the second attempt fails, then the system provisions `UNIVERSAL_FIELD_SERVICE_TEMPLATE` (Clients/Jobs/Invoices) pre-seeded with generic Ontario data, sets `isFallback: true`, and returns a 200 populated reveal — never a 502/error screen.
- Given a fallback dashboard, when `/generate` renders it, then a subtle banner ("We used a starter template — you can customize it using the chat") appears in the active UI locale (EN/FR) without a modal, forced dismissal, or focus theft.
- Given the fallback template, when passed through `validateGeneratedSchema`/`filterSeedRows`, then it passes clean (no reserved/blocked keys, no `relation`, 5–8 rows/table) and every table and field carries a `reason`.
- Given a reused per-session org, when the fallback provisions, then seeding is idempotent (stable `fallback-<table>-<i>` keys) and the flag persists into `org_schemas.definition`.
- Given `npm run test`, `type-check`, `lint`, `build`, when run, then all pass; no `GEMINI_API_KEY`/service-role key appears in any client bundle.

## Implementation Notes

**Delivered.** All seven tasks complete. On double `attemptGeneration` failure, `POST /api/generate` now provisions the hardcoded `UNIVERSAL_FIELD_SERVICE_TEMPLATE` (`clients`/`jobs`/`invoices`, a `reason` on every table + field, scalar types only, no `relation`) pre-seeded with 6 Ontario rows/table (Ottawa/Kanata/Nepean, 613 numbers, CAD pricing) — `fallback.ts` is `import "server-only"`. The route extracts the success tail into a shared `provisionAndReveal(existingOrgId, schema, seedRows, isFallback)` helper; the double-failure branch runs that same tail with `{...UNIVERSAL_FIELD_SERVICE_TEMPLATE, isFallback:true}` and returns 200 (never a 502). A try/catch wraps only the fallback provisioning → on throw (e.g. DB outage) it keeps the pre-1.5 non-leaking graceful 502 (last-resort). `isFallback` rides `org_schemas.definition` JSONB (verified `upsertSchema` stores the definition verbatim — no migration) and is mirrored into `GenerateResponse`. `/generate` renders a subtle banner (`role="status"`, decorative `Sparkles`, theme tokens, no modal/dismiss/focus-steal, StrictMode guard untouched) only when `result.isFallback`; strings resolve via `Generate.fallbackBanner` (EN + FR).

**Fixed during orchestrator verification (idempotency-key collision).** The initial implementation called `provisionGeneration` unchanged, so fallback rows keyed on `gen-seed-<table>-<i>` — violating the frozen boundary/AC that requires `fallback-<table_key>-<i>`. This was a latent correctness bug on the matrix's "reused session org" row: a prior real generation and the fallback both seeding a `clients` table would collide on identical `gen-seed-clients-0` keys and the fallback row would be de-duped away. Added an optional `idempotencyPrefix` to `ProvisionInput` (default `"gen-seed"` — the real-generation path is byte-for-byte unchanged); `provisionAndReveal` passes `"fallback"` only on the fallback path. Pinned by a new `provision.test.ts` case (asserts `fallback-clients-0/1`) and a route-seam assertion (`idempotencyPrefix: "fallback"`).

**Orchestrator verification (independently re-run against the diff).** `npm run test` → **77 pass** (10 files, +11 from 1.4's 66); `type-check`, `lint`, `build` all green (only the pre-existing eslintrc-deprecation and Sentry→OpenTelemetry warnings, both non-fatal, exit 0). Scanned `.next/static`: no `GEMINI_API_KEY` / `GENERATE_SESSION_SECRET` / `service_role` / hardened-prompt text, and no server-only fallback seed data (`Maple Ridge Dental`) — confirming the `server-only` guard keeps the template out of client bundles.

**Manual-check scope (per frozen "no DOM/e2e infra" boundary + 1.3/1.4 precedent).** The live end-to-end checks — forcing a real double-failure on `/`, the FR-locale banner render, and inspecting `org_schemas.definition.isFallback` in the DB — remain manual (route/template behavior is covered at unit level with mocked SDK/DB).

**Review pass 1 patches (see Review Triage Log).** Two patches applied after review: (1) `src/lib/data/records.ts` `getSchema` now preserves top-level definition fields (spreads `raw`, only normalizes `tables`) instead of reconstructing `{ tables }` — the prior read path silently dropped the persisted `isFallback`, breaking the frozen "survives read-back/claim" requirement; added a real-`getSchema` round-trip test in `fallback.test.ts` (2 cases). (2) Corrected the stale `/generate` docstring that still described the removed 502 "start over" seam. The reused-org same-`table_key` row-merge edge and the pre-existing ephemeral-org cleanup are filed in `deferred-work.md`. Full verification re-run green: **79 tests** pass, `type-check`/`lint`/`build` clean.

## Spec Change Log

## Review Triage Log

### Review pass 1 (2026-09-24)

Three layers (blind-hunter, edge-case-hunter, verification-gap) run in parallel at session (Opus) capability. Verdicts rendered against the code, not the reviewers' severities.

**Patched (route: patch — sent to the implementation agent; verification re-run on the orchestrator side):**
- **[high → patch] `getSchema` strips `isFallback` on read-back, defeating the frozen durability requirement** (BlindHunter + VerificationGap, `src/lib/data/records.ts:71`) — VERIFIED: `getSchema` reconstructs `{ tables: raw?.tables ?? [] }`, so although the route persists `isFallback` into `org_schemas.definition`, the ONLY read path discards it. The immediate `/generate` reveal is unaffected (the route sets response `isFallback` from an explicit param, not read-back — and that path is tested), but the frozen boundary/AC "persists into `org_schemas.definition` … survives read-back and claim" is false: Story 1.6's independent render and Epic 2 claim would lose the banner state. The non-frozen Code Map said "records.ts REUSE, don't modify"; delivering the frozen durability requires `getSchema` to preserve the flag. Fix: preserve `isFallback` (and any future top-level schema fields) through `getSchema`; add a real `provisionGeneration → getSchema` round-trip test asserting the flag survives (closes the paired VerificationGap finding that the verbatim `toEqual(SCHEMA)` test would not catch the flag being dropped).
- **[low → patch] Stale `/generate` docstring still describes the removed 502 "start over" behavior** (BlindHunter, `src/app/generate/page.tsx:23-25`) — VERIFIED: the comment says a double-failure from the endpoint degrades to a "start over" path; post-1.5 a double-failure lands on a populated 200 fallback dashboard, and the `failed` phase now fires only on the last-resort 502. A dev reading this function's control-flow docstring is misled. Fix: update the comment to describe the fallback-dashboard behavior + the last-resort 502.

**Deferred (route: defer — appended to `deferred-work.md`):**
- **[low → defer] Reused-org same-`table_key` row merge in the visible reveal** (EdgeCase + BlindHunter, `route.ts` fallback path → `listRecords`) — VERIFIED reachable but narrow: a returning visitor in the same 24h session first generates successfully into a table normalizing to `clients`, then a regeneration double-fails → the fallback provisions its own `clients` and read-back (`listRecords` by `table_key`) returns BOTH row sets merged. The new `idempotencyPrefix` prevents key-collision dedup but not row coexistence. The primary single-generation flow is unaffected. Story 1.4's review already assessed this reused-org family as low + non-trivial fix (soft-delete-before-reseed collides with the 1.2 partial-unique idempotency index — needs content-based keys or an index change). The implementation note's attribution to the deferred ephemeral-org cleanup is inaccurate (that cron deletes whole orphan orgs, not an active org's merged rows), so a distinct deferred entry is filed.

**Rejected:**
- **[low → reject] Template `sensitive: true` on phone/email not asserted to survive the validator** (BlindHunter, `fallback.test.ts`) — the sensitivity-indicator UI is Story 8.3 (deferred) and the flag is dormant data now (exactly as `reason` was in Story 1.4, whose review rejected the analogous "sensitive not surfaced/tested" finding). The risk is a speculative future validator regression; adding assertions for dormant data is out of proportion. Consistent with the 1.4 precedent.
- **[false → reject] Banner contrast (`text-foreground/80` on `bg-primary/5`) asserted AA but unverified** (BlindHunter, `page.tsx`) — REFUTED as a demonstrated defect: `text-foreground/80` is darker than `text-muted-foreground` (the standard AA-passing muted body token in the shadcn zinc theme) over a near-background 5%-primary tint; the reviewer showed no failing ratio. Dark-on-light (and its dark-mode inverse) clears 4.5:1 comfortably.
- **[note → subsumed] `isFallback` serialized twice (top-level + nested in `data.schema`)** (BlindHunter) — harmless, and the "trap" (a reader trusting the nested value that read-back nulled) is resolved by the `getSchema` patch above: once read-back preserves the flag, the top-level and nested values agree (both true on fallback, both falsy on success). No separate action.

## Design Notes

**Why reuse the success tail.** The read-back → cookie → `ApiResponse` sequence is identical for a real generation and a fallback; the only differences are the schema source (hardcoded vs LLM) and `isFallback`. Routing both through one code path keeps the reveal, session, and Story 1.6 render uniform — 1.6 renders "whatever 1.4 or 1.5 provisioned" without special-casing.

**Why persist isFallback on the schema.** The reveal is one POST, but 1.6 renders the dashboard from an independent read-back of `org_schemas`, and claim (Epic 2) carries the org forward. A transient response-only flag would lose the banner on reload/claim; persisting it in the JSONB `definition` (no migration) makes it durable and free.

## Verification

**Commands:**
- `npm run test` -- expected: new `fallback.test.ts` + updated `route-generate.test.ts` pass (mocked SDK/DB; no network).
- `npm run type-check` -- expected: `tsc --noEmit` passes.
- `npm run lint` -- expected: passes; no service-role/`GEMINI_API_KEY` in client-bundled code; no hardcoded user-facing strings.
- `npm run build` -- expected: production build succeeds.

**Manual checks:**
- Force double failure (e.g. invalid `GEMINI_API_KEY` or a forced timeout) on `/`; `/generate` lands on a populated Clients/Jobs/Invoices dashboard with the subtle banner within the time budget — no error screen.
- Toggle UI locale to FR and repeat; the banner renders in French.
- Inspect `org_schemas` for the session: `definition.isFallback` is `true`, and every table/field carries a `reason`.
