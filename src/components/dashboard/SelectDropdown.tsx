"use client";

import { useTranslations } from "next-intl";

import type { SelectOption } from "@/types/db";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  SELECT_CLEAR_SENTINEL,
  fromDropdownValue,
  partitionSelectOptions,
} from "@/lib/forms/select-input";

/**
 * SelectDropdown (Story 13.2) — the shared closed-dropdown edit control for a
 * single-select (`select`) field. Used by both the add-record form and the
 * inline edit cell, mirroring `RelationPicker`'s prop shape.
 *
 * The VALUE is the option `value` token (a string) stored in `records.data`; the
 * dropdown shows that option's human `label`. Composed from the installed Radix
 * `Select` primitive — no new dependency.
 *
 * Behavior:
 *   - lists only NON-archived options as selectable choices;
 *   - a "Clear" item unsets an optional select (→ `onChange(null)`); the schema
 *     has no `required` flag, so a select is always clearable;
 *   - when the current `value` is an archived option, that option is rendered as
 *     a DISABLED item so the trigger shows its label (an existing cell keeps
 *     resolving) without offering it as a new choice;
 *   - 48px min touch target on the trigger, `focus-visible` ring, `aria-label`.
 *
 * The add-value affordance is deferred to Story 13.4: `addValueSlot` reserves the
 * slot (rendered after a `SelectSeparator`) but is `undefined` in 13.2, so no
 * dead/half-wired control ships. 13.4 wires the callback and its backend path.
 */

type SelectDropdownProps = {
  /** The current value: the selected option token, or null/empty when unset. */
  value: string | null;
  /** Called with the new option `value`, or null when cleared. */
  onChange: (value: string | null) => void;
  /** The field's full option list (archived + active). */
  options: SelectOption[];
  /** Accessible name for the trigger (e.g. "Edit {field}" / the field label). */
  ariaLabel: string;
  /** Disables the control while a parent save is in flight. */
  disabled?: boolean;
  /** Optional id for the trigger so a `<label htmlFor>` can point at it. */
  id?: string;
  /**
   * Reserved, UNUSED in Story 13.2: the Admin-only "+ Add value" affordance slot
   * (rendered after a `SelectSeparator`). Left `undefined` here so nothing ships;
   * Story 13.4 passes the add-value control and wires its `add_select_option` path.
   */
  addValueSlot?: React.ReactNode;
};

export function SelectDropdown({
  value,
  onChange,
  options,
  ariaLabel,
  disabled,
  id,
  addValueSlot,
}: SelectDropdownProps) {
  const t = useTranslations("SlugDashboard");

  // `active` = the selectable non-archived options; `archivedCurrent` = the
  // current value when it is archived, surfaced as a disabled item so the
  // trigger shows its label without offering it as a new choice.
  const { active: activeOptions, archivedCurrent } = partitionSelectOptions(
    options,
    value,
  );

  return (
    <Select
      value={value ?? undefined}
      disabled={disabled}
      onValueChange={(next) => {
        onChange(fromDropdownValue(next));
      }}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          "min-h-12 w-full justify-between",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        )}
      >
        <SelectValue placeholder={t("selectPlaceholder")} />
      </SelectTrigger>
      <SelectContent>
        {value !== null && value !== "" ? (
          <SelectItem value={SELECT_CLEAR_SENTINEL}>
            {t("selectClear")}
          </SelectItem>
        ) : null}
        {archivedCurrent ? (
          <SelectItem value={archivedCurrent.value} disabled>
            {archivedCurrent.label}
          </SelectItem>
        ) : null}
        {activeOptions.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
        {addValueSlot ? (
          <>
            <SelectSeparator />
            {addValueSlot}
          </>
        ) : null}
      </SelectContent>
    </Select>
  );
}
