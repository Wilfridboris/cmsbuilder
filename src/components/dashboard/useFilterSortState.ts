import { useMemo, useState } from "react";

import type { FieldDefinition, TableDefinition } from "@/types/db";
import type { RelationFilter } from "@/lib/data/records-client";
import type { FilterState, SortState } from "@/lib/data/filter-sort";

/**
 * Ephemeral, per-table filter & sort view state (Story 3.4 + 3.8; seeded from a
 * saved view in Story 5.3).
 *
 * Extracted from `RecordsView` so the same partition logic — RELATION filters
 * ride the records query key + params to be applied SERVER-SIDE (JSONB
 * containment), while SCALAR filters stay in the client-side `applyFilterSort`
 * pipeline — lives in one place and can back both the main records surface and
 * the reverse-related list (which had a byte-identical copy).
 *
 * State resets when the active table changes, via the render-time "adjust state
 * on prop change" pattern (no effect, no cascading render). Story 5.3: when a
 * saved view is active, the caller passes a `seed` (the view's filters/sort) and
 * a `seedKey` (the view key); switching to that view SEEDS the state from the view
 * instead of clearing it, so opening a view shows the saved filters/sort applied.
 * The owner can then adjust them freely (the view definition is unchanged — view
 * editing is a later story). Never persisted to URL, storage, or the server.
 */
export function useFilterSortState(
  table: TableDefinition,
  seed?: { key: string; filters: FilterState[]; sort: SortState } | null,
) {
  const tableKey = table.key;
  // The identity of the current selection: a bare table, or a saved view keyed
  // distinctly so switching between a table and a view OVER THAT SAME TABLE still
  // re-seeds (the table key alone would not change).
  const selectionKey = seed ? `view:${seed.key}` : `table:${tableKey}`;

  // Field-type lookup so we can tell a relation filter (server-side) from a
  // scalar filter (client-side).
  const fieldByKey = useMemo(() => {
    const map = new Map<string, FieldDefinition>();
    for (const field of table.fields) map.set(field.key, field);
    return map;
  }, [table]);

  const [sort, setSort] = useState<SortState>(seed ? seed.sort : null);
  const [filters, setFilters] = useState<FilterState[]>(
    seed ? seed.filters : [],
  );

  const [seenSelectionKey, setSeenSelectionKey] = useState(selectionKey);
  if (seenSelectionKey !== selectionKey) {
    setSeenSelectionKey(selectionKey);
    // Seed from the active view's saved config, or clear for a bare table.
    setSort(seed ? seed.sort : null);
    setFilters(seed ? seed.filters : []);
  }

  // RELATION filters → server-side (as `{ field, targetId }`), SCALAR → client.
  const relationFilters = useMemo<RelationFilter[]>(
    () =>
      filters
        .filter((f) => fieldByKey.get(f.field)?.type === "relation")
        .map((f) => ({ field: f.field, targetId: f.value })),
    [filters, fieldByKey],
  );
  const scalarFilters = useMemo(
    () => filters.filter((f) => fieldByKey.get(f.field)?.type !== "relation"),
    [filters, fieldByKey],
  );
  // Stable key part so a relation-filtered view is its own server-narrowed cache
  // entry (Story 3.8).
  const relationFilterKey = useMemo(
    () => relationFilters.map((f) => `${f.field}:${f.targetId}`).sort(),
    [relationFilters],
  );

  const hasFilters = filters.length > 0;

  // Sort field select: pick a field (defaults ascending) or clear.
  const handleSortFieldChange = (field: string | null) => {
    setSort(field ? { field, direction: "asc" } : null);
  };

  // Cycle sort on a field: unsorted → asc → desc → unsorted (created_at order).
  const cycleSort = (field: string) => {
    setSort((current) => {
      if (!current || current.field !== field) {
        return { field, direction: "asc" };
      }
      if (current.direction === "asc") {
        return { field, direction: "desc" };
      }
      return null;
    });
  };

  const addFilter = (filter: FilterState) => {
    setFilters((current) => [...current, filter]);
  };
  const removeFilter = (index: number) => {
    setFilters((current) => current.filter((_, i) => i !== index));
  };
  const clearFilters = () => setFilters([]);

  return {
    sort,
    filters,
    relationFilters,
    scalarFilters,
    relationFilterKey,
    hasFilters,
    handleSortFieldChange,
    cycleSort,
    addFilter,
    removeFilter,
    clearFilters,
  };
}
