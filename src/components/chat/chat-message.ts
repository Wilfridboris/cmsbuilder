import type { EditorChatResult } from "@/app/api/schema/edit/route";
import type { BubbleVariant } from "@/components/chat/MessageBubble";

/**
 * Pure dispatch for the AI Assistant chat (retro [A6]). The panel's result ->
 * message -> bubble-variant -> undo-target decisions used to live as eight
 * optional boolean/object discriminators on `ChatMessage` plus a deeply nested
 * render ternary — a shape no single story saw whole as 5.1-5.7 each bolted on a
 * new op. This module is that logic, as a SINGLE `uiKind` discriminant and three
 * pure functions, so the cross-story seam is unit-testable in the repo's node
 * test env (no DOM) instead of hiding inside component closures.
 *
 * `uiKind` is the one source of truth for how an assistant message renders and
 * what (if anything) its Undo does. Transitions (an undo, a hide-table confirm,
 * a keep) set a new `uiKind`; nothing reads the raw server `kind` to render.
 */

export type AssistantUiKind =
  /** Applied add-column (Story 5.1): emerald check; Undo HIDES the just-added column. */
  | "applied-field"
  /** Applied hide-column (Story 5.5, the safe "delete this column"): amber eye-off; Undo SHOWS it again. */
  | "hidden-field"
  /** Applied add-view (Story 5.3/5.6): filter glyph; Undo REMOVES the just-added view. */
  | "applied-view"
  /** Applied chat remove-view (Story 5.6): muted filter-off glyph; no Undo (removal was the request). */
  | "removed-view"
  /** Applied add-table (Story 5.2/5.7): table glyph; Undo HIDES the just-added table. */
  | "applied-table"
  /** Hide-table OFFER (Story 5.7, `kind:"confirm"`): shield glyph + Hide/Keep buttons; no mutation yet. */
  | "offer-hide-table"
  /** A just-hidden table (post-confirm or post-add-table-undo): amber eye-off; Undo RESTORES it. */
  | "hidden-table"
  /** A reassuring decline (Story 5.5 out-of-scope, or a kept table): plain bubble, no action. */
  | "declined"
  /** A graceful LLM/transport degradation: plain bubble, no action. */
  | "degraded"
  /** Any other assistant line (greeting, clarify, rejection): a plain assistant bubble. */
  | "plain";

export type ChatMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      uiKind: AssistantUiKind;
      text: string;
      /** Add/hide-column Undo payload. `direction` is the visibility the Undo SETS. */
      applied?: { tableKey: string; fieldKey: string; direction: "hide" | "show" };
      /** Add-view Undo payload (removes the view). */
      appliedView?: { viewKey: string; label: string };
      /** Hide-table offer payload (drives the Hide/Keep buttons). */
      offerTable?: { tableKey: string; label: string };
      /** Add-table Undo payload (hides the table). */
      appliedTableUndo?: { tableKey: string; label: string };
      /** Just-hidden-table payload (drives the show-again Undo). */
      hiddenTable?: { tableKey: string; label: string };
      /** Local flag once Undo has reversed this change (so its Undo affordance drops). */
      undone?: boolean;
    };

export type AssistantMessage = Extract<ChatMessage, { role: "assistant" }>;

/**
 * The client call an assistant message's Undo would make. Extracted so the
 * cross-story Undo wiring (which op each applied kind reverses, and with what
 * direction) is asserted directly in a unit test.
 */
export type UndoAction =
  | { kind: "restore-table"; tableKey: string }
  | { kind: "hide-table"; tableKey: string }
  | { kind: "remove-view"; viewKey: string }
  | {
      kind: "set-column-visibility";
      tableKey: string;
      fieldKey: string;
      hidden: boolean;
    };

/**
 * Map a server `EditorChatResult` to the assistant `ChatMessage` the panel shows.
 * Faithfully reproduces the former inline construction + render precedence: the
 * sub-cases are mutually exclusive by `kind`/`undo`, checked in the order the old
 * render ternary used (offer and the column/view/table applied cases).
 */
export function buildAssistantMessage(
  result: EditorChatResult,
  id: string,
): AssistantMessage {
  const base = { id, role: "assistant" as const, text: result.assistantText };

  // Applied add-column (undo "hide") or hide-column (undo "show") — Story 5.1 / 5.5.
  if (
    result.kind === "applied" &&
    result.tableKey &&
    result.fieldKey &&
    (result.undo === "hide" || result.undo === "show")
  ) {
    return {
      ...base,
      uiKind: result.undo === "show" ? "hidden-field" : "applied-field",
      applied: {
        tableKey: result.tableKey,
        fieldKey: result.fieldKey,
        direction: result.undo,
      },
    };
  }

  // Applied add-view (Story 5.3/5.6) — carries an Undo that removes the view.
  if (result.kind === "applied" && result.undo === "remove" && result.viewKey) {
    return {
      ...base,
      uiKind: "applied-view",
      appliedView: { viewKey: result.viewKey, label: result.label ?? result.viewKey },
    };
  }

  // Applied chat remove-view (Story 5.6): applied + a viewKey but no "remove" undo.
  if (result.kind === "applied" && Boolean(result.viewKey) && result.undo !== "remove") {
    return { ...base, uiKind: "removed-view" };
  }

  // Applied add-table (Story 5.2/5.7) — carries an Undo that hides the table.
  if (result.kind === "applied" && result.undo === "hide-table" && result.tableKey) {
    return {
      ...base,
      uiKind: "applied-table",
      appliedTableUndo: {
        tableKey: result.tableKey,
        label: result.label ?? result.tableKey,
      },
    };
  }

  // Hide-table OFFER (Story 5.7): the model's hide_table resolves to an offer,
  // not a mutation. The bubble renders confirm/keep buttons.
  if (
    result.kind === "confirm" &&
    result.confirm === "hide-table" &&
    result.tableKey
  ) {
    return {
      ...base,
      uiKind: "offer-hide-table",
      offerTable: { tableKey: result.tableKey, label: result.label ?? result.tableKey },
    };
  }

  if (result.kind === "declined") return { ...base, uiKind: "declined" };
  if (result.kind === "degraded") return { ...base, uiKind: "degraded" };
  return { ...base, uiKind: "plain" };
}

/** The presentational bubble variant for an assistant message's current state. */
export function bubbleVariantFor(message: AssistantMessage): BubbleVariant {
  switch (message.uiKind) {
    case "offer-hide-table":
      return "offerHideTable";
    case "hidden-table":
      return "tableHidden";
    case "applied-field":
      return message.undone ? "assistant" : "applied";
    case "hidden-field":
      return message.undone ? "assistant" : "hidden";
    case "applied-view":
      return message.undone ? "assistant" : "appliedView";
    case "removed-view":
      return "removedView";
    case "applied-table":
      return message.undone ? "assistant" : "appliedTable";
    case "declined":
      return "declined";
    case "degraded":
      return "degraded";
    case "plain":
      return "assistant";
  }
}

/** Whether this message currently offers a one-tap Undo. */
export function hasUndo(message: AssistantMessage): boolean {
  if (message.undone) return false;
  return (
    message.uiKind === "applied-field" ||
    message.uiKind === "hidden-field" ||
    message.uiKind === "applied-view" ||
    message.uiKind === "applied-table" ||
    message.uiKind === "hidden-table"
  );
}

/** Whether this message currently offers the hide-table confirm/keep buttons. */
export function hasHideTableOffer(message: AssistantMessage): boolean {
  return message.uiKind === "offer-hide-table";
}

/**
 * The inverse-op client call this message's Undo makes — the cross-story seam
 * 5.6/5.7 grew. Mirrors the panel's undo() branch order (hidden-table restore,
 * add-table hide, add-view remove, else column visibility flip).
 */
export function resolveUndoAction(message: AssistantMessage): UndoAction | null {
  if (message.hiddenTable) {
    return { kind: "restore-table", tableKey: message.hiddenTable.tableKey };
  }
  if (message.appliedTableUndo) {
    return { kind: "hide-table", tableKey: message.appliedTableUndo.tableKey };
  }
  if (message.appliedView) {
    return { kind: "remove-view", viewKey: message.appliedView.viewKey };
  }
  if (message.applied) {
    return {
      kind: "set-column-visibility",
      tableKey: message.applied.tableKey,
      fieldKey: message.applied.fieldKey,
      hidden: message.applied.direction === "hide",
    };
  }
  return null;
}
