"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import type { FieldDefinition } from "@/types/db";
import { formatCell, type CellStrings } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { coerceAddValue, inputModeFor } from "@/lib/forms/field-input";

/**
 * InlineEditCell (Story 3.3) — one click-to-edit value on the authenticated
 * records surface. Used in BOTH the desktop `<Table>` cells and the mobile card
 * values (headline + `<dl>`), so inline edit works identically on both.
 *
 * Read mode: a focusable trigger showing the shared `formatCell` output with a
 * real accessible name (`editValueLabel` = "Edit {field}"). Activating it (click,
 * Enter, or Space) swaps in a `type`-matched input seeded with the current value.
 *
 * Edit mode mirrors the 3.2 field-input pattern (never forks it): the control
 * type comes from `HTML_INPUT_TYPE` + `inputModeFor`, and the single edited value
 * is coerced with `coerceAddValue` — empty→omit is exactly "clear the field",
 * an invalid `number`/`currency` shows an inline `role="alert"` and stays in edit
 * mode, everything else commits. `boolean` uses a two-choice toggle that commits
 * IMMEDIATELY on selection (no separate blur/Enter). Commit fires on blur OR
 * Enter; Escape reverts to the original with no write.
 *
 * Commit-once discipline: a blur triggered by pressing Enter must not double
 * submit, and an unchanged draft must not write. Both are handled by comparing
 * the coerced outcome against the original before calling `onCommit`, plus a
 * one-shot guard so the Enter→blur pair only commits once.
 *
 * When `editable` is false (relation / hidden — no inline picker until Story 3.7)
 * the cell renders the read-only `formatCell` text with no edit affordance.
 */

/** HTML input type per field type — mirrors `AddRecordForm.HTML_INPUT_TYPE`. */
const HTML_INPUT_TYPE: Partial<Record<FieldDefinition["type"], string>> = {
  email: "email",
  phone: "tel",
  date: "date",
  datetime: "datetime-local",
};

/**
 * The committed outcome handed to the parent: either `omit` (the value was
 * cleared — drop the key from `data`) or `ok` with the coerced value. Mirrors
 * `CoerceResult` minus the `error` case, which the cell resolves inline.
 */
export type InlineCommit =
  | { kind: "omit" }
  | { kind: "ok"; value: unknown };

type InlineEditCellProps = {
  field: FieldDefinition;
  value: unknown;
  cellStrings: CellStrings;
  /** Commit the coerced edit (parent builds the merged `data` and saves). */
  onCommit: (result: InlineCommit) => void;
  /** True while a save is in flight for this row — the trigger is inert. */
  pending: boolean;
  /** False for relation/hidden/optimistic — render read-only, no affordance. */
  editable: boolean;
};

/** Stringify a stored value for a text input (booleans handled separately). */
function toInputString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

export function InlineEditCell({
  field,
  value,
  cellStrings,
  onCommit,
  pending,
  editable,
}: InlineEditCellProps) {
  const t = useTranslations("SlugDashboard");
  const [editing, setEditing] = useState(false);
  // Return focus to the read trigger after an edit closes (Enter/blur/Escape),
  // so keyboard users are not dumped to <body>. `refocus` is armed when we leave
  // edit mode; the effect fires once the read button has re-mounted.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      triggerRef.current?.focus();
    }
  }, [editing]);

  const leaveEditing = () => {
    refocus.current = true;
    setEditing(false);
  };

  // Read-only cells (relation, hidden, or an un-settled optimistic row) show the
  // formatted value with no interactive affordance.
  if (!editable) {
    return (
      <span className="min-w-0 break-words text-pretty">
        {formatCell(value, field.type, cellStrings)}
      </span>
    );
  }

  const accessibleName = t("editValueLabel", { field: field.label });

  if (!editing) {
    return (
      <button
        ref={triggerRef}
        type="button"
        disabled={pending}
        onClick={() => setEditing(true)}
        aria-label={accessibleName}
        className={cn(
          "flex min-h-12 w-full items-center rounded-md px-2 py-1 text-left transition-colors",
          "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-60",
        )}
      >
        <span className="min-w-0 break-words text-pretty">
          {formatCell(value, field.type, cellStrings)}
        </span>
      </button>
    );
  }

  return (
    <InlineEditor
      field={field}
      value={value}
      accessibleName={accessibleName}
      invalidNumberLabel={t("invalidNumber")}
      trueLabel={t("boolTrue")}
      falseLabel={t("boolFalse")}
      onCancel={leaveEditing}
      onCommit={(result) => {
        leaveEditing();
        onCommit(result);
      }}
    />
  );
}

/**
 * The active editor for one cell — remounted each time edit mode is entered, so
 * its initializers always read the current value (no effect-driven resync). The
 * parent closes edit mode via `onCancel` / `onCommit`.
 */
function InlineEditor({
  field,
  value,
  accessibleName,
  invalidNumberLabel,
  trueLabel,
  falseLabel,
  onCancel,
  onCommit,
}: {
  field: FieldDefinition;
  value: unknown;
  accessibleName: string;
  invalidNumberLabel: string;
  trueLabel: string;
  falseLabel: string;
  onCancel: () => void;
  onCommit: (result: InlineCommit) => void;
}) {
  const errorId = useId();

  // `boolean` commits immediately on selection — no draft, no blur/Enter.
  if (field.type === "boolean") {
    // Distinguish an UNSET boolean (never written) from a stored `false`: when
    // unset, neither choice is "current", so selecting either — including No —
    // is a real write (otherwise No would be a silent no-op).
    const isUnset = value === null || value === undefined;
    const current = Boolean(value);
    return (
      <div
        role="radiogroup"
        aria-label={accessibleName}
        className="flex h-12 w-fit overflow-hidden rounded-md border border-input"
      >
        {[true, false].map((option) => {
          const selected = !isUnset && current === option;
          return (
            <button
              key={String(option)}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                // Commit-once: selecting the already-current value is a no-op,
                // but an unset boolean has no current value, so always commit.
                if (selected) {
                  onCancel();
                  return;
                }
                onCommit({ kind: "ok", value: option });
              }}
              className={cn(
                "min-h-12 min-w-12 px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                selected
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-foreground hover:bg-accent",
              )}
            >
              {option ? trueLabel : falseLabel}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <ScalarEditor
      field={field}
      value={value}
      accessibleName={accessibleName}
      invalidNumberLabel={invalidNumberLabel}
      errorId={errorId}
      onCancel={onCancel}
      onCommit={onCommit}
    />
  );
}

function ScalarEditor({
  field,
  value,
  accessibleName,
  invalidNumberLabel,
  errorId,
  onCancel,
  onCommit,
}: {
  field: FieldDefinition;
  value: unknown;
  accessibleName: string;
  invalidNumberLabel: string;
  errorId: string;
  onCancel: () => void;
  onCommit: (result: InlineCommit) => void;
}) {
  const original = toInputString(value);
  const [draft, setDraft] = useState(() => original);
  const [error, setError] = useState(false);
  // One-shot latch: pressing Enter commits AND blurs the input, which would fire
  // `commit` twice. The latch makes the second call a no-op.
  const done = useRef(false);
  // Tracks whether the user actually edited the input. A cell whose value could
  // not seed the native control renders blank (e.g. a full-ISO `datetime` in a
  // `datetime-local`); without this, simply opening then blurring would coerce
  // the blank draft to `omit` and SILENTLY CLEAR the stored value. An untouched
  // input never commits.
  const dirty = useRef(false);

  // Focus + select on mount via a callback ref (the `autoFocus` prop is lint
  // forbidden); focus here is scoped to an explicit user "edit" action.
  const focusInput = useCallback((node: HTMLInputElement | null) => {
    if (node) {
      node.focus();
      node.select();
    }
  }, []);

  const commit = () => {
    if (done.current) return;

    // Untouched input (or unchanged draft) → skip the write entirely. The
    // `dirty` guard is what stops an un-seedable date/datetime cell from being
    // cleared just by opening and blurring it.
    if (!dirty.current || draft.trim() === original.trim()) {
      done.current = true;
      onCancel();
      return;
    }

    const result = coerceAddValue(field.type, draft);
    if (result.kind === "error") {
      setError(true);
      return; // stay in edit mode; no write.
    }

    done.current = true;
    if (result.kind === "omit") {
      onCommit({ kind: "omit" });
    } else {
      onCommit({ kind: "ok", value: result.value });
    }
  };

  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  return (
    <div className="flex flex-col gap-1">
      <Input
        ref={focusInput}
        type={HTML_INPUT_TYPE[field.type] ?? "text"}
        inputMode={inputModeFor(field.type)}
        value={draft}
        aria-label={accessibleName}
        aria-invalid={error}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          dirty.current = true;
          setDraft(event.target.value);
          if (error) setError(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        onBlur={commit}
        className="min-h-12"
      />
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {invalidNumberLabel}
        </p>
      ) : null}
    </div>
  );
}
