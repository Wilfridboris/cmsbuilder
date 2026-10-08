import { describe, expect, it } from "vitest";

import { moodForEditor } from "@/components/chat/assistant-mood";
import type { AssistantUiKind } from "@/components/chat/chat-message";

/**
 * The chat editor's bot-mood source of truth (Story 15.2). The pill and the
 * panel header both derive the SchezaBot mood from `moodForEditor(pending,
 * lastAssistantUiKind)`, so pinning this pure map pins how the assistant's face
 * reflects state (waiting → focused → proud/oops) in both places.
 */

describe("moodForEditor", () => {
  it("is `focused` whenever a request is in flight, overriding any prior reply", () => {
    expect(moodForEditor(true, null)).toBe("focused");
    expect(moodForEditor(true, "applied-field")).toBe("focused");
    expect(moodForEditor(true, "degraded")).toBe("focused");
  });

  it("rests in `waiting` when idle with no assistant message yet", () => {
    expect(moodForEditor(false, null)).toBe("waiting");
  });

  it("is `proud` after any applied schema change", () => {
    const applied: AssistantUiKind[] = [
      "applied-field",
      "hidden-field",
      "applied-view",
      "removed-view",
      "applied-table",
      "hidden-table",
    ];
    for (const kind of applied) {
      expect(moodForEditor(false, kind), kind).toBe("proud");
    }
  });

  it("is `oops` after a declined or degraded reply", () => {
    expect(moodForEditor(false, "declined")).toBe("oops");
    expect(moodForEditor(false, "degraded")).toBe("oops");
  });

  it("stays `waiting` for an offer or a plain reply (greeting / clarify / rejection)", () => {
    expect(moodForEditor(false, "offer-hide-table")).toBe("waiting");
    expect(moodForEditor(false, "plain")).toBe("waiting");
  });
});
