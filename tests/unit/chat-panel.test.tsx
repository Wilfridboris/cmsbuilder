import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildAssistantMessage,
  bubbleVariantFor,
  hasHideTableOffer,
  hasUndo,
  resolveUndoAction,
  type AssistantMessage,
} from "@/components/chat/chat-message";
import { MessageBubble } from "@/components/chat/MessageBubble";
import type { EditorChatResult } from "@/app/api/schema/edit/route";

/**
 * Coverage for the ChatPanel dispatch seam (retro [D5]). The panel grew one op per
 * story (5.1 add-column, 5.5 hide-column, 5.3/5.6 add/remove-view, 5.2/5.7
 * add/hide-table) and the result -> bubble -> Undo wiring — the seam no single
 * story saw whole — had ZERO tests. ChatPanel now drives that wiring through the
 * pure `chat-message` module, so this pins it directly: for every applied kind,
 * the right bubble variant renders and the Undo reverses with the MATCHING client
 * op (hide/show column, remove view, hide/restore table). The repo test env is
 * `node` (no DOM), so the interactive dispatch is asserted through these pure
 * functions — which ARE what the panel calls — plus a `renderToStaticMarkup`
 * smoke of the presentational bubble; live clicks stay manual-review only.
 */

function result(partial: Partial<EditorChatResult>): EditorChatResult {
  return { kind: "applied", assistantText: "ok", ...partial } as EditorChatResult;
}

function assistant(partial: Partial<AssistantMessage>): AssistantMessage {
  return { id: "m1", role: "assistant", uiKind: "plain", text: "x", ...partial };
}

describe("buildAssistantMessage — result -> message dispatch", () => {
  it("add-column (undo:hide) -> applied-field carrying the column Undo payload", () => {
    const m = buildAssistantMessage(
      result({ tableKey: "jobs", fieldKey: "warranty_date", undo: "hide", label: "Warranty date" }),
      "m1",
    );
    expect(m).toMatchObject({
      uiKind: "applied-field",
      applied: { tableKey: "jobs", fieldKey: "warranty_date", direction: "hide" },
    });
  });

  it("hide-column (undo:show, Story 5.5) -> hidden-field, direction show", () => {
    const m = buildAssistantMessage(
      result({ tableKey: "customers", fieldKey: "phone", undo: "show", label: "Phone" }),
      "m1",
    );
    expect(m).toMatchObject({
      uiKind: "hidden-field",
      applied: { tableKey: "customers", fieldKey: "phone", direction: "show" },
    });
  });

  it("add-view (undo:remove, Story 5.6) -> applied-view carrying the view Undo payload", () => {
    const m = buildAssistantMessage(
      result({ viewKey: "unpaid", undo: "remove", label: "Unpaid invoices" }),
      "m1",
    );
    expect(m).toMatchObject({
      uiKind: "applied-view",
      appliedView: { viewKey: "unpaid", label: "Unpaid invoices" },
    });
  });

  it("chat remove-view (applied + viewKey, no undo) -> removed-view, no Undo payload", () => {
    const m = buildAssistantMessage(result({ viewKey: "unpaid", label: "Unpaid" }), "m1");
    expect(m.uiKind).toBe("removed-view");
    expect(m.appliedView).toBeUndefined();
  });

  it("add-table (undo:hide-table, Story 5.7) -> applied-table carrying the table Undo payload", () => {
    const m = buildAssistantMessage(
      result({ tableKey: "timesheets", undo: "hide-table", label: "Timesheets" }),
      "m1",
    );
    expect(m).toMatchObject({
      uiKind: "applied-table",
      appliedTableUndo: { tableKey: "timesheets", label: "Timesheets" },
    });
  });

  it("hide-table OFFER (confirm, Story 5.7) -> offer-hide-table carrying the offer payload", () => {
    const m = buildAssistantMessage(
      result({ kind: "confirm", confirm: "hide-table", tableKey: "jobs", label: "Jobs" }),
      "m1",
    );
    expect(m).toMatchObject({
      uiKind: "offer-hide-table",
      offerTable: { tableKey: "jobs", label: "Jobs" },
    });
  });

  it("declined / degraded / clarify / rejected -> their plain ui kinds", () => {
    expect(buildAssistantMessage(result({ kind: "declined" }), "m1").uiKind).toBe("declined");
    expect(buildAssistantMessage(result({ kind: "degraded" }), "m1").uiKind).toBe("degraded");
    expect(buildAssistantMessage(result({ kind: "clarify" }), "m1").uiKind).toBe("plain");
    expect(buildAssistantMessage(result({ kind: "rejected" }), "m1").uiKind).toBe("plain");
  });

  it("falls back to label-less keys when the server omits a label", () => {
    const m = buildAssistantMessage(result({ viewKey: "v_42", undo: "remove" }), "m1");
    expect(m.appliedView).toEqual({ viewKey: "v_42", label: "v_42" });
  });
});

describe("resolveUndoAction — each applied kind reverses with the matching client op", () => {
  it("add-column Undo hides the column (set-column-visibility hidden:true)", () => {
    const m = buildAssistantMessage(
      result({ tableKey: "jobs", fieldKey: "warranty_date", undo: "hide" }),
      "m1",
    );
    expect(resolveUndoAction(m)).toEqual({
      kind: "set-column-visibility",
      tableKey: "jobs",
      fieldKey: "warranty_date",
      hidden: true,
    });
  });

  it("hide-column Undo shows the column again (set-column-visibility hidden:false)", () => {
    const m = buildAssistantMessage(
      result({ tableKey: "customers", fieldKey: "phone", undo: "show" }),
      "m1",
    );
    expect(resolveUndoAction(m)).toEqual({
      kind: "set-column-visibility",
      tableKey: "customers",
      fieldKey: "phone",
      hidden: false,
    });
  });

  it("add-view Undo removes the just-added view", () => {
    const m = buildAssistantMessage(result({ viewKey: "unpaid", undo: "remove" }), "m1");
    expect(resolveUndoAction(m)).toEqual({ kind: "remove-view", viewKey: "unpaid" });
  });

  it("add-table Undo hides the just-added table", () => {
    const m = buildAssistantMessage(result({ tableKey: "timesheets", undo: "hide-table" }), "m1");
    expect(resolveUndoAction(m)).toEqual({ kind: "hide-table", tableKey: "timesheets" });
  });

  it("a just-hidden table's Undo restores it", () => {
    const m = assistant({ uiKind: "hidden-table", hiddenTable: { tableKey: "jobs", label: "Jobs" } });
    expect(resolveUndoAction(m)).toEqual({ kind: "restore-table", tableKey: "jobs" });
  });

  it("a chat remove-view and an offer have no Undo action", () => {
    expect(resolveUndoAction(buildAssistantMessage(result({ viewKey: "v1" }), "m1"))).toBeNull();
    expect(
      resolveUndoAction(
        buildAssistantMessage(result({ kind: "confirm", confirm: "hide-table", tableKey: "jobs" }), "m1"),
      ),
    ).toBeNull();
  });
});

describe("bubbleVariantFor / hasUndo / hasHideTableOffer", () => {
  const cases: Array<[AssistantMessage["uiKind"], string, boolean]> = [
    ["applied-field", "applied", true],
    ["hidden-field", "hidden", true],
    ["applied-view", "appliedView", true],
    ["removed-view", "removedView", false],
    ["applied-table", "appliedTable", true],
    ["offer-hide-table", "offerHideTable", false],
    ["hidden-table", "tableHidden", true],
    ["declined", "declined", false],
    ["degraded", "degraded", false],
    ["plain", "assistant", false],
  ];

  it("maps each uiKind to its bubble variant and Undo availability", () => {
    for (const [uiKind, variant, undoable] of cases) {
      const m = assistant({ uiKind });
      expect(bubbleVariantFor(m)).toBe(variant);
      expect(hasUndo(m)).toBe(undoable);
    }
  });

  it("an undone applied message drops its glyph (renders plain) and its Undo", () => {
    for (const uiKind of ["applied-field", "hidden-field", "applied-view"] as const) {
      const m = assistant({ uiKind, undone: true });
      expect(bubbleVariantFor(m)).toBe("assistant");
      expect(hasUndo(m)).toBe(false);
    }
  });

  it("only the offer message shows the hide-table confirm/keep buttons", () => {
    expect(hasHideTableOffer(assistant({ uiKind: "offer-hide-table" }))).toBe(true);
    expect(hasHideTableOffer(assistant({ uiKind: "hidden-table" }))).toBe(false);
    expect(hasHideTableOffer(assistant({ uiKind: "applied-table" }))).toBe(false);
  });
});

describe("MessageBubble presentation smoke (renderToStaticMarkup)", () => {
  it("renders the text and any Undo child for an applied bubble", () => {
    const html = renderToStaticMarkup(
      <MessageBubble variant="applied" text="Done. I added Warranty date.">
        <button type="button">Undo</button>
      </MessageBubble>,
    );
    expect(html).toContain("Done. I added Warranty date.");
    expect(html).toContain("Undo");
  });

  it("renders the hide-table offer bubble with its confirm/keep children", () => {
    const html = renderToStaticMarkup(
      <MessageBubble variant="offerHideTable" text="I can hide the Jobs table instead.">
        <button type="button">Hide the table</button>
        <button type="button">Keep it</button>
      </MessageBubble>,
    );
    expect(html).toContain("Hide the table");
    expect(html).toContain("Keep it");
  });
});
