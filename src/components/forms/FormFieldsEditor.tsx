"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { Reorder } from "framer-motion";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Check, Loader2, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { FormFieldConfig } from "@/types/db";
import { updateFormFieldConfig, FormApiError } from "@/lib/data/forms-client";
import { resolveFormError } from "@/lib/forms/error-copy";

/**
 * Error codes this card maps to a translated message; anything else falls back to
 * `genericError` via the shared `resolveFormError` helper, so an unexpected server code
 * never reaches `next-intl` as a missing key.
 */
const ERROR_KEYS = new Set([
  "notFound",
  "forbidden",
  "unauthorized",
  "writeFailed",
  "readOnly",
  "genericError",
]);

/**
 * FormFieldsEditor (Epic 14, Story 14.5) — the Admin-only per-field public customization
 * card. For the form's target table it lets the owner, per non-relation field: toggle
 * visibility on the public form, set a public label, add help text, and reorder (pointer
 * drag via framer-motion `Reorder` + keyboard move-up/move-down controls, WCAG AA). Save
 * writes the full ordered non-relation `field_config` through `updateFormFieldConfig`.
 *
 * Relation fields are listed in a separate LOCKED group — never toggleable, reorderable,
 * or emitted into the saved config (FR78: relationship/lookup fields are never public).
 *
 * Mirrors the slug/target cards: owns its own `useTransition`/error/saved state and shows
 * a pending spinner + inline `role="alert"` error / `role="status"` saved confirmation.
 * Field config is editable while the form is published (unlike slug/target) — refining
 * labels/help/order/visibility never changes where responses land.
 */

/** One editor field, as handed down by the server loader (`loadFormForEditor`). */
export type EditorField = {
  key: string;
  label: string;
  type: string;
  isRelation: boolean;
};

/** A non-relation field's live editor row state (merged from schema + saved config). */
type FieldRow = {
  key: string;
  /** The schema label — shown as the placeholder/fallback when no public label is set. */
  schemaLabel: string;
  /** The public label override the owner typed (empty = inherit the schema label). */
  label: string;
  /** The optional public help text. */
  helpText: string;
  /** Whether the field is shown on (and accepted by) the public form. */
  included: boolean;
};

/**
 * Build the ordered non-relation row model by merging the target table's editor fields
 * with the saved `field_config`: each non-relation field becomes a row (included defaults
 * to true when absent; label/help default empty; order by config `order` then definition
 * order). Relation fields are excluded here — they render in the separate locked group.
 */
function buildRows(
  fields: EditorField[],
  config: FormFieldConfig[],
): FieldRow[] {
  const byKey = new Map<string, FormFieldConfig>();
  config.forEach((entry) => byKey.set(entry.key, entry));

  const nonRelation = fields.filter((field) => !field.isRelation);

  const rows = nonRelation.map((field, index) => {
    const entry = byKey.get(field.key);
    return {
      row: {
        key: field.key,
        schemaLabel: field.label,
        label: typeof entry?.label === "string" ? entry.label : "",
        helpText: typeof entry?.helpText === "string" ? entry.helpText : "",
        included: entry?.included !== false,
      } satisfies FieldRow,
      order: typeof entry?.order === "number" ? entry.order : index,
      index,
    };
  });

  rows.sort((a, b) => a.order - b.order || a.index - b.index);
  return rows.map((item) => item.row);
}

export function FormFieldsEditor({
  slug,
  formId,
  editorFields,
  initialFieldConfig,
}: {
  slug: string;
  formId: string;
  editorFields: EditorField[];
  initialFieldConfig: FormFieldConfig[];
}) {
  const t = useTranslations("Forms");

  const [rows, setRows] = useState<FieldRow[]>(() =>
    buildRows(editorFields, initialFieldConfig),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, startSave] = useTransition();

  const errorId = useId();

  // The relation fields rendered as a locked, non-editable group (FR78).
  const relationFields = useMemo(
    () => editorFields.filter((field) => field.isRelation),
    [editorFields],
  );

  function updateRow(key: string, patch: Partial<FieldRow>) {
    setRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
    setSaved(false);
  }

  function moveRow(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= rows.length) {
      return;
    }
    setRows((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setSaved(false);
  }

  function handleSave() {
    setSaved(false);
    setError(null);
    // Emit the full ordered non-relation config: order is the current row index; a blank
    // public label / help text is sent as undefined (inherit / none). Relation fields are
    // never included — the server also re-filters (FR78 + drop-stale).
    const fieldConfig: FormFieldConfig[] = rows.map((row, index) => {
      const entry: FormFieldConfig = {
        key: row.key,
        included: row.included,
        order: index,
      };
      const label = row.label.trim();
      if (label !== "") {
        entry.label = label;
      }
      const helpText = row.helpText.trim();
      if (helpText !== "") {
        entry.helpText = helpText;
      }
      return entry;
    });

    startSave(async () => {
      try {
        await updateFormFieldConfig(slug, formId, fieldConfig);
        setSaved(true);
      } catch (err) {
        const code = err instanceof FormApiError ? err.code : "genericError";
        setError(resolveFormError(t, code, ERROR_KEYS));
      }
    });
  }

  const hasNonRelation = rows.length > 0;
  const hasRelation = relationFields.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("fieldsTitle")}</CardTitle>
        <CardDescription>{t("fieldsHelp")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!hasNonRelation && !hasRelation ? (
          <p className="text-sm text-muted-foreground text-pretty">
            {t("fieldsNone")}
          </p>
        ) : null}

        {hasNonRelation ? (
          <Reorder.Group
            axis="y"
            values={rows}
            onReorder={(next) => {
              setRows(next as FieldRow[]);
              setSaved(false);
            }}
            className="flex flex-col gap-3"
          >
            {rows.map((row, index) => (
              <Reorder.Item
                key={row.key}
                value={row}
                className="flex flex-col gap-3 rounded-md border border-input bg-background p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                      {row.schemaLabel}
                    </span>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {row.key}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      disabled={saving || index === 0}
                      aria-label={t("fieldMoveUp", { field: row.schemaLabel })}
                      onClick={() => moveRow(index, -1)}
                    >
                      <ArrowUp aria-hidden="true" className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      disabled={saving || index === rows.length - 1}
                      aria-label={t("fieldMoveDown", { field: row.schemaLabel })}
                      onClick={() => moveRow(index, 1)}
                    >
                      <ArrowDown aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Switch
                    id={`field-included-${row.key}`}
                    checked={row.included}
                    disabled={saving}
                    onCheckedChange={(checked) =>
                      updateRow(row.key, { included: checked })
                    }
                  />
                  <Label
                    htmlFor={`field-included-${row.key}`}
                    className="text-sm"
                  >
                    {t("fieldIncluded")}
                  </Label>
                </div>

                <div className="flex flex-col gap-2">
                  <Label
                    htmlFor={`field-label-${row.key}`}
                    className="text-sm"
                  >
                    {t("fieldLabel")}
                  </Label>
                  <Input
                    id={`field-label-${row.key}`}
                    value={row.label}
                    disabled={saving}
                    placeholder={row.schemaLabel}
                    onChange={(event) =>
                      updateRow(row.key, { label: event.target.value })
                    }
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label
                    htmlFor={`field-help-${row.key}`}
                    className="text-sm"
                  >
                    {t("fieldHelpText")}
                  </Label>
                  <Textarea
                    id={`field-help-${row.key}`}
                    value={row.helpText}
                    disabled={saving}
                    rows={2}
                    aria-describedby={`field-help-desc-${row.key}`}
                    onChange={(event) =>
                      updateRow(row.key, { helpText: event.target.value })
                    }
                  />
                  <p
                    id={`field-help-desc-${row.key}`}
                    className="text-xs text-muted-foreground text-pretty"
                  >
                    {t("fieldHelpTextHint")}
                  </p>
                </div>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        ) : null}

        {hasRelation ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{t("fieldsLockedTitle")}</p>
            <ul className="flex flex-col gap-2">
              {relationFields.map((field) => (
                <li
                  key={field.key}
                  className="flex items-center gap-3 rounded-md border border-dashed border-input bg-muted/30 p-4 text-muted-foreground"
                >
                  <Lock aria-hidden="true" className="size-4 shrink-0" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                      {field.label}
                    </span>
                    <span className="text-xs text-pretty">
                      {t("fieldsLockedExplanation")}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {hasNonRelation ? (
          <div className="flex flex-col gap-3">
            <Button
              type="button"
              className="min-h-12 w-fit gap-2"
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : null}
              {saving ? t("saving") : t("saveFields")}
            </Button>
            {error ? (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : saved ? (
              <p
                role="status"
                className="flex items-center gap-1 text-sm text-muted-foreground"
              >
                <Check aria-hidden="true" className="size-4" />
                {t("saved")}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
