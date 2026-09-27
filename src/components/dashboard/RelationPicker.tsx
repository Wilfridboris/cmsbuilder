"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  fetchRelationLabels,
  searchRelationRecords,
  RecordApiError,
  type RelationRecordLabel,
} from "@/lib/data/records-client";

/**
 * RelationPicker (Story 3.7) — the searchable, server-side-typeahead record picker
 * for a single-reference relation field. Used by both the add-record form and the
 * inline edit cell.
 *
 * The VALUE is the target record's id (a string); the picker shows the target's
 * `displayField` LABEL for that id (resolved via a batched labels fetch) while
 * writing the id. Composed from the installed Radix `Popover` + a search `Input` +
 * a `role="listbox"` of `role="option"` results — no new dependency.
 *
 * Behavior:
 *   - debounced `searchRelationRecords(slug, targetTable, query)` (300ms);
 *   - keyboard nav: ArrowDown/ArrowUp move the active option, Enter selects, Esc
 *     closes; the trigger opens on click/Enter/Space (native button);
 *   - states: loading (skeleton rows), empty ("no results"), error (inline), and
 *     a clear control to unset an optional relation;
 *   - 48px min touch targets; all copy via the `SlugDashboard` next-intl ns.
 */

type RelationPickerProps = {
  /** Route slug — scopes the search/label API calls. */
  slug: string;
  /** The relation field's target table key (what we search + resolve against). */
  targetTable: string;
  /** The current value: the selected target id, or null/empty when unset. */
  value: string | null;
  /** Called with the new target id, or null when cleared. */
  onChange: (value: string | null) => void;
  /** Accessible name for the trigger (e.g. "Edit {field}" / the field label). */
  ariaLabel: string;
  /** Disables the control while a parent save is in flight. */
  disabled?: boolean;
  /** Optional id for the trigger so a `<label htmlFor>` can point at it. */
  id?: string;
};

const DEBOUNCE_MS = 300;

export function RelationPicker({
  slug,
  targetTable,
  value,
  onChange,
  ariaLabel,
  disabled,
  id,
}: RelationPickerProps) {
  const t = useTranslations("SlugDashboard");
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Debounce the query so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  // Focus the search input when the popover opens (a DOM sync). Transient state
  // (query/activeIndex) is reset in `onOpenChange` on close, not in an effect.
  useEffect(() => {
    if (!open) return undefined;
    const handle = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(handle);
  }, [open]);

  const setOpenState = (next: boolean) => {
    if (disabled) return;
    if (!next) {
      // Reset transient search state as the popover closes.
      setQuery("");
      setDebounced("");
      setActiveIndex(0);
    }
    setOpen(next);
  };

  // Resolve the CURRENTLY-SELECTED id to a label so the trigger shows the label
  // (not the id) even before the popover is opened. One tiny batched fetch.
  const selectedLabelQuery = useQuery({
    queryKey: ["relation-labels", slug, targetTable, value ? [value] : []],
    queryFn: () => fetchRelationLabels(slug, targetTable, value ? [value] : []),
    enabled: Boolean(value),
    staleTime: 30_000,
  });

  const selectedLabel = useMemo(() => {
    if (!value) return null;
    const found = (selectedLabelQuery.data ?? []).find((r) => r.id === value);
    return found?.label ?? null;
  }, [value, selectedLabelQuery.data]);

  // Typeahead candidates for the (debounced) query while the popover is open.
  const searchQuery = useQuery({
    queryKey: ["relation-search", slug, targetTable, debounced],
    queryFn: () => searchRelationRecords(slug, targetTable, debounced),
    enabled: open,
    staleTime: 10_000,
    retry: false,
  });

  const results: RelationRecordLabel[] = searchQuery.data ?? [];

  // Clamp the active option index at render (never in an effect): the result set
  // can shrink between keystrokes, so derive the in-range index for display and
  // keyboard selection without an extra render pass.
  const clampedActiveIndex =
    results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);

  const select = (record: RelationRecordLabel) => {
    onChange(record.id);
    setOpenState(false);
  };

  const clear = () => {
    onChange(null);
    setOpenState(false);
  };

  const errorCode =
    searchQuery.error instanceof RecordApiError
      ? searchQuery.error.code
      : searchQuery.isError
        ? "genericError"
        : null;

  // The active option's id for `aria-activedescendant` — screen readers announce
  // the arrow-key-highlighted option only when the focused input points at it.
  const activeOptionId =
    results.length > 0 ? `${listboxId}-opt-${clampedActiveIndex}` : undefined;

  // The trigger label: the resolved label, an archived placeholder when the id no
  // longer resolves, a loading dash while resolving OR the resolve errored (a
  // transient failure must not read as "Archived"), or the placeholder.
  const triggerText = value
    ? selectedLabel !== null
      ? selectedLabel
      : selectedLabelQuery.isPending || selectedLabelQuery.isError
        ? "…"
        : t("relationArchived")
    : t("relationSearchPlaceholder");

  return (
    <Popover open={open} onOpenChange={setOpenState}>
      <div className="flex w-full items-center gap-1">
        <PopoverTrigger asChild>
          <Button
            type="button"
            id={id}
            variant="outline"
            disabled={disabled}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-label={ariaLabel}
            className={cn(
              "min-h-12 min-w-0 flex-1 justify-between gap-2 font-normal",
              value &&
              selectedLabel === null &&
              !selectedLabelQuery.isPending &&
              !selectedLabelQuery.isError
                ? "text-muted-foreground italic"
                : !value
                  ? "text-muted-foreground"
                  : "",
            )}
          >
            <span className="min-w-0 truncate text-left">{triggerText}</span>
            <ChevronsUpDown
              aria-hidden="true"
              className="size-4 shrink-0 opacity-50"
            />
          </Button>
        </PopoverTrigger>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-12 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={clear}
            disabled={disabled}
            aria-label={t("relationClear")}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
      </div>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        <div className="border-b border-border p-2">
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("relationSearchPlaceholder")}
            role="combobox"
            aria-label={t("relationSearchPlaceholder")}
            aria-controls={listboxId}
            aria-expanded
            aria-activedescendant={activeOptionId}
            className="min-h-12"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((i) =>
                  results.length === 0 ? 0 : (i + 1) % results.length,
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((i) =>
                  results.length === 0
                    ? 0
                    : (i - 1 + results.length) % results.length,
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                const record = results[clampedActiveIndex];
                if (record) select(record);
              } else if (event.key === "Escape") {
                event.preventDefault();
                setOpenState(false);
              }
            }}
          />
        </div>

        {errorCode ? (
          <p role="alert" className="px-3 py-4 text-sm text-destructive">
            {t("relationPickerError")}
          </p>
        ) : searchQuery.isPending ? (
          <div
            aria-hidden="true"
            className="flex flex-col gap-2 p-2"
          >
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
            <span className="sr-only">{t("relationSearching")}</span>
          </div>
        ) : results.length === 0 ? (
          <p role="status" className="px-3 py-4 text-sm text-muted-foreground">
            {t("relationNoResults")}
          </p>
        ) : (
          <ul
            id={listboxId}
            role="listbox"
            aria-label={t("relationSearchPlaceholder")}
            className="max-h-64 list-none overflow-y-auto p-1"
          >
            {results.map((record, index) => {
              const selected = record.id === value;
              const active = index === clampedActiveIndex;
              return (
                <li key={record.id} role="none">
                  <button
                    type="button"
                    id={`${listboxId}-opt-${index}`}
                    role="option"
                    aria-selected={selected}
                    onClick={() => select(record)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={cn(
                      "flex min-h-12 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors",
                      active ? "bg-accent" : "hover:bg-accent/50",
                    )}
                  >
                    <Check
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 truncate">{record.label}</span>
                  </button>
                </li>
              );
            })}
            {searchQuery.isFetching ? (
              <li role="none" className="flex items-center justify-center py-2">
                <Loader2
                  aria-hidden="true"
                  className="size-4 animate-spin text-muted-foreground"
                />
              </li>
            ) : null}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
