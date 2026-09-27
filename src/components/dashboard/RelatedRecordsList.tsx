"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";

import type {
  FieldDefinition,
  RecordData,
  TableDefinition,
} from "@/types/db";
import { type CellStrings } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchRecords,
  type RelationFilter,
} from "@/lib/data/records-client";
import { InlineEditCell } from "@/components/dashboard/InlineEditCell";
import {
  useRelationLabels,
  type RelationResolution,
} from "@/components/dashboard/useRelationLabels";
import { relationFilterKeyPart } from "@/components/dashboard/useRecordMutations";
import { RecordsToolbar } from "@/components/dashboard/RecordsToolbar";
import { useFilterSortState } from "@/components/dashboard/useFilterSortState";
import { applyFilterSort } from "@/lib/data/filter-sort";

/**
 * RelatedRecordsList (Story 3.9) — ONE inbound reverse-relation section inside the
 * reverse-list dialog: the rows of a referencing table (`refTable`) whose relation
 * field (`fieldKey`) points at the opened record (`targetId`).
 *
 * The referencing rows are fetched SERVER-SIDE via JSONB containment: a fixed base
 * relation filter `{ field: fieldKey, targetId }` rides in the records query key,
 * reusing the exact `fetchRecords(rel=field:id)` path from Story 3.8 (`.contains`,
 * `@>`, served by the existing `records_data_gin_idx`) — never `data->>field`. That
 * shares the `["records", slug, refTable.key, relKey]` cache entry, so 3.6
 * real-time invalidation refreshes this list for free.
 *
 * Each list reuses the existing view stack with its OWN local filter/sort state:
 *   - user-added RELATION filters chain server-side onto the base filter (same
 *     partition as `RecordsView`);
 *   - user-added SCALAR filters + the single-column sort apply client-side via
 *     `applyFilterSort` (relation sort by resolved label);
 *   - labels resolve through `useRelationLabels` for the referencing table.
 *
 * Rows are READ-ONLY (`InlineEditCell editable={false}`): editing stays on the main
 * table surface — there is no add / edit / delete / nested-open from within a
 * reverse list. Relation cells still show the resolved label / "archived" / skeleton.
 * All copy resolves through `SlugDashboard`; skeletons for loading, never spinners.
 */

type RelatedRecordsListProps = {
  /** Route slug — keys the query and scopes the API calls. */
  slug: string;
  /** The referencing table whose rows point at the opened record. */
  refTable: TableDefinition;
  /** The relation field on `refTable` that targets the opened record's table. */
  fieldKey: string;
  /** The opened record's id — the base relation filter's target. */
  targetId: string;
  /** The section heading (table label, disambiguated by field label when needed). */
  heading: string;
  /** Locale-dependent cell strings for `formatCell` / read-only cells. */
  cellStrings: CellStrings;
};

export function RelatedRecordsList({
  slug,
  refTable,
  fieldKey,
  targetId,
  heading,
  cellStrings,
}: RelatedRecordsListProps) {
  const t = useTranslations("SlugDashboard");

  // Per-section filter/sort view state — the same shared hook the main records
  // surface uses (partition of relation vs scalar filters, sort cycling). Not
  // persisted; `refTable` is fixed for a section, so the hook's table-change reset
  // never fires here.
  const filterSort = useFilterSortState(refTable);

  const visibleFields = useMemo(
    () => refTable.fields.filter((field) => !field.hidden),
    [refTable],
  );

  // The FIXED base reverse-relation filter — always applied server-side so the
  // list only ever contains rows that reference the opened record.
  const baseFilter = useMemo<RelationFilter>(
    () => ({ field: fieldKey, targetId }),
    [fieldKey, targetId],
  );

  // Chain the user's RELATION filters (from the shared hook) onto the base filter;
  // SCALAR filters + sort apply client-side, exactly as on the main surface.
  const serverFilters = useMemo<RelationFilter[]>(
    () => [baseFilter, ...filterSort.relationFilters],
    [baseFilter, filterSort.relationFilters],
  );

  // Same key shape RecordsView + the mutation hooks use, so 3.6 real-time
  // invalidation of `["records", slug, refTable.key, ...]` refreshes this list.
  const relKey = useMemo(
    () => relationFilterKeyPart(serverFilters),
    [serverFilters],
  );

  const recordsQuery = useQuery({
    queryKey: ["records", slug, refTable.key, relKey],
    queryFn: () => fetchRecords(slug, refTable.key, serverFilters),
  });

  const rows = useMemo(() => recordsQuery.data ?? [], [recordsQuery.data]);

  // Read-time label resolution for the referencing table's own relation cells.
  const resolveRelation = useRelationLabels({
    slug,
    table: refTable,
    rows,
  });

  const resolveRelationLabel = useMemo(
    () => (field: FieldDefinition, value: unknown): string | null => {
      const resolution = resolveRelation(field, value);
      if (resolution && "label" in resolution) return resolution.label;
      return null;
    },
    [resolveRelation],
  );

  // SCALAR filters (ANDed) then the single-column sort over the already
  // server-narrowed rows. Relation sort orders by resolved label.
  const visibleRows = useMemo(
    () =>
      applyFilterSort(
        rows,
        filterSort.scalarFilters,
        filterSort.sort,
        refTable.fields,
        resolveRelationLabel,
      ),
    [rows, filterSort.scalarFilters, filterSort.sort, refTable, resolveRelationLabel],
  );

  return (
    <section className="flex flex-col gap-3" aria-label={heading}>
      <h3 className="text-sm font-semibold text-foreground text-pretty">
        {heading}
      </h3>

      <RecordsToolbar
        fields={refTable.fields}
        slug={slug}
        resolveRelation={resolveRelation}
        filters={filterSort.filters}
        sort={filterSort.sort}
        onSortFieldChange={filterSort.handleSortFieldChange}
        onSortToggle={() => {
          if (filterSort.sort) filterSort.cycleSort(filterSort.sort.field);
        }}
        onAddFilter={filterSort.addFilter}
        onRemoveFilter={filterSort.removeFilter}
        onClearFilters={filterSort.clearFilters}
      />

      {recordsQuery.isError ? (
        // A failed fetch for THIS section shows a neutral, translated load-error
        // line — other sections are unaffected, no crash. (Matrix row 6.)
        <p role="status" className="text-sm text-muted-foreground text-pretty">
          {t("reverseListLoadError")}
        </p>
      ) : recordsQuery.isPending ? (
        <div aria-hidden="true" className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : visibleRows.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground text-pretty">
          {filterSort.hasFilters ? t("noRecordsFoundBody") : t("reverseSectionEmpty")}
        </p>
      ) : (
        // Read-only card list at ALL breakpoints: the dialog is width-constrained,
        // so a wide multi-column table would overflow and force horizontal scroll.
        // Cards stack each field vertically, keeping every value readable with no
        // sideways scrolling (the desktop tabular view lives on the main surface).
        <ul className="flex list-none flex-col gap-3 p-0">
          <ReverseCards
            slug={slug}
            fields={visibleFields}
            rows={visibleRows}
            cellStrings={cellStrings}
            resolveRelation={resolveRelation}
          />
        </ul>
      )}
    </section>
  );
}

/** One read-only card per referencing row; first two fields headline it. */
function ReverseCards({
  slug,
  fields,
  rows,
  cellStrings,
  resolveRelation,
}: {
  slug: string;
  fields: FieldDefinition[];
  rows: RecordData[];
  cellStrings: CellStrings;
  resolveRelation: (field: FieldDefinition, value: unknown) => RelationResolution;
}) {
  const [primaryField, secondaryField, ...restFields] = fields;

  return (
    <>
      {rows.map((row) => (
        <li key={row.id}>
          <Card className="gap-0 py-4">
            <CardContent className="flex flex-col gap-2 px-4">
              {primaryField ? (
                <div className="text-base font-medium text-foreground text-pretty">
                  <InlineEditCell
                    field={primaryField}
                    value={row.data[primaryField.key]}
                    cellStrings={cellStrings}
                    editable={false}
                    pending={false}
                    slug={slug}
                    resolveRelation={resolveRelation}
                    onCommit={() => {}}
                  />
                </div>
              ) : null}
              {secondaryField ? (
                <div className="text-sm text-muted-foreground text-pretty">
                  <InlineEditCell
                    field={secondaryField}
                    value={row.data[secondaryField.key]}
                    cellStrings={cellStrings}
                    editable={false}
                    pending={false}
                    slug={slug}
                    resolveRelation={resolveRelation}
                    onCommit={() => {}}
                  />
                </div>
              ) : null}
              {restFields.length > 0 ? (
                <dl className="mt-1 flex flex-col gap-1">
                  {restFields.map((field) => (
                    <div
                      key={field.key}
                      className="flex items-baseline justify-between gap-3 text-sm"
                    >
                      <dt className="shrink-0 text-muted-foreground">
                        {field.label}
                      </dt>
                      <dd className="min-w-0 flex-1 text-right text-foreground">
                        <InlineEditCell
                          field={field}
                          value={row.data[field.key]}
                          cellStrings={cellStrings}
                          editable={false}
                          pending={false}
                          slug={slug}
                          resolveRelation={resolveRelation}
                          onCommit={() => {}}
                        />
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </CardContent>
          </Card>
        </li>
      ))}
    </>
  );
}
