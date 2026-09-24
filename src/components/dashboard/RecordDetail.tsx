"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Pencil, X } from "lucide-react";

import type { FieldDefinition, RecordData, TableDefinition } from "@/types/db";
import { formatCell, type CellStrings } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * RecordDetail (Story 1.6) — the accessible open-a-record surface.
 *
 * Radix `Dialog` gives us the frozen a11y contract for free: focus is trapped
 * inside the panel while open, `Esc` and the overlay close it, and focus returns
 * to the trigger (the row/card) on close. It renders EVERY field of one record
 * as a label + type-formatted value (via the shared `formatCell`), and provides
 * a basic in-place edit affordance: click "edit" on a scalar field, change it,
 * confirm — the change is lifted to the parent's client-side session state
 * (optimistic, no DB write, no API). Invalid/empty input shows an inline
 * translated message and does NOT commit.
 *
 * All strings resolve through next-intl (`Dashboard` + reused `Generate.cell*`);
 * every ARIA label is derived from the schema `label`s.
 */

export type EditableFieldTypes = FieldDefinition["type"];

type RecordDetailProps = {
  /** The table whose field definitions describe the open record. */
  table: TableDefinition;
  /** The record to show, or `null` when the dialog is closed. */
  record: RecordData | null;
  /** Close handler — Radix calls this on Esc / overlay / close button. */
  onClose: () => void;
  /**
   * Commit an in-place edit to session state. The parent owns the records, so
   * the optimistic update reflects in the list immediately as well.
   */
  onEdit: (fieldKey: string, value: unknown) => void;
};

export function RecordDetail({
  table,
  record,
  onClose,
  onEdit,
}: RecordDetailProps) {
  const t = useTranslations("Dashboard");
  const tGenerate = useTranslations("Generate");

  const cellStrings: CellStrings = {
    empty: tGenerate("cellEmpty"),
    yes: tGenerate("cellYes"),
    no: tGenerate("cellNo"),
  };

  const visibleFields = table.fields.filter((field) => !field.hidden);

  return (
    <Dialog
      open={record !== null}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent
        closeLabel={t("close")}
        className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="text-balance">
            {t("detailTitle", { table: table.label })}
          </DialogTitle>
          <DialogDescription className="text-pretty">
            {t("detailSubtitle")}
          </DialogDescription>
        </DialogHeader>

        {record ? (
          <dl className="flex flex-col divide-y divide-border">
            {visibleFields.map((field) => (
              <FieldRow
                key={field.key}
                field={field}
                value={record.data[field.key]}
                cellStrings={cellStrings}
                onCommit={(value) => onEdit(field.key, value)}
              />
            ))}
          </dl>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** One `<dt>/<dd>` pair with a basic in-place edit affordance. */
function FieldRow({
  field,
  value,
  cellStrings,
  onCommit,
}: {
  field: FieldDefinition;
  value: unknown;
  cellStrings: CellStrings;
  onCommit: (value: unknown) => void;
}) {
  const t = useTranslations("Dashboard");
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <dt className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-muted-foreground">
          {field.label}
        </span>
        <Badge variant="outline" className="font-normal">
          {t(`type.${field.type}`)}
        </Badge>
      </dt>
      <dd className="text-sm text-foreground">
        {editing ? (
          <FieldEditor
            field={field}
            value={value}
            onCancel={() => setEditing(false)}
            onCommit={(next) => {
              onCommit(next);
              setEditing(false);
            }}
          />
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 break-words text-pretty">
              {formatCell(value, field.type, cellStrings)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-12 shrink-0 gap-1.5 px-3 text-muted-foreground hover:text-foreground"
              onClick={() => setEditing(true)}
              aria-label={t("editField", { field: field.label })}
            >
              <Pencil aria-hidden="true" className="size-3.5" />
              <span>{t("edit")}</span>
            </Button>
          </div>
        )}
      </dd>
    </div>
  );
}

/**
 * The inline editor for one scalar field. Client-side session edit only:
 * validates on confirm, shows a translated inline message on invalid/empty
 * input, and commits the coerced value (number/boolean/text) upward — never a
 * DB write. `boolean` uses a two-choice toggle; everything else uses a text
 * input with a type hint. There is no `relation` case (never generated).
 */
function FieldEditor({
  field,
  value,
  onCancel,
  onCommit,
}: {
  field: FieldDefinition;
  value: unknown;
  onCancel: () => void;
  onCommit: (value: unknown) => void;
}) {
  const t = useTranslations("Dashboard");
  // The editor is remounted each time edit mode is entered (it only renders
  // while editing), so these initializers always read the current value — no
  // effect-driven resync needed.
  const [draft, setDraft] = useState(() => toInputString(value));
  const [boolDraft, setBoolDraft] = useState(() => Boolean(value));
  const [error, setError] = useState<string | null>(null);

  // Focus + select the input on mount via a callback ref (avoids the
  // `autoFocus` prop, which the a11y lint rule forbids). Focus here is
  // intentional and scoped to an explicit user "edit" action, not page load.
  const focusInput = useCallback((node: HTMLInputElement | null) => {
    if (node) {
      node.focus();
      node.select();
    }
  }, []);

  if (field.type === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <div
          role="radiogroup"
          aria-label={t("editField", { field: field.label })}
          className="flex overflow-hidden rounded-md border border-input"
        >
          {[true, false].map((option) => (
            <button
              key={String(option)}
              type="button"
              role="radio"
              aria-checked={boolDraft === option}
              onClick={() => setBoolDraft(option)}
              className={cn(
                "min-h-12 px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                boolDraft === option
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-foreground hover:bg-accent",
              )}
            >
              {option ? t("boolTrue") : t("boolFalse")}
            </button>
          ))}
        </div>
        <EditActions
          onCancel={onCancel}
          onConfirm={() => onCommit(boolDraft)}
          confirmLabel={t("save")}
          cancelLabel={t("cancel")}
        />
      </div>
    );
  }

  const commit = () => {
    const result = validateAndCoerce(field.type, draft);
    if (!result.ok) {
      setError(t(result.errorKey));
      return;
    }
    onCommit(result.value);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          ref={focusInput}
          value={draft}
          inputMode={inputModeFor(field.type)}
          aria-label={t("editField", { field: field.label })}
          aria-invalid={error !== null}
          aria-describedby={error ? `${field.key}-edit-error` : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
          className="min-h-12"
        />
        <EditActions
          onCancel={onCancel}
          onConfirm={commit}
          confirmLabel={t("save")}
          cancelLabel={t("cancel")}
        />
      </div>
      {error ? (
        <p
          id={`${field.key}-edit-error`}
          role="alert"
          className="text-xs text-destructive"
        >
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{t("editHint")}</p>
      )}
    </div>
  );
}

/** Shared confirm/cancel icon buttons, 48px targets, screen-reader labelled. */
function EditActions({
  onCancel,
  onConfirm,
  confirmLabel,
  cancelLabel,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  cancelLabel: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        type="button"
        size="icon"
        className="size-12"
        onClick={onConfirm}
        aria-label={confirmLabel}
      >
        <Check aria-hidden="true" className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="size-12"
        onClick={onCancel}
        aria-label={cancelLabel}
      >
        <X aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}

/** Stringify a stored value for a text input (booleans handled separately). */
function toInputString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

/** The mobile keyboard hint per field type. */
function inputModeFor(
  type: FieldDefinition["type"],
): React.HTMLAttributes<HTMLInputElement>["inputMode"] {
  switch (type) {
    case "number":
    case "currency":
      return "decimal";
    case "email":
      return "email";
    case "phone":
      return "tel";
    default:
      return "text";
  }
}

type CoerceResult =
  | { ok: true; value: unknown }
  | { ok: false; errorKey: "editEmpty" | "editInvalidNumber" };

/**
 * Validate + coerce a raw text draft for a scalar field. Numbers/currency must
 * parse; everything else is accepted as trimmed text. Empty input is rejected
 * (the frozen matrix: "Invalid/empty input → inline message, no commit").
 */
function validateAndCoerce(
  type: FieldDefinition["type"],
  raw: string,
): CoerceResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, errorKey: "editEmpty" };
  }

  if (type === "number" || type === "currency") {
    const parsed = Number(trimmed);
    // `!isFinite` rejects NaN AND Infinity/-Infinity (e.g. "1e999" → Infinity),
    // which `Number.isNaN` alone would let through as an "invalid number".
    if (!Number.isFinite(parsed)) {
      return { ok: false, errorKey: "editInvalidNumber" };
    }
    return { ok: true, value: parsed };
  }

  return { ok: true, value: trimmed };
}
