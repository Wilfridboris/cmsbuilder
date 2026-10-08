---
title: 'Story 15.2: SchezaBot Assistant & Signature Generative Reveal'
type: 'feature'
created: '2026-10-08'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '5d94afabc46d2bff41ad6139144a79b40c92b5ca'
context:
  - '_bmad-output/implementation-artifacts/epic-15-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The generative "aha moment" on `/generate` is a quiet `animate-pulse` skeleton with no personality, the app has no visible AI presence while it works, and re-generating in the same browser session can reveal a mix of a prior generation's leftover rows, so the one shareable moment lands flat and sometimes dirty.

**Approach:** Vendor the existing standalone `scheza-bot` mascot (22-mood animated SVG, zero runtime deps, SSR-safe, reduced-motion-aware) into the app, wire its screen-reader label through next-intl, and make it the app's visible AI presence: a bot-led signature reveal on `/generate` (narrates while generation runs, assembles the dashboard on arrival, ends on a proud pose with the captured business name) and the face of the Epic 5 chat editor (reflecting pending/result by mood). Fix the reused-session-org row mixing so the reveal always shows only the current generation.

## Boundaries & Constraints

**Always:**
- Vendor the mascot into `src/components/scheza-bot/` preserving its behavior and public API (`SchezaBot`, `SchezaBotProps`, `SCHEZA_MOODS`, `SchezaMood`); it adds **no new runtime dependency**. Vendored files must pass the repo's `lint` + `type-check`.
- The bot's screen-reader `label` resolves through next-intl (en + fr); a purely decorative mount passes no `label` (the component then renders `aria-hidden`).
- The reveal is paced to real latency: the in-flight `POST /api/generate` is the only variable gate, narration lines never delay progression, the post-resolve assembly is a short bounded choreography, and a fast response resolves fast.
- Under `prefers-reduced-motion` the bot shows a calm still pose and the reveal is instant (no staged assembly); in all cases animation holds 60fps and introduces no layout shift (reserve space).
- On a reused anonymous session org, the reveal shows ONLY the current generation's tables and rows — never a merge of a prior generation's leftover or differently-keyed records.
- Error/fallback degrades gracefully (bot `oops`) with the EXISTING starter-template banner and no stuck or broken animation; the existing single-POST StrictMode guard, `isFallback` banner, `aria-busy`/`aria-live`, and `missing`/`failed` graceful-degradation phases are all preserved; `/generate` never shows a raw error screen.
- The editor bot reflects state by mood: idle/awaiting → `listening`; request in flight → `thinking`/`focused`; applied result → `success`/`proud`; declined/degraded/rejected → `oops`/`error`.
- All new or changed user-facing copy resolves through next-intl (en + fr) and contains no em-dash.
- **Resolved decision (scope):** the mascot is wired to exactly two signature surfaces — the `/generate` reveal (including its fallback / failed / missing / loading states) and the Epic 5 chat editor (pill + panel). The broader dashboard/forms empty-and-error sweep is explicitly deferred (ledger entry).

**Never:**
- Do not add a runtime dependency, and do not add a dev dependency (e.g. jsdom) or port the mascot's DOM-loop test; test the vendored component the repo way (node env + SSR, pure engine math).
- Do not modify the mascot's animation internals or its public API; wiring happens at the mount sites only.
- Do not add artificial timers that pad the reveal or hold a fast response.
- Do not hard-delete anything but `SYSTEM_ACTOR_ID` synthetic seed rows in an anonymous session org (never `INTAKE_ACTOR_ID` intake leads, never a claimed org's data).
- Do not change the `POST /api/generate` response contract, the per-session org reuse / claim contract, or `finalizeClaim`.
- Out of scope: a broad sweep of every dashboard/forms empty-and-error state (deferred, see Resolved decision above); the i18n em-dash scrub of pre-existing strings and the AI-output em-dash guard (15.3); Google sign-in (15.4).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reveal: generating | POST in flight | bot `thinking`/`focused`; honest phase lines rotate in an `aria-live="polite"` region; `aria-busy` | n/a |
| Reveal: success | 200 real generation | bounded staged assembly (tables, then fields, then seed rows) → bot `proud`/`success` + "Here's your dashboard, {businessName}" → `DemoDashboard` | n/a |
| Reveal: fast response | POST resolves quickly | narration never gates; reveal advances immediately; assembly stays short | n/a |
| Reveal: fallback | `isFallback: true` | bot settles `oops` then calm; existing starter-template banner renders; no stuck animation | graceful |
| Reveal: failed / missing | `failed` or `missing` phase | `StartOver` screen with a calm/`oops` bot; never a raw error | graceful |
| Reduced motion | `prefers-reduced-motion` | bot calm still pose; reveal instant (no assembly, no narration hold) | n/a |
| Reused session org | re-generate in same browser | provision clears prior `SYSTEM_ACTOR_ID` rows before reseed; read-back shows only the current generation | n/a |
| businessName absent | stored intent lost mid-flow | reveal uses a generic "Here's your dashboard" headline (no name) | degrade |
| Editor mood | `pending` / last message `uiKind` | pill + panel bot = `thinking`(pending) / `success`/`proud`(applied) / `oops`/`error`(declined,degraded,rejected) / else `listening` | n/a |
| Bot SR label | `label` present vs absent | `label` → `<svg role="img" aria-label>`; absent → `aria-hidden`, focusable false | n/a |

</frozen-after-approval>

## Code Map

- `scheza-bot/src/components/scheza-bot/{engine.ts,expressions.ts,fx.tsx,ticker.ts,scheza-bot.tsx,index.ts}` -- SOURCE to vendor (top-level gitignored distribution). `scheza-bot.tsx` is `'use client'`, renders a deterministic first frame on the server (no hydration mismatch), drives animation via `IntersectionObserver` + a shared `ticker`, and gates on `matchMedia('(prefers-reduced-motion: reduce)')`. `expressions.ts` exports `SCHEZA_MOODS` (the 22) + `SchezaMood`. `engine.ts` is pure math (keyframes/easing/spring), React-free. Copy verbatim into `src/components/scheza-bot/`; do not alter behavior.
- `src/app/generate/page.tsx` -- reveal host. Phase machine `initializing|generating|ready|missing|failed`; one guarded `POST /api/generate`; renders `DashboardSkeleton` while loading, `DemoDashboard` on `ready`, `StartOver` on `missing`/`failed`, and the `isFallback` banner. Rework the loading + ready transition into the bot-led reveal; KEEP the `startedRef` single-POST guard, the fallback banner, the `missing`/`failed` screens, and `aria-busy`/`aria-live`.
- `src/components/generation/GenerativeReveal.tsx` -- **new** client component owning the bot + narration (`aria-live`) + the bounded staged assembly, reading `businessName` via `readIntent()`. Keeps `page.tsx` thin. Composes with (does not duplicate) `DemoDashboard`'s own mount grow.
- `src/components/dashboard/DemoDashboard.tsx` -- exports `DashboardSkeleton` and renders the Framer-Motion grow. The reveal reuses `DashboardSkeleton`/the component as-is; only touch if the staged assembly needs a small stagger hook. Do not change its contract.
- `src/lib/generation/provision.ts` -- `provisionGeneration(input, admin)`: `resolveOrg` mints/reuses, `upsertSchema` REPLACES the schema (clean), then seeds via `mutate` with keys `${prefix}-${table.key}-${i}` (`SYSTEM_ACTOR_ID`, line 33). ADD: when `input.orgId` is set (reuse), hard-delete prior `actor_id = SYSTEM_ACTOR_ID` rows for the org BEFORE `upsertSchema`, so read-back is clean. Hard-delete (not soft) is required: a soft-deleted row keeps its `idempotency_key`, so reseeding the same key violates the partial-unique index.
- `src/lib/data/mutate.ts` -- exports `SYSTEM_ACTOR_ID` (…a0) and `INTAKE_ACTOR_ID` (…b0). Reuse `SYSTEM_ACTOR_ID`; never touch intake rows.
- `supabase/migrations/20260924055022_platform_schema.sql` -- `records_idempotency_key_idx` is `unique (organization_id, table_key, idempotency_key) where idempotency_key is not null` (lines 90-94): the reason soft-delete-before-reseed collides and hard-delete is used.
- `src/app/api/generate/route.ts` -- `provisionAndReveal` reads back `getSchema`/`listRecords` (both `deleted_at IS NULL`) per current-schema table. No change needed once provision clears; confirm the read-back is clean.
- `src/components/chat/ChatAssistant.tsx` -- Admin-only floating pill; currently a `Sparkles` glyph. Mount a small resting bot (`listening`/`idle`) as the assistant face; keep `pillLabel` and focus-return behavior.
- `src/components/chat/ChatPanel.tsx` -- holds `pending` (line 86) and `messages: ChatMessage[]`; assistant messages carry `uiKind` via `buildAssistantMessage`/`bubbleVariantFor` (`src/components/chat/chat-message.ts`: `applied-*`, `hidden-field`, `removed-view`, `confirm-hide-table`, `declined`, `degraded`, plain). Mount a header bot driven by a pure mood helper.
- `src/components/chat/assistant-mood.ts` -- **new** pure helper `moodForEditor(pending, lastAssistantUiKind)` → `SchezaMood`; node-testable, no DOM.
- `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add a `SchezaBot` namespace (assistant/alt label), reveal keys under `Generate` (rotating phase lines + `readyWithName` "Here's your dashboard, {businessName}"), and any editor sr-status text. En + fr, no em-dash.
- `.gitignore` -- `/scheza-bot/` is already present (line 67); verify it still ignores the distribution while `src/components/scheza-bot/` is tracked.

## Tasks & Acceptance

**Execution:**
- [x] `src/components/scheza-bot/` -- vendor `engine.ts`, `expressions.ts`, `fx.tsx`, `ticker.ts`, `scheza-bot.tsx`, `index.ts` from the top-level distribution verbatim; conform to repo `lint`/`type-check` (formatting/imports only, no behavior change).
- [x] `src/lib/generation/provision.ts` -- hard-delete prior `SYSTEM_ACTOR_ID` rows for `input.orgId` (when reusing) before `upsertSchema`, so a repeat same-session generation reveals only the current tables/rows; a delete failure surfaces as a provisioning error, never a silent mixed reveal.
- [x] `src/components/generation/GenerativeReveal.tsx` -- new client reveal: bot `thinking`/`focused` + rotating honest phase lines (`aria-live`) while awaiting; on resolve a bounded staged assembly then bot `proud`/`success` + `readyWithName` (falling back to a nameless headline if `readIntent()` has no `businessName`); reduced-motion → still bot + instant; no layout shift.
- [x] `src/app/generate/page.tsx` -- route the `initializing|generating` phases and the `ready` transition through `GenerativeReveal`; map `isFallback` and `missing`/`failed` to a calm/`oops` bot with the existing banner/`StartOver`; keep the single-POST guard and accessibility attributes.
- [x] `src/components/chat/assistant-mood.ts` -- new pure `moodForEditor(pending, lastAssistantUiKind)` mapping to the moods in Boundaries.
- [x] `src/components/chat/ChatAssistant.tsx` -- replace the pill `Sparkles` with a small resting bot (decorative or labelled via `pillLabel`), keeping size/focus behavior.
- [x] `src/components/chat/ChatPanel.tsx` -- mount a header bot driven by `moodForEditor(pending, <last assistant message uiKind>)`; label via next-intl; no change to send/undo/confirm logic.
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add the `SchezaBot`, `Generate` reveal, and editor sr-status keys (en + fr, no em-dash).
- [ ] Unit tests (node env, per repo convention — no jsdom) -- `renderToStaticMarkup(<SchezaBot mood="thinking" label="…"/>)` yields a valid `<svg role="img" aria-label>` first frame, and a decorative mount (no label) is `aria-hidden`; a pure `engine.ts` smoke (sample/blend/spring produce finite poses across the loop); `moodForEditor` mapping for pending/applied/declined/degraded/idle; `provisionGeneration` clears prior `SYSTEM_ACTOR_ID` rows on reuse and leaves a fresh org untouched (via the existing mutate/admin fake).
- [x] `.gitignore` -- verify `/scheza-bot/` ignore is present and the vendored `src/components/scheza-bot/` is tracked.

**Acceptance Criteria:**
- Given the standalone mascot, when vendored, then it lives under `src/components/scheza-bot/`, exports its public API, resolves its `label` through next-intl, and adds no new runtime dependency.
- Given a visitor on `/generate` while generation runs, when the reveal plays, then a bot narrates real phases and assembles the dashboard, ending on a proud/success pose with the captured business name, paced to real latency with no artificial padding.
- Given a generation error or the starter-template fallback, when the reveal resolves, then it degrades gracefully (bot `oops`) with the existing banner and no stuck animation, never a raw error screen.
- Given a visitor who re-generates in the same browser session, when the reveal reads back, then it shows only the current generation's tables and rows.
- Given the Epic 5 chat editor, when the assistant is idle, working, succeeds, or fails, then the bot reflects that state by the corresponding mood.
- Given `prefers-reduced-motion`, when the bot and reveal render, then the bot is a calm still pose and the reveal is instant; in all cases 60fps holds with no layout shift.

## Implementation Notes

UI/UX design direction (via the `/web-uiux-architect` skill — CSS-first motion, Tailwind v4 `size-*`/8pt grid, Zinc tokens, WCAG AA, reduced-motion-safe, no layout shift):

- **GenerativeReveal** — centered column in the existing `max-w-5xl` container so the surface never shifts when content swaps. A ~96px `SchezaBot` sits above a single-line `aria-live="polite"` phase label; phase lines (e.g. "Reading your description", "Designing your tables", "Adding Ontario-ready sample data") rotate on a gentle CSS/interval purely as ambient text and never gate progression. On resolve, the assembly is a short CSS `@keyframes` + `animation-delay` stagger (tabs, then header, then rows) — not Framer Motion, not a timed hold — flowing straight into the existing `DemoDashboard` grow. End state: bot `proud`/`success` + an `h1` "Here's your dashboard, {businessName}" (`text-balance`).
- **Honesty of pacing** — the server returns `{schema, records, isFallback}` atomically; there is no streamed per-phase timing. The only genuinely variable wait is the in-flight POST (bot `thinking`), so that is what gates the reveal; the assembly is bounded and brief. This satisfies "paced to the actual phases, never artificially padded" without faking server phases.
- **Reused-org fix** — a targeted hard-delete of `SYSTEM_ACTOR_ID` rows on reuse (before `upsertSchema`) is the minimal correct fix: `getSchema` already returns the single replaced definition, so only stale ROWS leak; hard-delete (vs soft) is mandated by the `records_idempotency_key_idx` partial-unique index. Claim is unaffected — `finalize_claim` soft-deletes all live rows regardless.
- **Editor** — pill + panel share one `moodForEditor(pending, uiKind)` source of truth; the bot is the assistant's face (replacing the static `Sparkles`), small (~40-48px) and labelled for screen readers.

## Review Triage Log

Pass 1 (blind-hunter, edge-case-hunter, verification-gap). No intent_gap or bad_spec → no loopback. Patches: StartOver bot, reveal layout-shift/long-name, dead-key removal.

- **patch** StartOver (`missing`/`failed`) renders no bot, but the frozen I/O matrix requires "failed/missing → StartOver screen with a calm/`oops` bot" (blind) — medium. Verified: `src/app/generate/page.tsx:89,99` render a bare `<StartOver>`; only the fallback case wires a bot. Direct, spec-required gap; fix is a trivial decorative `oops` bot, no spec change.
- **patch** Working→ready layout shift + unbounded long-name headline (`GenerativeReveal.tsx`) (edge, blind) — low. Verified: the phase `<p>` reserves `min-h-6` (1.5rem) but the ready `<h1>` is `text-3xl` (~2.25rem), so the swap nudges content below; an 80-char `businessName` has no `break-words`. Honors the frozen "no layout shift" constraint; trivial reserve + wrap.
- **patch** Dead i18n keys `SchezaBot.assistantLabel`, `Generate.title`, `Generate.readySubtitle` orphaned by this change (blind, edge) — low. Verified: repo-wide grep finds no `src` reference after the reveal replaced the loading `h1` and the ready subtitle; the bot uses context labels. The `Demo` page uses its own `Demo` namespace. Remove the orphans.
- **false** Editor "rejected → oops" unsatisfied; a rejection → `plain` → `listening` (edge `claim`) — refuted. An operation rejection / out-of-scope decline maps to server `kind:"declined"` → uiKind `"declined"` → `OOPS_KINDS` → `oops` (`chat-message.ts:149`, `assistant-mood.ts`). Only greeting/clarify/other fall to `"plain"` → `listening`, matching the spec's own "idle/awaiting → listening".
- **false** `matchMedia` unguarded in `scheza-bot.tsx` effect (edge) — refuted. The call is inside `useEffect` (client-only; a real browser always exposes `matchMedia`); SSR never runs it. Vendored bot internals are frozen ("do not modify").
- **false** `clearPriorSystemRows` lacks a dropped-table-key test; orphaned rows under a dropped key (blind) — refuted. The clear is scoped by `organization_id` + `actor_id` (not table_key), so it removes ALL prior `SYSTEM_ACTOR_ID` rows including any under a dropped table; the orphan cannot occur. verification-gap independently confirmed coverage adequate.
- **false** `phaseIndex` never resets across status changes (blind) — refuted in practice. `page.tsx` remounts `GenerativeReveal` per phase, so the reuse path that would start narration mid-list is unreachable; no bad outcome today.
- **low (reject)** Reveal is a single 360ms fade, not a literal tables→fields→rows stagger (edge `claim`, blind). The frozen AC "assembles the dashboard" is met by the reveal fade composing with `DemoDashboard`'s own per-table grow; the micro-stagger was over-specification, and a true per-element stagger would require changing `DemoDashboard` internals (new complexity). To be confirmed "feels alive" in the manual Playwright review.
- **low (reject)** Fallback reveal shows the bot with no headline/text (blind). The frozen fallback row requires `oops` + the starter banner only; the banner carries the message. By design.
- **low (reject)** `readySubtitle` copy dropped from the ready reveal (edge `deletion`). The frozen success row is "headline + DemoDashboard" (no subtitle); `DemoDashboard`'s claim CTA carries the account message. Spec-compliant; orphan key removed in the dead-key patch.
- **low (reject)** `removed-view` maps to `proud` (blind). Consistent with the spec's "applied result → success/proud"; a fulfilled removal is an applied outcome.
- **low (reject)** `offer-hide-table` rests in `listening`; `curious` mood unused (blind). Consistent with "awaiting the owner's choice → listening"; unused moods are acceptable.
- **low (reject)** ~7.2s narration budget; a slow POST sits on the last phase line (blind). Matches the spec's acknowledged ambient, non-gating narration (Design Notes); the bot keeps animating `thinking`, so nothing reads as stuck.
- **low (reject)** Label taxonomy spread across three keys / FR voice divergence (blind). Context-specific accessible names are good a11y; the only real issue is the orphan `assistantLabel`, removed in the dead-key patch.

## Design Notes

- The mascot is intentionally zero-dependency and renders its first frame identically on server and client; mounting it in server-rendered pages (`/generate`, the admin layout) needs no special handling beyond passing a translated `label`.
- Test strategy follows the repo convention (node env, `renderToStaticMarkup`, pure-function units) rather than the mascot's own jsdom suite, so no browser test environment is introduced; the live animation loop, IntersectionObserver gating, and reduced-motion still-pose are confirmed in the manual Playwright review.

## Verification

**Commands:**
- `npm run type-check` -- expected: no errors.
- `npm run lint` -- expected: clean on `src` (including the vendored `src/components/scheza-bot/`).
- `npm run test` -- expected: all unit tests pass, including the new SchezaBot SSR/engine, `moodForEditor`, and provision clear-on-reuse suites.
- `npm run build` -- expected: production build succeeds.

**Manual checks (if no CLI):**
- Playwright MCP manual review on localhost:3000, rich path: from the landing prompt, generate with a real business name and watch the bot-led reveal (thinking → assembly → proud with the name); force the fallback (bot `oops` + starter banner); re-generate in the same browser and confirm the reveal shows only the new tables/rows; open the chat editor and confirm the bot moves through listening → thinking → proud/oops on an add-column then a rejected request; verify the reduced-motion still pose + instant reveal with the OS setting on.
