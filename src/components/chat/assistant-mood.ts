import type { SchezaMood } from "@/components/scheza-bot";
import type { AssistantUiKind } from "@/components/chat/chat-message";

/**
 * Pure mood selector for the chat editor's SchezaBot face (Story 15.2).
 *
 * The pill and the panel header share THIS single source of truth so the bot
 * reflects editor state identically in both places. It is a plain function of
 * two inputs — whether a request is in flight (`pending`) and the `uiKind` of
 * the most recent assistant message — so it is unit-testable in the repo's node
 * env with no DOM and no component state.
 *
 * Mapping (per the story's Boundaries + I/O matrix):
 *   - request in flight            → `focused`
 *   - last reply was an applied op → `proud`   (success/proud family)
 *   - last reply declined/failed   → `oops`    (declined / degraded / rejected)
 *   - idle, or an offer / plain /
 *     greeting / clarify reply      → `waiting`
 *
 * `pending` wins over any prior message (the bot is actively working). With no
 * assistant message yet (a fresh panel) and nothing pending, the bot rests in
 * `waiting`.
 */

/** The `uiKind`s that represent a successfully applied schema change. */
const APPLIED_KINDS: ReadonlySet<AssistantUiKind> = new Set<AssistantUiKind>([
  "applied-field",
  "hidden-field",
  "applied-view",
  "removed-view",
  "applied-table",
  "hidden-table",
]);

/** The `uiKind`s that represent a declined, degraded, or rejected outcome. */
const OOPS_KINDS: ReadonlySet<AssistantUiKind> = new Set<AssistantUiKind>([
  "declined",
  "degraded",
]);

export function moodForEditor(
  pending: boolean,
  lastAssistantUiKind: AssistantUiKind | null,
): SchezaMood {
  // A request in flight: the bot is focused on the work, regardless of prior state.
  if (pending) {
    return "focused";
  }
  if (lastAssistantUiKind === null) {
    return "waiting";
  }
  if (APPLIED_KINDS.has(lastAssistantUiKind)) {
    return "proud";
  }
  if (OOPS_KINDS.has(lastAssistantUiKind)) {
    return "oops";
  }
  // `offer-hide-table` and `plain` (greeting, clarify, rejection) → the bot is
  // waiting for the owner's next move: a calm, attentive waiting pose.
  return "waiting";
}
