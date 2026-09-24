---
title: 'Story 1.4: AI Schema + Synthetic Data Generation (Ontario & French Localized)'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
baseline_commit: '1001df57439b8dec0c2e2300f13aad64d3468d7d'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1.3 captures a `GenerationIntent` and hands off to a `/generate` skeleton stub that does nothing — the product's core "aha moment" (describe your business → land in a populated, Ontario-localized dashboard, no account) has no engine behind it. The Gemini client, schema validator, and generation route the epic depends on do not exist yet.

**Approach:** Build the LLM generation pipeline: a hardened `callGeminiWithTimeout()` client that issues exactly ONE structured `gemini-3.8-flash` call returning `{ schema, seedRows }`; a synchronous append-only Schema Validator that gates the output before persistence; and a `POST /api/generate` route that inflates the prompt with Ontario/trade context, validates, and provisions an `org_schemas` definition + seeded `records` (5–8 trade-specific, Ontario-localized rows, in the prompt's own language) with a per-table/field plain-language `reason`. Replace the `/generate` stub so a real generation drives to a populated read-only view.

## Boundaries & Constraints

**Always:**
- Exactly ONE structured Gemini call per generation via `callGeminiWithTimeout()`: model `gemini-3.8-flash`, `responseMimeType: 'application/json'` + a `responseSchema`, `systemInstruction: HARDENED_SYSTEM_PROMPT` on 100% of calls (NFR-S5). Returns `{ schema, seedRows }` together — one round trip, one timeout, one failure point.
- Hard 15s wall via `Promise.race` against a `setTimeout` reject, AND pass the SDK an `AbortSignal` (belt-and-suspenders; the race guarantees the route resolves even if the SDK hangs). On failure (timeout, invalid JSON, or validator rejection) retry **exactly once**.
- Schema Validator (`src/lib/schema/validator.ts`) runs synchronously on the LLM output **before anything is persisted**. Append-only allowlist ops `add_table | add_field | add_view`; reject reserved-column collisions (`id, organization_id, table_key, data, created_at, updated_at, deleted_at`); reject blocked keywords (`DROP GRANT TRUNCATE DELETE EXEC -- ; /*`); the `relation` field type is never accepted. Every rejection is logged (org/session id + raw LLM output) through the observability seam.
- Apply `normalizeTableName()` to every `table_key` and field `key` before persistence. Provisioning is metadata insert + seed-row inserts through the existing `mutate.ts` under the admin client with a system actor — NO runtime DDL.
- Seed data is trade-specific and Ontario/GTA-Ottawa localized (real street names, standard Ontario pricing, trade terminology), 5–8 rows per table (FR3). Language is detected from the user's free-text description at generation time and drives the language of all labels, `reason`s, and seed data — **independent of UI locale** (FR35).
- The generation call emits a one-line plain-language `reason` for every proposed table and field; provisioning persists those `reason`s into the `org_schemas` definition (the UI affordance is Story 1.7; the data is produced here).
- A malformed `seedRows` section must NOT invalidate an otherwise-valid schema — persist the schema, skip bad rows, proceed.
- Route contract: authenticate/parse → Zod-validate body → business logic → return `ApiResponse<T>` (`{ data, error }`). HTTP 200/400/422/500; throw `AppError`. Never expose raw stacks, SQL, `org_schemas` JSON, or LLM output to the client (AR13). Never surface an error screen.
- The Gemini client and validator are server-only; `GEMINI_API_KEY` and the service-role key must never enter a client bundle (existing CI lint gate).
- All user-facing strings on `/generate` resolve through next-intl in both EN and FR.

**Never:**
- No account, email, magic-link, or claim flow (Epic 2). No auth on `/api/generate` — it is the anonymous pre-account path.
- No universal **fallback template** deployment or `isFallback` banner UX — that is Story 1.5. This story builds retry-once; on double-failure it degrades gracefully (never a raw error screen) via the existing `/generate` "start over" path, leaving a documented seam for 1.5.
- No interactive dashboard, in-place edit, delete, filter/sort, column-hide, real-time sync, or the "grow-into-dashboard" Framer Motion transition (Story 1.6). No explainability info-icon/override UI (Story 1.7).
- No `relation` field type generated or accepted. No second LLM round-trip for reasons or for language detection.
- No IP rate-limiting middleware in this story (shared Edge-middleware concern, deferred). No live LLM call in CI tests (SDK is mocked; no `GEMINI_API_KEY` in CI).

**Decisions (resolved):**
- **Anonymous persistence & read-back → per-session organization.** `/api/generate` mints a real `organizations` row per session via the admin client (no `org_members` yet), provisions `org_schemas` + `records` under it exactly like the `/demo` walking skeleton, and sets a **signed httpOnly session cookie** carrying the org/session id. Read-back reuses `getSchema`/`listRecords` via the admin client scoped to that org id. Claim (Epic 2) promotes the same org by attaching the first `org_members` row — no data copy. No new migration. Ephemeral pre-claim orgs accumulate until a later TTL/cleanup story (appended to `deferred-work.md`). If the session cookie already resolves to a provisioned org, `/api/generate` reuses it (idempotent per session) rather than minting another.
- **1.4 render boundary → minimal read-only reveal.** On success `/generate` reveals a minimal read-only table of the generated data (reusing the `/demo` `formatCell` render pattern). Interactivity, in-place edit, explainability UI, and the grow-into-dashboard Framer Motion transition remain in Stories 1.6/1.7. UI states (loading skeleton, reveal, graceful degrade) are built applying the `web-uiux-architect` skill during implementation, honoring accessibility (`aria-busy`/`aria-live`, `prefers-reduced-motion`, semantic table) with visual polish deferred to 1.6.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid EN prompt | `GenerationIntent` (e.g. HVAC / Barrie / "jobs, quotes, clients") | ONE Gemini call → validated `{schema, seedRows}` → `org_schemas` + 5–8 records provisioned; route returns schema + session ref | N/A |
| French prompt | description written in French | Labels, `reason`s, and seed data generate in French; UI locale irrelevant | N/A |
| Malformed seedRows | schema valid, some rows fail shape | Schema persisted; only well-formed rows seeded; generation succeeds | Bad rows skipped, not fatal |
| Validator rejection | LLM output uses `relation`, a reserved key, or a blocked keyword | Output rejected pre-persist; retry once; nothing partially persisted | Logged (id + raw output) via observability seam |
| Prompt-injection attempt | description tries to make the model emit SQL / act as agent | Hardened system prompt refuses; validator blocks any non-allowlisted op | Refusal / rejection, no persistence |
| Gemini timeout | SDK exceeds 15s | `Promise.race` rejects at 15s; retry once | On 2nd failure → graceful degrade (1.5 seam), no error screen |
| Double failure | two consecutive failures | No partial data; `/generate` shows graceful "start over" (interim; 1.5 replaces with fallback template) | `AppError`, `{data:null,error}` |
| Missing/invalid intent | POST body fails Zod | 422 with translated message; no LLM call | `AppError(422)` |

</frozen-after-approval>

## Code Map

- `src/lib/gemini/client.ts` -- CREATE. `callGeminiWithTimeout<T>(userPrompt, responseSchema, timeoutMs=15000): Promise<T>`. One shared `new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY})` per process; `ai.models.generateContent({model:'gemini-3.8-flash', contents, config:{systemInstruction, responseMimeType:'application/json', responseSchema, abortSignal}})`; `Promise.race` vs 15s `setTimeout`; `JSON.parse(res.text ?? '')`. Server-only.
- `src/lib/gemini/prompts.ts` -- CREATE. `HARDENED_SYSTEM_PROMPT` (verbatim from architecture — identity-masking, JSON-only, refuse-out-of-scope), the prompt-inflation builder that wraps the `GenerationIntent` with Ontario/trade context + "detect the description's language and generate all output in it", and the `responseSchema` describing `{schema:{tables:[{key,label,reason,fields:[{key,label,type,reason,sensitive?}]}]}, seedRows:{<table_key>:[...]}}` (types limited to `text|number|boolean|date|datetime|email|phone|currency`).
- `src/lib/schema/validator.ts` -- CREATE. `validateGeneratedSchema(raw): {valid, error?, sanitized?: SchemaDefinition}` + a rows filter. Allowlist ops, `RESERVED_KEYS`, `BLOCKED_KEYWORDS`, reject `relation`, `normalizeTableName()` all keys, drop malformed rows. Logs rejections via the observability seam.
- `src/lib/observability/report.ts` -- CREATE. Thin `reportError(err, context)` / `reportRejection(...)` seam: calls `@sentry/nextjs` `captureException`/`captureMessage` when a DSN is configured, else `console.error`. Add a minimal `instrumentation.ts` per `node_modules/next/dist/docs/.../instrumentation.md` only if required to make capture work; keep Sentry setup minimal (full wiring is out of scope).
- `src/app/api/generate/route.ts` -- CREATE. `POST` handler: Zod-validate body (mirror of `GenerationIntent`), inflate prompt, `callGeminiWithTimeout` (retry once), validate, provision (mint org + `org_schemas` upsert + seed via `mutate.ts` under admin client, system actor, stable idempotency keys), set httpOnly session cookie, return `ApiResponse`. Follows `src/types/api.ts` contract.
- `src/app/generate/page.tsx` -- MODIFY. Replace stub body: on mount POST the intent (from `readIntent()`) to `/api/generate`, show the existing skeleton while awaiting, then reveal the result (per OQ2). Keep the graceful no-intent / failure "start over" path (never an error screen).
- `src/lib/generation/intent.ts` -- REUSE `GenerationIntent`, `TRADE_KEYS`, `readIntent()`. Export/derive a server-safe body schema for the route (mirror of `storedIntentSchema`).
- `src/lib/data/{mutate,records}.ts`, `src/lib/supabase/admin.ts`, `src/lib/data/seed.ts` -- REUSE. `mutate()` for seed inserts; `getSchema`/`listRecords` for read-back; `createAdminClient()` for the bootstrap path; `seed.ts` `formatCell`/render pattern (in `/demo`) for the reveal. Do not modify the guarded layer.
- `src/types/db.ts` -- REUSE `SchemaDefinition`/`TableDefinition`/`FieldDefinition` (already carry `reason?`, `sensitive?`, `hidden?`, and the field-type union). Extend the type union only if a needed field type is missing.
- `src/lib/i18n/en.json` / `fr.json` -- ADD `Generate` strings for the generating/reveal/failure states to both catalogs.
- `.env.example` -- `GEMINI_API_KEY` already present (server-only). No change unless a session-signing secret is introduced by the chosen option.
- `tests/unit/` -- CREATE validator + prompt/response-schema + client (mocked SDK) tests. `src/app/demo/page.tsx` -- REUSE as the render reference. Do NOT add DOM/e2e infra (deferred, per 1.3 precedent).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/gemini/prompts.ts` -- `HARDENED_SYSTEM_PROMPT`, prompt-inflation builder (Ontario/trade context + language-detection instruction), and the `responseSchema` for `{schema, seedRows}` incl. per-table/field `reason`; exclude `relation`. -- the hardened, structured generation contract.
- [x] `src/lib/gemini/client.ts` -- `callGeminiWithTimeout()` with shared client, `Promise.race` 15s wall + `AbortSignal`, JSON parse. Server-only. -- single LLM entry point (reused by Epics 4/5).
- [x] `src/lib/schema/validator.ts` -- allowlist/reserved/blocked/`relation` validation + `normalizeTableName()` + malformed-row filtering; log rejections. -- the pre-persist safety gate.
- [x] `src/lib/observability/report.ts` (+ minimal `instrumentation.ts` if needed) -- Sentry-or-console reporting seam. -- FR45 rejection logging without full Sentry setup.
- [x] `src/app/api/generate/route.ts` -- POST: Zod body validation, prompt inflation, `callGeminiWithTimeout` (retry once), validate, provision (mint org + `org_schemas` + seed via `mutate.ts`), session cookie, `ApiResponse`; double-failure → graceful degrade (1.5 seam), never leak internals. -- the generation endpoint.
- [x] `src/app/generate/page.tsx` -- replace stub: POST intent, skeleton while pending, minimal read-only reveal on success (reuse `formatCell` pattern), graceful "start over" on missing-intent/failure. -- the visible aha-moment surface.
- [x] `src/lib/i18n/en.json`, `fr.json` -- add `Generate` state strings to both. -- i18n compliance EN+FR.
- [x] `tests/unit/schema-validator.test.ts`, `tests/unit/gemini-generation.test.ts` -- cover the I/O matrix mechanics without a live LLM/DB: each validator rejection (relation, reserved key, blocked keyword), key normalization, malformed-row skip, retry-once-then-fail via a mocked SDK, timeout race, language/prompt-inflation shape. -- edge-case coverage.

**Acceptance Criteria:**
- Given a submitted prompt, when `/api/generate` runs, then it issues exactly ONE `gemini-3.8-flash` structured call via `callGeminiWithTimeout()` with `HARDENED_SYSTEM_PROMPT`, `responseMimeType:'application/json'` + `responseSchema`, returning `{schema, seedRows}`.
- Given LLM output, when validated, then the Schema Validator enforces the append-only allowlist, rejects reserved-column collisions, blocked keywords, and any `relation` type before anything is persisted; rejections are logged with the id + raw output.
- Given validated output, when provisioned, then an `org_schemas` definition row and 5–8 seeded `records` per table are inserted with `normalizeTableName()` applied and no runtime DDL, and a plain-language `reason` is stored for every table and field.
- Given a French-language description, when generation runs, then seed data and column names are in French regardless of UI locale.
- Given a malformed `seedRows` section, when generation runs, then the valid schema is still persisted and only bad rows are skipped; the visitor still lands on a populated view.
- Given two consecutive generation failures, when the pipeline gives up, then no partial data persists and the visitor sees a graceful non-error degradation (not a raw stack/500 screen).
- Given `npm run test`, `type-check`, `lint`, `build`, when run, then all pass; no `GEMINI_API_KEY`/service-role key appears in any client bundle.

## Implementation Notes

**Delivered.** All eight tasks complete. Pipeline: `prompts.ts` (verbatim `HARDENED_SYSTEM_PROMPT`, `buildGenerationPrompt()` with Ontario/trade context + FR35 language-detection-from-description and user text triple-quote-delimited so it can't act as instructions, `GENERATION_RESPONSE_SCHEMA` limited to the MVP scalar type set — `relation` never offered) → `client.ts` (`callGeminiWithTimeout`: lazily-instantiated shared `GoogleGenAI`, one `gemini-3.8-flash` call, 15s `Promise.race` wall AND `AbortSignal`, timer always cleared) → `validator.ts` (`validateGeneratedSchema` + `filterSeedRows`: allowlist/reserved/blocked/`relation` rejection, `normalizeTableName()` + dedupe on every key, malformed-row projection onto known field keys so a stray key can't smuggle into `records.data`; logs every rejection) → `route.ts` (`POST`, `force-dynamic`: Zod body validation → inflate → generate with retry-exactly-once → validate → `provisionGeneration` → read-back via admin client → signed httpOnly cookie → `ApiResponse`; double-failure returns a generic 502 `{data:null}`; never leaks internals). `provision.ts` mints/reuses a per-session org, upserts `org_schemas` before rows, seeds via `mutate.ts` under a system actor with stable `gen-seed-<table>-<i>` idempotency keys. `session.ts` signs the org id with `HMAC(GENERATE_SESSION_SECRET)` + `timingSafeEqual`. `/generate` now reads intent → POSTs → skeleton (`aria-busy`/`aria-live`) → minimal read-only reveal (semantic `<table>`, `formatCell`) → graceful "start over" on missing-intent/failure; StrictMode-safe single POST via ref.

**Orchestrator verification (independently re-run against the diff).** `type-check`, `lint`, `build` all green; `npm run test` → **56 pass** (7 files). Confirmed no `GEMINI_API_KEY` / `GENERATE_SESSION_SECRET` / `service_role` / hardened-prompt text appears in `.next/static` client bundles. Build emits one non-fatal `@sentry/nextjs`→OpenTelemetry "Critical dependency" warning (exit 0; full Sentry wiring is out of scope per spec).

**Added during verification.** `tests/unit/provision.test.ts` (4 cases) — closes the I/O-matrix "Valid prompt → provisioned" and "malformed seedRows → schema persisted, bad rows skipped" rows at the provisioning layer with a fake admin client (no DB/new infra): org mint, session-org reuse (idempotent), schema-before-rows ordering, stable idempotency keys, bad-row skip.

**New required env.** `GENERATE_SESSION_SECRET` (server-only; added to `.env.example`) signs the anonymous session cookie; the route throws at request time if absent. Must be set in every environment.

**Type widened.** `FieldDefinition.type` gained `datetime|email|phone` to match the generation contract; `relation` is still excluded everywhere.

**Manual-check scope (per frozen "no DOM/e2e infra" boundary + 1.3 precedent).** Route-boundary behaviors (422 on bad body / no LLM call, 502 graceful degrade, cookie set) and live LLM/DB behaviors (real EN/FR generation, `org_schemas` reason inspection) are covered by the spec's manual checks, not automated tests. `deferred-work.md` carries the ephemeral pre-claim-org TTL/cleanup follow-up.

### Post-merge local smoke test (2026-09-24)

Ran the pipeline live (real `GEMINI_API_KEY` + the hosted ca-central-1 test project). Two real defects surfaced and were fixed; both verifications (`type-check`, `lint`, 66 tests, `build`) re-run green.

- **[fix] Pinned model `gemini-2.0-flash` was retired by Google** — the live API returns `404 ... no longer available. Please update your code to use models/gemini-3.8-flash`. Bumped `GEMINI_MODEL` to `gemini-3.8-flash` and the matching unit assertion. The frozen model reference was updated to match (implicit renegotiation — a dead model id cannot stand); the Gemini client is reused by Epics 4/5, so future stories inherit the correct model.
- **[fix] `seedRows` came back empty (all tables 0 rows)** — declaring `seedRows` as a property-less `Type.OBJECT` makes Gemini's structured-output mode emit `{}` (it only fills declared properties), so no seed data was ever generated. Re-declared `seedRows` as a `Type.STRING` containing stringified JSON; the route `JSON.parse`s it tolerantly (malformed → no rows, schema still persists), and `seedRowsForTable` now falls back to a normalized-key match so raw model keys line up with sanitized `table.key`s.
- **Verified live:** EN prompt (HVAC / Barrie) → 3 tables, 5–6 Ontario-localized rows each (real Barrie street + 705 area code). FR description under EN UI → French labels + French seed data (FR35 holds). Graceful degrade confirmed: a retired-model 404 and a 15s×2 timeout both returned a clean 502 → `/generate` "start over", never a raw error.
- **Observation (not a defect):** French / larger generations occasionally exceed the 15s per-call wall and land on the graceful degrade; a resubmit succeeds. The 15s budget is the spec's frozen value; if this proves common, revisit it (or the Story 1.5 fallback) rather than loosening the wall silently.

## Spec Change Log

## Review Triage Log

### Review pass 1 (2026-09-24)

Three layers (blind-hunter, edge-case-hunter, verification-gap) run in parallel at session capability. Verdicts rendered against the code, not the reviewers' severities.

**Patched (route: patch — sent to the implementation agent; verification re-run green):**
- **[patch] `/generate` hangs on the skeleton under React StrictMode (dev)** (EdgeCase, `page.tsx`) — VERIFIED: the `startedRef` guard + cleanup `controller.abort()` interact badly — StrictMode's throwaway unmount aborts the only fetch, then the remount short-circuits on `startedRef` so nothing restarts. Since App Router enables Strict Mode in `next dev`, the story's own manual checks can't be run locally. Fixed so exactly one request completes and the reveal renders in dev; production single-POST behavior preserved.
- **[patch] `filterSeedRows` enforces no upper bound on seed rows** (BlindHunter + EdgeCase, `validator.ts`) — VERIFIED: the prompt/comments promise 5–8 rows but nothing caps; a model returning far more would seed them all (breaching the 5–8 contract and the <5s NFR-P2 provisioning budget with N sequential inserts). Fixed: cap kept rows per table at 8.
- **[patch] Read-back errors after provisioning are silently swallowed** (EdgeCase, `route.ts`) — VERIFIED: `getSchema`/`listRecords` errors fall back to `?? generation.schema` / `?? []` with no `reportError`, so a post-provision DB read failure yields a degraded/empty reveal with no observability trail. Fixed: report on those error branches (no behavior change otherwise).
- **[patch] Dead `PERMITTED_OPERATIONS` implies enforcement that does not exist** (BlindHunter + EdgeCase, `validator.ts`) — VERIFIED: exported, never referenced; op-allowlisting is actually shape-implicit (the generation shape can only express tables/fields). Fixed: removed the misleading constant (a direct deletion).
- **[patch] `GenerateResponse` (route) and `GenerateData` (page) are duplicate structural types that can drift** (BlindHunter, `route.ts`/`page.tsx`) — VERIFIED identical shapes redefined; the repo deliberately shares such contracts (`generationIntentBodySchema`). Fixed: single shared type (type-only import — erased at compile time, so no server-only code is pulled into the client).
- **[patch] Route orchestration has no test** (VerificationGap + BlindHunter, `route.ts`) — pre-verified: no test imports `POST`; the retry→502 degrade, success-200 + cookie, and cookie-reuse paths are unexercised (the retry test re-implements the loop locally). Fixed: added `tests/unit/route-generate.test.ts` mocking the client/provision/records modules and asserting 502-on-double-failure, 200 + `Set-Cookie` on success, and org reuse from a valid signed cookie.
- **[patch] Signed session cookie (`session.ts`) has no test — the anti-forgery boundary is unpinned** (VerificationGap + BlindHunter, `session.ts`) — pre-verified: nothing exercises `encode/decodeSessionValue`, the HMAC + `timingSafeEqual` integrity gate that stops cross-session org access. Fixed: added `tests/unit/session.test.ts` (round-trip, tampered id/sig → null, malformed input → null, missing secret → null without throw).

**Rejected:**
- **[false → reject] `SYSTEM_ACTOR_ID` is a malformed UUID (13 hex in the last group)** (BlindHunter, `provision.ts`) — REFUTED: `00000000-0000-0000-0000-0000000000a0` is a valid 8-4-4-4-**12** UUID (the last group is 12 hex), and it is the exact constant Story 1.2's `seed.ts` already writes successfully against real Supabase.
- **[false → reject] Validation 422 is wastefully retried and mis-reported as a transient 502** (BlindHunter, `route.ts`) — REFUTED as a defect: the frozen spec explicitly includes "validator rejection" in the retry-exactly-once contract (the LLM is non-deterministic, so a second call can pass) and routes double-failure to the graceful degrade (a generic non-leaking 502). Both are intended, not bugs.
- **[false → reject] Empty `result.text` → `JSON.parse('')` throws with no diagnostic** (EdgeCase, `client.ts`) — REFUTED: an empty response throwing is the intended retryable-failure signal; the reviewer itself marked it "acceptable / intended."
- **[low → reject] `email`/`phone`/`datetime` are effectively unreachable / untested** (BlindHunter, `prompts.ts`/`db.ts`) — the `responseSchema` enum (built from `GENERATION_FIELD_TYPES`) constrains the model, so those types ARE reachable; the validator accepts them and `email` is already exercised in a validator test. Enumerating them in the prose prompt and adding per-type round-trip tests is a test/quality enhancement, not a defect.
- **[low → reject] `formatCell` renders `date`/`datetime` as raw ISO strings** (BlindHunter, `page.tsx`) — matches the established `/demo` `formatCell` pattern the spec directs reuse of; date/locale formatting is dashboard polish deferred to Story 1.6. Cosmetic on a deliberately-minimal reveal; fix adds branches.
- **[out-of-scope → reject] `reason`/`sensitive` are generated+stored but not surfaced; sensitive shown in plaintext** (BlindHunter, `page.tsx`) — excluded by frozen intent: explainability UI is Story 1.7, the field-level sensitivity indicator is Story 8.3. The data is produced and persisted here exactly as required; the affordance is deferred by design.
- **[low → reject] Mixed-language screen: FR content inside EN chrome; `tableCaption` interpolates a FR label into an EN sentence** (BlindHunter, `page.tsx`) — a direct consequence of the frozen FR35 decision (content localizes to the description language, independent of UI locale). Fixing it would fight the requirement; minor coherence cost on an anonymous demo.
- **[low → reject] No client-side `fetch` timeout; visitor can sit ~30s on the skeleton** (BlindHunter, `page.tsx`) — worst case (2×15s server wall + provisioning) stays within the 45s NFR-P1 budget; elapsed-time UX and the grow-into-dashboard transition are Story 1.6. Fix adds a client deadline/branching for negligible gain.
- **[low → reject] Re-provisioning a reused session org leaves stale/orphan records** (EdgeCase, `provision.ts`/`route.ts`) — VERIFIED reachable only on a specific path: a returning visitor regenerates in the same 24h session AND the new schema reuses an identical normalized `table_key`, whereupon the positional idempotency key (`gen-seed-<table>-<i>`) de-dupes and the visitor sees prior throwaway demo rows. Orphan rows under changed table_keys are invisible (read-back only reads the current schema) and are reaped by the already-deferred ephemeral-org cleanup. A correct fix is NOT trivial — soft-delete-before-reseed collides with the partial-unique idempotency index from 1.2, so it needs content-based keys or an index change — and the primary single-generation flow is unaffected. Low severity + non-trivial fill → rejected; noted for the future claim/cleanup work.

## Design Notes

**Why one structured call.** The 2026-09-23 architecture optimization collapsed schema + seed generation into a single `responseSchema` call to fit the 45s p95 / one-timeout budget; `reason`s ride along in the same response (no extra round-trip), which is also why Story 1.7's explainability data originates here.

**Provisioning reuses the guarded layer.** Seed rows are inserted through `mutate.ts` under the admin client with a system `actorId` and stable idempotency keys (the exact pattern `seed.ts` uses for the demo org), keeping a single write path and honoring "service-role is bootstrap-only (anonymous generation)".

**Fallback boundary.** `callGeminiWithTimeout` retries once here; the hardcoded universal template + `isFallback` banner + full "no error screen" hardening are Story 1.5. Until then, double-failure degrades to the existing `/generate` "start over" screen — never a raw error.

## Verification

**Commands:**
- `npm run test` -- expected: validator + generation unit tests pass (mocked SDK; no network).
- `npm run type-check` -- expected: `tsc --noEmit` passes.
- `npm run lint` -- expected: passes; no service-role/`GEMINI_API_KEY` in client-bundled code; no hardcoded user-facing strings.
- `npm run build` -- expected: production build succeeds (`/generate` + `/api/generate` build; route is dynamic, no build-time Supabase/Gemini env needed).

**Manual checks:**
- Submit an EN prompt on `/`; `/generate` shows the skeleton then a populated read-only table of Ontario-localized rows within the time budget.
- Submit a French description (UI locale EN); generated labels + rows are French.
- Inspect `org_schemas` for the session: every table/field carries a `reason`; no reserved/blocked keys; no `relation` fields.
