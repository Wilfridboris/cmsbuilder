"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";

import type { FieldDefinition, RecordData, TableDefinition } from "@/types/db";
import { fetchRelationLabels } from "@/lib/data/records-client";

/**
 * useRelationLabels (Story 3.7) — read-time, BATCHED relation-label resolution for
 * the authenticated records surface.
 *
 * A relation cell stores the target record's id; its human label lives on the
 * target row's `displayField` and is resolved at read time (never copied into the
 * referencing row). This hook collects the distinct target ids referenced by the
 * active table's relation fields, groups them by `targetTable`, and issues ONE
 * batched `id IN (...)` fetch per target table (via `/api/records/labels`), keyed
 * `["relation-labels", slug, targetTable, sortedIds]` so:
 *   - two relation fields pointing at the same table share one fetch;
 *   - a mutation / 3.6 real-time invalidation of `["relation-labels", slug]`
 *     re-resolves labels so an edited target's new label shows (AC4).
 *
 * It returns a `resolve(field, value)` that yields:
 *   - `{ label }`     — the id resolved to a live target label;
 *   - `{ archived }`  — the id is present but soft-deleted / unresolvable (render
 *                       the translated "archived" placeholder, never the raw id);
 *   - `null`          — no value (empty relation cell) OR labels still loading
 *                       (the caller shows a skeleton).
 */

export type RelationResolution =
  | { label: string }
  | { archived: true }
  | null;

/**
 * Pure, testable helper: from the active table's fields and its current rows,
 * collect the distinct, non-empty target ids referenced by each relation field,
 * grouped by `relationConfig.targetTable`. Returns a map of targetTable →
 * sorted-unique id list. Non-relation fields and empty/blank values are ignored.
 * A relation field without `relationConfig` is skipped defensively.
 */
export function collectRelationIdsByTarget(
  fields: FieldDefinition[],
  rows: RecordData[],
): Map<string, string[]> {
  const relationFields = fields.filter(
    (field): field is FieldDefinition & {
      relationConfig: NonNullable<FieldDefinition["relationConfig"]>;
    } => field.type === "relation" && Boolean(field.relationConfig),
  );

  const byTarget = new Map<string, Set<string>>();
  for (const field of relationFields) {
    const targetTable = field.relationConfig.targetTable;
    let set = byTarget.get(targetTable);
    if (!set) {
      set = new Set<string>();
      byTarget.set(targetTable, set);
    }
    for (const row of rows) {
      const value = row.data[field.key];
      if (value === undefined || value === null) {
        continue;
      }
      const id = String(value).trim();
      if (id !== "") {
        set.add(id);
      }
    }
  }

  const result = new Map<string, string[]>();
  for (const [targetTable, set] of byTarget) {
    result.set(targetTable, Array.from(set).sort());
  }
  return result;
}

export function useRelationLabels({
  slug,
  table,
  rows,
}: {
  slug: string;
  table: TableDefinition;
  rows: RecordData[];
}): (field: FieldDefinition, value: unknown) => RelationResolution {
  const idsByTarget = useMemo(
    () => collectRelationIdsByTarget(table.fields, rows),
    [table.fields, rows],
  );

  // Stable, ordered list of [targetTable, ids] so the queries array is stable.
  const targets = useMemo(
    () =>
      Array.from(idsByTarget.entries())
        .filter(([, ids]) => ids.length > 0)
        .sort(([a], [b]) => a.localeCompare(b)),
    [idsByTarget],
  );

  const results = useQueries({
    queries: targets.map(([targetTable, ids]) => ({
      queryKey: ["relation-labels", slug, targetTable, ids] as const,
      queryFn: () => fetchRelationLabels(slug, targetTable, ids),
      // Labels are stable between explicit invalidations (mutation settle / 3.6
      // real-time); no need to refetch on window focus.
      staleTime: 30_000,
    })),
  });

  // Per-target: id → label map, plus loading/errored flags so callers can tell a
  // still-resolving batch (skeleton) and a failed fetch (do NOT claim "archived")
  // apart from a settled, genuinely-absent id.
  const labelState = useMemo(() => {
    const byTarget = new Map<
      string,
      { labels: Map<string, string>; loading: boolean; errored: boolean }
    >();
    targets.forEach(([targetTable], i) => {
      const query = results[i];
      const labels = new Map<string, string>();
      for (const row of query?.data ?? []) {
        labels.set(row.id, row.label);
      }
      byTarget.set(targetTable, {
        labels,
        loading: query ? query.isPending : false,
        errored: query ? query.isError : false,
      });
    });
    return byTarget;
  }, [targets, results]);

  return useMemo(
    () => (field: FieldDefinition, value: unknown): RelationResolution => {
      if (field.type !== "relation" || !field.relationConfig) {
        return null;
      }
      if (value === undefined || value === null || String(value).trim() === "") {
        return null;
      }
      const id = String(value).trim();
      const state = labelState.get(field.relationConfig.targetTable);
      if (!state) {
        // No batch was issued for this target (no ids collected) — still loading.
        return null;
      }
      const label = state.labels.get(id);
      if (label !== undefined) {
        return { label };
      }
      // Present id, but no label came back. Still loading OR the batch errored →
      // skeleton (null): a transient fetch failure must NOT masquerade as a
      // deleted record. Only a settled, successful batch that omits the id means
      // it is genuinely soft-deleted / unresolvable → archived placeholder.
      if (state.loading || state.errored) {
        return null;
      }
      return { archived: true };
    },
    [labelState],
  );
}
