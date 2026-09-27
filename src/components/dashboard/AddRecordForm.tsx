"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";

import type { FieldDefinition, TableDefinition } from "@/types/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  coerceAddValue,
  inputModeFor,
  type Draft,
} from "@/lib/forms/field-input";
import { RelationPicker } from "@/components/dashboard/RelationPicker";

/**
 * AddRecordForm (Story 3.2) — the presentation-agnostic, schema-typed form body
 * for adding one record to the active table.
 *
 * The `draft` + `onDraftChange` are LIFTED to `RecordsView` so switching between
 * the inline quick-add and the modal preserves the in-progress entry (single
 * source of draft state). One control per VISIBLE field, each with a real
 * `<label htmlFor>` (never placeholder-only, NFR-A4): `boolean` → a two-choice
 * toggle (radiogroup); everything else → a text input with an `inputMode` hint.
 *
 * On submit each field is coerced via `coerceAddValue` — blanks are omitted (the
 * schema has no `required` flag), and a non-numeric `number`/`currency` shows an
 * inline `role="alert"` and blocks submit until corrected. The submit button
 * shows a disabled/pending state (no spinner on the surface — the button owns it).
 *
 * All copy resolves through the `SlugDashboard` next-intl namespace; per-field
 * labels come from the schema `field.label`.
 */

const HTML_INPUT_TYPE: Partial<Record<FieldDefinition["type"], string>> = {
  email: "email",
  phone: "tel",
  date: "date",
  datetime: "datetime-local",
};

type AddRecordFormProps = {
  /** Route slug — the relation picker needs it to scope its search/label calls. */
  slug: string;
  table: TableDefinition;
  draft: Draft;
  onDraftChange: (draft: Draft) => void;
  /** Called with the coerced, blank-omitted payload once every field validates. */
  onSubmit: (data: Record<string, unknown>) => void;
  pending: boolean;
  /**
   * Presentation variant. `inline` packs controls into a compact wrap for the
   * quick-add row/card; `modal` stacks them full-width inside the dialog.
   */
  variant: "inline" | "modal";
  /** Optional trailing slot (e.g. the expand-to-modal control) for the inline row. */
  trailing?: React.ReactNode;
};

export function AddRecordForm({
  slug,
  table,
  draft,
  onDraftChange,
  onSubmit,
  pending,
  variant,
  trailing,
}: AddRecordFormProps) {
  const t = useTranslations("SlugDashboard");
  const fieldIdBase = useId();
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const fields = table.fields.filter((field) => !field.hidden);

  const setValue = (key: string, value: string) => {
    onDraftChange({ ...draft, [key]: value });
    if (errors[key]) {
      setErrors((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const data: Record<string, unknown> = {};
    const nextErrors: Record<string, boolean> = {};

    for (const field of fields) {
      if (field.type === "boolean") {
        // The toggle always holds a defined "true"/"false"; write it as a real
        // boolean (booleans are never "blank").
        data[field.key] = draft[field.key] === "true";
        continue;
      }
      if (field.type === "relation") {
        // A relation draft value is the target id string; blank → omitted (the
        // schema has no `required` concept, exactly like scalar fields).
        const id = (draft[field.key] ?? "").trim();
        if (id !== "") {
          data[field.key] = id;
        }
        continue;
      }
      const result = coerceAddValue(field.type, draft[field.key] ?? "");
      if (result.kind === "error") {
        nextErrors[field.key] = true;
      } else if (result.kind === "ok") {
        data[field.key] = result.value;
      }
      // `omit` → left out of `data`.
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    onSubmit(data);
  };

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={t("quickAddLabel", { table: table.label })}
      className={cn(
        "flex gap-3",
        variant === "inline"
          ? "flex-wrap items-end"
          : "flex-col",
      )}
    >
      {fields.map((field) => {
        const fieldId = `${fieldIdBase}-${field.key}`;
        const errorId = `${fieldId}-error`;
        const hasError = Boolean(errors[field.key]);
        return (
          <div
            key={field.key}
            className={cn(
              "flex flex-col gap-1.5",
              variant === "inline" ? "min-w-[10rem] flex-1" : "w-full",
            )}
          >
            <Label htmlFor={fieldId} className="text-muted-foreground">
              {field.label}
            </Label>
            {field.type === "boolean" ? (
              <BooleanToggle
                id={fieldId}
                label={field.label}
                value={draft[field.key] === "true"}
                onChange={(next) => setValue(field.key, next ? "true" : "false")}
                trueLabel={t("boolTrue")}
                falseLabel={t("boolFalse")}
                disabled={pending}
              />
            ) : field.type === "relation" && field.relationConfig ? (
              <RelationPicker
                id={fieldId}
                slug={slug}
                targetTable={field.relationConfig.targetTable}
                value={draft[field.key] ? draft[field.key] : null}
                onChange={(next) => setValue(field.key, next ?? "")}
                ariaLabel={field.label}
                disabled={pending}
              />
            ) : (
              <Input
                id={fieldId}
                type={HTML_INPUT_TYPE[field.type] ?? "text"}
                inputMode={inputModeFor(field.type)}
                value={draft[field.key] ?? ""}
                disabled={pending}
                aria-invalid={hasError}
                aria-describedby={hasError ? errorId : undefined}
                onChange={(event) => setValue(field.key, event.target.value)}
                className="min-h-12"
              />
            )}
            {hasError ? (
              <p
                id={errorId}
                role="alert"
                className="text-xs text-destructive"
              >
                {t("invalidNumber")}
              </p>
            ) : null}
          </div>
        );
      })}

      <div
        className={cn(
          "flex items-center gap-2",
          variant === "inline" ? "self-end" : "justify-end pt-2",
        )}
      >
        {trailing}
        <Button
          type="submit"
          disabled={pending}
          className="min-h-12 gap-2"
          aria-label={t("submit")}
        >
          {pending ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Plus aria-hidden="true" className="size-4" />
          )}
          <span>{pending ? t("submitting") : t("submit")}</span>
        </Button>
      </div>
    </form>
  );
}

/** Two-choice Yes/No toggle mirroring `RecordDetail`'s boolean radiogroup. */
function BooleanToggle({
  id,
  label,
  value,
  onChange,
  trueLabel,
  falseLabel,
  disabled,
}: {
  id: string;
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  trueLabel: string;
  falseLabel: string;
  disabled: boolean;
}) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={label}
      className="flex h-12 w-fit overflow-hidden rounded-md border border-input"
    >
      {[true, false].map((option) => (
        <button
          key={String(option)}
          type="button"
          role="radio"
          aria-checked={value === option}
          disabled={disabled}
          onClick={() => onChange(option)}
          className={cn(
            "min-h-12 min-w-12 px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50",
            value === option
              ? "bg-primary text-primary-foreground"
              : "bg-background text-foreground hover:bg-accent",
          )}
        >
          {option ? trueLabel : falseLabel}
        </button>
      ))}
    </div>
  );
}
