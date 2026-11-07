---
title: 'Remove the SchezaBot animation (revert Story 15.2 UI)'
type: 'refactor'
created: '2026-11-06'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'c5c1107d46467fd3e995f00ddaf8befbff42dcc3'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 15.2 added the vendored SchezaBot mascot as the app's visible AI presence — the bot-led signature reveal on `/generate` and the bot face on the Epic 5 chat editor (pill + panel header). We now want that animated bot and its reveal removed completely, returning those surfaces to how they behaved before 15.2.

**Approach:** Delete the vendored mascot and the reveal/mood code, and revert the three mount sites (`/generate`, chat pill, chat panel header) to their exact pre-15.2 state (plain `animate-pulse` skeleton → `DemoDashboard` on `/generate`; `Sparkles` glyph on the pill and panel header). Surgically drop only the bot-specific i18n keys and restore the pre-15.2 `Generate` copy, leaving all unrelated Story 15.3 polish (copy scrubs, promo codes, money, icons) intact.

## Boundaries & Constraints

**Always:**
- Revert `src/app/generate/page.tsx`, `src/components/chat/ChatAssistant.tsx`, and `src/components/chat/ChatPanel.tsx` to their pre-15.2 state (baseline commit `5d94afabc46d2bff41ad6139144a79b40c92b5ca`). These three files were touched ONLY by the two bot commits since that baseline, so a verbatim restore is exact and loses no later work.
- Delete the vendored mascot and bot-only modules entirely: the whole `src/components/scheza-bot/` directory, `src/components/generation/GenerativeReveal.tsx`, `src/components/chat/assistant-mood.ts`, and their unit tests `tests/unit/scheza-bot.test.tsx` and `tests/unit/assistant-mood.test.ts`.
- i18n (`en.json` + `fr.json`): remove ONLY the bot keys — `Generate.readyWithName`, `Generate.botLabel`, `Generate.phaseReading`, `Generate.phaseDesigning`, `Generate.phaseSeeding`, `Generate.phaseFinishing`, and `ChatAssistant.botLabel` — and restore the two pre-15.2 `Generate` keys the reveal removed, `title` and `readySubtitle`, with their pre-15.2 values (from the baseline commit). Touch no other key.
- After removal, no source or test file references `scheza-bot`, `SchezaBot`, `SCHEZA_MOODS`, `SchezaMood`, `GenerativeReveal`, `assistant-mood`, or `moodForEditor`; `/generate` renders the pulse skeleton then `DemoDashboard`, and the chat pill + panel header show the `Sparkles` glyph.
- Preserve the pre-15.2 behavior fully: the single-POST StrictMode guard, the `isFallback` starter-template banner, the `missing`/`failed` `StartOver` screens, and `aria-busy`/`aria-live` on the loading region all remain (the baseline files already carry them; the `StartOver` screen simply no longer renders a bot).
- All user-facing copy stays next-intl-resolved (en + fr) and contains no em-dash.
- **Resolved decision (provision fix):** KEEP the Story 15.2 `provisionGeneration` reused-anonymous-session fix. It is a data-correctness fix independent of the animation, so `src/lib/generation/provision.ts` and `tests/unit/provision.test.ts` are left UNTOUCHED; same-session re-generation must still show only the current generation's rows.

**Never:**
- Do not touch `src/components/dashboard/DemoDashboard.tsx` — the bot composed with it but never modified it.
- Do not revert `src/lib/generation/provision.ts` or `tests/unit/provision.test.ts` (see Resolved decision above).
- Do not alter or revert unrelated Story 15.3 polish anywhere (the i18n em-dash scrubs, promo-code, money, and icon changes): the i18n edit is key-surgical, not a namespace or file-level revert.
- Do not add any new dependency, component, or animation to replace the bot; the goal is the prior plain state, not a new treatment.
- Do not reintroduce the removed bot i18n keys in either locale, and do not leave any orphaned/dangling i18n key referenced by no code.
- The `.gitignore` entry for the top-level `/scheza-bot/` distribution stays as-is (it is unrelated to the vendored copy under `src/`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Generate: loading | `initializing`/`generating`, POST in flight | plain `DashboardSkeleton` (`animate-pulse`) under `aria-busy`/`aria-live`; no bot, no narration | n/a |
| Generate: success | 200 real generation | `DemoDashboard` renders with its own grow + the `Generate.title`/`readyTitle`/`readySubtitle` copy as pre-15.2; no bot, no staged reveal | n/a |
| Generate: fallback | `isFallback: true` | existing starter-template banner renders above `DemoDashboard`; no bot | graceful |
| Generate: failed / missing | `failed` or `missing` phase | `StartOver` screen with pre-15.2 copy; no bot | graceful |
| Chat pill | admin floating entry point | `Sparkles` glyph pill (pre-15.2), `pillLabel` + focus-return preserved | n/a |
| Chat panel header | panel open, any state | `Sparkles` glyph + dialog Title (pre-15.2); no mood-driven bot | n/a |

</frozen-after-approval>

## Code Map

- `src/components/scheza-bot/` (`engine.ts`, `expressions.ts`, `fx.tsx`, `ticker.ts`, `scheza-bot.tsx`, `index.ts`) -- the whole vendored mascot. DELETE the directory. Only consumers are the three mount sites below and the two bot tests.
- `src/components/generation/GenerativeReveal.tsx` -- bot-led reveal client component (new in 15.2). DELETE. (`src/components/generation/PromptBuilder.tsx` stays.)
- `src/components/chat/assistant-mood.ts` -- pure `moodForEditor` helper (new in 15.2). DELETE.
- `src/app/generate/page.tsx` -- reveal host; imports `GenerativeReveal` + `SchezaBot`. REVERT verbatim to `5d94afab:src/app/generate/page.tsx` (pulse skeleton → `DemoDashboard`; `StartOver` with no bot). Only the two bot commits touched it since baseline.
- `src/components/chat/ChatAssistant.tsx` -- admin pill; renders `SchezaBot mood="waiting"`. REVERT verbatim to `5d94afab:...` (the `Sparkles` glyph pill). Only the two bot commits touched it since baseline.
- `src/components/chat/ChatPanel.tsx` -- panel header; imports `SchezaBot` + `moodForEditor`, renders a mood-driven header bot (lines ~11-12, 96-105, 344). REVERT verbatim to `5d94afab:...` (header `Sparkles` glyph, no mood logic). Only the two bot commits touched it since baseline.
- `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- SURGICAL: delete the 6 `Generate` bot keys + `ChatAssistant.botLabel`; restore `Generate.title` and `Generate.readySubtitle` from `5d94afab` (en + fr). Do NOT revert the files (15.3 polish lives here: e.g. current `Generate.fallbackBanner` is the 15.3 em-dash-free wording — keep it).
- `tests/unit/scheza-bot.test.tsx`, `tests/unit/assistant-mood.test.ts` -- bot-only unit suites. DELETE.
- `src/lib/generation/provision.ts` + `tests/unit/provision.test.ts` -- the reused-org data fix; KEEP, left untouched (resolved decision).
- Baseline reference: `5d94afabc46d2bff41ad6139144a79b40c92b5ca` (parent of bot commit `b87c66a`). Bot commits since: `b87c66a` (feat 15.2) and `d814a49` (mood fix).

## Tasks & Acceptance

**Execution:**
- [x] `src/components/scheza-bot/` -- delete the directory (all six files).
- [x] `src/components/generation/GenerativeReveal.tsx` -- delete.
- [x] `src/components/chat/assistant-mood.ts` -- delete.
- [x] `tests/unit/scheza-bot.test.tsx` + `tests/unit/assistant-mood.test.ts` -- delete.
- [x] `src/app/generate/page.tsx` -- restore verbatim from baseline `5d94afab`.
- [x] `src/components/chat/ChatAssistant.tsx` -- restore verbatim from baseline `5d94afab`.
- [x] `src/components/chat/ChatPanel.tsx` -- restore verbatim from baseline `5d94afab`.
- [x] `src/lib/i18n/en.json` -- remove `Generate.{readyWithName,botLabel,phaseReading,phaseDesigning,phaseSeeding,phaseFinishing}` and `ChatAssistant.botLabel`; restore `Generate.title` and `Generate.readySubtitle` from baseline. Preserve every other key (esp. 15.3 copy).
- [x] `src/lib/i18n/fr.json` -- same surgical removal + restore, using the baseline fr values.
- [x] Repo-wide check: no remaining reference to any bot symbol or module path, and no dangling i18n key.

**Acceptance Criteria:**
- Given a visitor on `/generate` while generation runs, when the page loads, then it shows the plain `animate-pulse` skeleton and then `DemoDashboard`, with no bot and no staged reveal, exactly as before Story 15.2.
- Given a generation fallback or a failed/missing state, when the page resolves, then the existing starter-template banner / `StartOver` screen renders with no bot and never a raw error.
- Given the admin chat editor, when the pill and the panel header render, then both show the `Sparkles` glyph and no mood-driven bot, with pill `aria-label`/focus-return and all send/undo/confirm logic unchanged.
- Given the full test/lint/type/build suite, when it runs after removal, then it passes with no reference to any SchezaBot/reveal/mood symbol and no orphaned i18n key in either locale.

## Implementation Notes

- Implemented as specified against baseline `c5c1107`. The three mount files (`generate/page.tsx`, `ChatAssistant.tsx`, `ChatPanel.tsx`) were restored byte-identical to baseline `5d94afab` (confirmed via `git diff 5d94afa` = empty for those paths); bot modules + their two unit suites deleted; i18n edited key-surgically in both locales (6 `Generate` reveal keys + `ChatAssistant.botLabel` removed, `Generate.title`/`readySubtitle` restored, 15.3 `fallbackBanner` and all other polish preserved). `provision.ts`/`provision.test.ts`/`DemoDashboard.tsx`/`.gitignore` untouched per the resolved decision.
- Verification: `type-check`, `lint`, `build` all exit 0; repo-wide grep for every bot symbol/module path = no matches; en/fr key parity holds for `Generate` and `ChatAssistant`. `npm run test` passes; the subagent observed a small, shifting set of `Test timed out in 5000ms` flakes in unrelated files under the 163-worker parallel run that pass in isolation (pre-existing runner contention, not caused by this change).
- Matrix coverage: the I/O matrix rows are restored pre-15.2 render states on async server/client components, which this repo verifies via the post-commit Playwright MCP manual review (per the 15.2 Design Notes and project convention) rather than per-row unit tests; the unit-tested logic around them (`route-generate` payload, provision) stays green.

## Review Triage Log

Pass 1 (blind-hunter, edge-case-hunter, verification-gap). edge-case and verification-gap: no findings. blind-hunter: 9. No intent_gap / bad_spec → no loopback. 1 patch (stale ledger entry), 1 defer (planning-doc reconciliation), 7 rejected.

- **patch** Stale deferred-work entry (`deferred-work.md:314-316`) tells a future bmad-loop agent to "wire the SchezaBot mascot mood into the remaining dashboard/forms empty-and-error states" and asserts "The component is vendored into src/components/scheza-bot" — now false, the directory is deleted (blind) — low. Verified at lines 314-316. Caused directly by this change; smallest fix is a trivial deletion of the now-moot entry. Applied in this step (doc-only, no code; code verification unaffected).
- **defer** Planning records (`epics.md` Story 15.2, `epic-15-context.md`, `spec-15-2-...md`) still describe the delivered mascot/bot-led reveal as current, with no note of the reversal (blind) — low. Verified: those are historical point-in-time artifacts; this repo already treats planning-doc reconciliation as out-of-scope-for-the-build (see the analogous Story 15.1 FR105 ledger entry). The git history + this spec are the record of the reversal. Deferred as a planning-doc reconciliation.
- **false** `businessName` no longer surfaced on `/generate`; the ready screen greets everyone with generic "Your dashboard is ready" instead of "Here's your dashboard, {businessName}" (blind). Refuted: the frozen Intent is "returning those surfaces to how they behaved before Story 15.2"; the personalized greeting was part of the removed reveal and the pre-15.2 ready screen used `readyTitle` with no name. The spec explicitly restores `readyTitle`/`readySubtitle`, so dropping the greeting is the intended revert, not a silent side effect. The name is still captured/used by PromptBuilder + ClaimModal.
- **low (reject)** No unit/render test replaces the two deleted bot suites; the reverted `/generate` render states + chat `Sparkles` glyph have no unit coverage (blind). The pre-15.2 baseline (the restore target) had no such tests either, so this is not a regression; the repo verifies these async server/client surfaces via the post-commit Playwright MCP review by deliberate convention (per the 15.2 Design Notes). Fix (a render harness) is new complexity against convention. Rejected.
- **low (reject)** Vestigial `aria-live="polite"` on the loading `<main>` wraps only static content now that the rotating narration is gone (blind). This is the byte-identical pre-15.2 markup (the restore target); `aria-busy` + `aria-label` already signal loading and a live region with no updating content announces nothing (no harm). Faithful-baseline, negligible. Rejected.
- **low (reject)** Possible skeleton→skeleton→content flash at working→ready now that GenerativeReveal's staged assembly is gone (blind). This is the restored pre-15.2 sequence (`DashboardSkeleton` then `DemoDashboard`'s own grow), which shipped acceptably before 15.2; `DemoDashboard` is untouched. Flagged for the manual Playwright review (CLS/jarring-swap check). Rejected as a defect.
- **false** Top-level `/scheza-bot/` distribution + `.gitignore:67` / `tsconfig.json:38` exclude now orphaned (blind). Refuted: the top-level `/scheza-bot/` is an independent, pre-existing, gitignored standalone distribution (the source the mascot was vendored FROM), not created or orphaned by this change; the spec deliberately leaves `.gitignore` as-is, and the tsconfig exclude is harmless. Not this change's concern.
- **low (reject)** Loading/ready header copy was last tuned for the bot presentation; re-review two-line headers standalone (blind). This is the faithful pre-15.2 copy that previously shipped standalone; no named harm. Rejected (subjective, negligible).
- **false** `Generate.title` reintroduces a trailing ellipsis "…" (U+2026); confirm vs house-style (blind). Refuted: the project copy rule is specifically no em-dash (U+2014); a typographic ellipsis is standard and is the faithful pre-15.2 value restored verbatim. Not a rule violation.

## Verification

**Commands:**
- `npm run type-check` -- expected: no errors (no dangling bot imports).
- `npm run lint` -- expected: clean on `src`.
- `npm run test` -- expected: all unit tests pass; the two deleted bot suites are gone and nothing imports them.
- `npm run build` -- expected: production build succeeds.
- `grep -rn "scheza-bot\|SchezaBot\|GenerativeReveal\|assistant-mood\|moodForEditor\|SCHEZA_MOODS\|SchezaMood" src tests` -- expected: no matches.

**Manual checks (if no CLI):**
- Playwright MCP manual review on localhost:3000: from the landing prompt, generate and confirm the plain skeleton → dashboard with no bot; force the fallback (banner, no bot); open the admin chat editor and confirm the `Sparkles` pill + header and a working add-column / undo with no bot.
