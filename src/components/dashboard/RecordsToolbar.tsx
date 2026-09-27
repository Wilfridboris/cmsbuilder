"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Filter,
  Plus,
  X,
} from "lucide-react";

import type { FieldDefinition } from "@/types/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RelationPicker } from "@/components/dashboard/RelationPicker";
import {
  eligibleFields,
  operatorsForType,
  type FilterOperator,
  type FilterState,
  type SortState,
} from "@/lib/data/filter-sort";
import { cn } from "@/lib/utils";

/**
 * RecordsToolbar (Story 3.4) — one responsive `flex flex-wrap` surface above
 * both the desktop table and the mobile cards that drives single-column sort
 * and one-or-more ANDed field filters over the already-cached rows.
 *
 * State lives in the parent `RecordsView`; this component is controlled. Only
 * `eligibleFields` (visible, non-relation) are offered as targets. All copy is
 * translated via `SlugDashboard`; controls are keyboard-operable, `focus-visible`,
 * and ≥48×48px on touch.
 */

type RecordsToolbarProps = {
  /** All fields of the active table (this component filters to eligible ones). */
  fields: FieldDefinition[];
  /** Route slug — scopes the relation picker's typeahead in the filter popover. */
  slug: string;
  /**
   * Resolve a relation filter's stored target id to its display label for the
   * active-filter chip (Story 3.8). `{ label }` → show the label; `{ archived }` →
   * the "archived" placeholder; `null` → still resolving (show a neutral dash).
   */
  resolveRelation: (
    field: FieldDefinition,
    value: unknown,
  ) => { label: string } | { archived: true } | null;
  /** Active filters (ANDed). */
  filters: FilterState[];
  /** Active single-column sort, or `null` when unsorted. */
  sort: SortState;
  /** Set the sort field (keeps ascending) or clears when empty. */
  onSortFieldChange: (field: string | null) => void;
  /** Cycle the current sort direction: asc → desc → cleared. */
  onSortToggle: () => void;
  /** Append a new filter. */
  onAddFilter: (filter: FilterState) => void;
  /** Remove the filter at `index`. */
  onRemoveFilter: (index: number) => void;
  /** Remove every filter (sort untouched). */
  onClearFilters: () => void;
};

export function RecordsToolbar({
  fields,
  slug,
  resolveRelation,
  filters,
  sort,
  onSortFieldChange,
  onSortToggle,
  onAddFilter,
  onRemoveFilter,
  onClearFilters,
}: RecordsToolbarProps) {
  const t = useTranslations("SlugDashboard");
  const options = useMemo(() => eligibleFields(fields), [fields]);
  const byKey = useMemo(() => {
    const map = new Map<string, FieldDefinition>();
    for (const field of options) map.set(field.key, field);
    return map;
  }, [options]);

  // No eligible targets → nothing to sort or filter by; render nothing.
  if (options.length === 0) return null;

  const sortField = sort ? byKey.get(sort.field) : undefined;
  const sortAriaLabel = sortField
    ? sort!.direction === "asc"
      ? t("sortAscending", { field: sortField.label })
      : t("sortDescending", { field: sortField.label })
    : t("sortToggleAria");

  const operatorLabel = (op: FilterOperator) => t(`op.${op}`);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Sort control: field Select + direction toggle. */}
      <div className="flex items-center gap-1">
        <span className="text-sm text-muted-foreground">{t("sortLabel")}</span>
        <Select
          value={sort ? sort.field : "__none__"}
          onValueChange={(value) =>
            onSortFieldChange(value === "__none__" ? null : value)
          }
        >
          <SelectTrigger
            aria-label={t("sortLabel")}
            className="h-12 min-h-12 min-w-40"
          >
            <SelectValue placeholder={t("sortFieldPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t("sortNone")}</SelectItem>
            {options.map((field) => (
              <SelectItem key={field.key} value={field.key}>
                {field.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-12"
          onClick={onSortToggle}
          disabled={!sort}
          aria-label={sortAriaLabel}
        >
          {!sort ? (
            <ArrowUpDown aria-hidden="true" className="size-4" />
          ) : sort.direction === "asc" ? (
            <ArrowUp aria-hidden="true" className="size-4" />
          ) : (
            <ArrowDown aria-hidden="true" className="size-4" />
          )}
        </Button>
      </div>

      {/* Filter controls: add-filter, active-filter chips, clear. Grouped and
          labelled so assistive tech distinguishes them from the sort control. */}
      <div
        role="group"
        aria-label={t("filterLabel")}
        className="flex flex-wrap items-center gap-2"
      >
      {/* Add-filter popover. */}
      <AddFilterPopover
        options={options}
        slug={slug}
        onAdd={onAddFilter}
        operatorLabel={operatorLabel}
      />

      {/* Active filters as removable chips. */}
      {filters.map((filter, index) => {
        const field = byKey.get(filter.field);
        const label = field ? field.label : filter.field;
        // A relation filter's value is a stored target id — show its resolved
        // display label (or the "archived" placeholder) rather than the raw id.
        const relationValue = (() => {
          if (!field || field.type !== "relation") return null;
          const resolution = resolveRelation(field, filter.value);
          if (resolution === null) return "…";
          if ("archived" in resolution) return t("relationArchived");
          return resolution.label;
        })();
        const chip =
          field?.type === "relation"
            ? t("filterChip", {
                field: label,
                operator: operatorLabel(filter.operator),
                value: relationValue ?? "",
              })
            : filter.operator === "between"
              ? t("filterChipBetween", {
                  field: label,
                  operator: operatorLabel(filter.operator),
                  value: filter.value,
                  value2: filter.value2 ?? "",
                })
              : filter.operator === "is"
                ? t("filterChip", {
                    field: label,
                    operator: operatorLabel(filter.operator),
                    value:
                      filter.value === "true" ? t("boolTrue") : t("boolFalse"),
                  })
                : t("filterChip", {
                    field: label,
                    operator: operatorLabel(filter.operator),
                    value: filter.value,
                  });
        return (
          <span
            key={`${filter.field}-${index}`}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 py-1 pr-1 pl-3 text-sm text-foreground"
          >
            <span className="max-w-48 truncate">{chip}</span>
            <button
              type="button"
              onClick={() => onRemoveFilter(index)}
              aria-label={t("removeFilter", { field: label })}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </span>
        );
      })}

      {filters.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          className="h-12 min-h-12"
          onClick={onClearFilters}
        >
          {t("clearFilters")}
        </Button>
      ) : null}
      </div>
    </div>
  );
}

/**
 * The add-filter popover: pick a field, then an operator valid for its type,
 * then a value (a boolean picker for `is`, a second value for `between`).
 * Applying appends the filter and resets + closes the popover.
 */
function AddFilterPopover({
  options,
  slug,
  onAdd,
  operatorLabel,
}: {
  options: FieldDefinition[];
  slug: string;
  onAdd: (filter: FilterState) => void;
  operatorLabel: (op: FilterOperator) => string;
}) {
  const t = useTranslations("SlugDashboard");
  const [open, setOpen] = useState(false);
  const [fieldKey, setFieldKey] = useState<string>("");
  const [operator, setOperator] = useState<FilterOperator | "">("");
  const [value, setValue] = useState("");
  const [value2, setValue2] = useState("");

  const field = options.find((f) => f.key === fieldKey);
  const operators = field ? operatorsForType(field.type) : [];
  const isBoolean = field?.type === "boolean";
  const isRelation = field?.type === "relation";
  const isBetween = operator === "between";

  const reset = () => {
    setFieldKey("");
    setOperator("");
    setValue("");
    setValue2("");
  };

  const inputType =
    field?.type === "number" || field?.type === "currency"
      ? "number"
      : field?.type === "date"
        ? "date"
        : field?.type === "datetime"
          ? "datetime-local"
          : "text";

  const canApply = (() => {
    if (!field || !operator) return false;
    if (isBoolean) return value === "true" || value === "false";
    // A relation filter's value is the chosen target id (via the picker).
    if (isRelation) return value.trim() !== "";
    if (value.trim() === "") return false;
    if (isBetween && value2.trim() === "") return false;
    return true;
  })();

  const handleApply = () => {
    if (!field || !operator || !canApply) return;
    onAdd({
      field: field.key,
      operator,
      value: isBoolean || isRelation ? value : value.trim(),
      ...(isBetween ? { value2: value2.trim() } : {}),
    });
    reset();
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-12 min-h-12">
          <Filter aria-hidden="true" className="size-4" />
          {t("addFilter")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-80 flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">{t("filterFieldLabel")}</label>
          <Select
            value={fieldKey}
            onValueChange={(next) => {
              setFieldKey(next);
              // A relation has a single operator ("is") — auto-select it so the
              // user only needs to pick a target record.
              const nextField = options.find((f) => f.key === next);
              setOperator(
                nextField?.type === "relation" ? "is" : "",
              );
              setValue("");
              setValue2("");
            }}
          >
            <SelectTrigger aria-label={t("filterFieldLabel")} className="w-full">
              <SelectValue placeholder={t("filterFieldPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {field ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">
              {t("filterOperatorLabel")}
            </label>
            <Select
              value={operator}
              onValueChange={(next) => setOperator(next as FilterOperator)}
            >
              <SelectTrigger
                aria-label={t("filterOperatorLabel")}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {operators.map((op) => (
                  <SelectItem key={op} value={op}>
                    {operatorLabel(op)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {field && operator ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">
              {isRelation ? t("relationFilterValueLabel") : t("filterValueLabel")}
            </label>
            {isRelation && field.relationConfig ? (
              <RelationPicker
                slug={slug}
                targetTable={field.relationConfig.targetTable}
                value={value === "" ? null : value}
                ariaLabel={t("relationFilterValueLabel")}
                onChange={(next) => setValue(next ?? "")}
              />
            ) : isBoolean ? (
              <Select value={value} onValueChange={setValue}>
                <SelectTrigger
                  aria-label={t("filterValueLabel")}
                  className="w-full"
                >
                  <SelectValue placeholder={t("filterValueLabel")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">{t("boolTrue")}</SelectItem>
                  <SelectItem value="false">{t("boolFalse")}</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  type={inputType}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  aria-label={t("filterValueLabel")}
                />
                {isBetween ? (
                  <>
                    <span className="text-sm text-muted-foreground">
                      {t("filterValueToLabel")}
                    </span>
                    <Input
                      type={inputType}
                      value={value2}
                      onChange={(event) => setValue2(event.target.value)}
                      aria-label={t("filterValueLabel")}
                    />
                  </>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        <Button
          type="button"
          className={cn("mt-1 h-11 min-h-11")}
          disabled={!canApply}
          onClick={handleApply}
        >
          <Plus aria-hidden="true" className="size-4" />
          {t("applyFilter")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
