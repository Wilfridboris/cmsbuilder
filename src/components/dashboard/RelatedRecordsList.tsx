"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";

import type {
  FieldDefinition,
  RecordData,
  TableDefinition,
} from "@/types/db";
import { type CellStrings } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  applyFilterSort,
  type FilterState,
  type SortState,
} from "@/lib/data/filter-sort";

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

  // Local, per-section view state. Not persisted anywhere (mirrors RecordsView).
  const [sort, setSort] = useState<SortState>(null);
  const [filters, setFilters] = useState<FilterState[]>([]);

  const visibleFields = useMemo(
    () => refTable.fields.filter((field) => !field.hidden),
    [refTable],
  );

  const fieldByKey = useMemo(() => {
    const map = new Map<string, FieldDefinition>();
    for (const field of refTable.fields) map.set(field.key, field);
    return map;
  }, [refTable]);

  // The FIXED base reverse-relation filter — always applied server-side so the
  // list only ever contains rows that reference the opened record.
  const baseFilter = useMemo<RelationFilter>(
    () => ({ field: fieldKey, targetId }),
    [fieldKey, targetId],
  );

  // Partition the user's filters exactly like RecordsView: RELATION filters chain
  // server-side (onto the base filter), SCALAR filters stay client-side.
  const userRelationFilters = useMemo<RelationFilter[]>(
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

  const serverFilters = useMemo<RelationFilter[]>(
    () => [baseFilter, ...userRelationFilters],
    [baseFilter, userRelationFilters],
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
        scalarFilters,
        sort,
        refTable.fields,
        resolveRelationLabel,
      ),
    [rows, scalarFilters, sort, refTable, resolveRelationLabel],
  );

  const hasFilters = filters.length > 0;

  const handleSortFieldChange = (field: string | null) => {
    setSort(field ? { field, direction: "asc" } : null);
  };
  const cycleSort = () => {
    setSort((current) => {
      if (!current) return current;
      if (current.direction === "asc") {
        return { field: current.field, direction: "desc" };
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

  return (
    <section className="flex flex-col gap-3" aria-label={heading}>
      <h3 className="text-sm font-semibold text-foreground text-pretty">
        {heading}
      </h3>

      <RecordsToolbar
        fields={refTable.fields}
        slug={slug}
        resolveRelation={resolveRelation}
        filters={filters}
        sort={sort}
        onSortFieldChange={handleSortFieldChange}
        onSortToggle={cycleSort}
        onAddFilter={addFilter}
        onRemoveFilter={removeFilter}
        onClearFilters={clearFilters}
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
          {hasFilters ? t("noRecordsFoundBody") : t("reverseSectionEmpty")}
        </p>
      ) : (
        <>
          {/* Desktop: read-only semantic table. */}
          <div className="hidden md:block">
            <ReverseTable
              slug={slug}
              fields={visibleFields}
              rows={visibleRows}
              cellStrings={cellStrings}
              resolveRelation={resolveRelation}
              caption={heading}
            />
          </div>

          {/* Mobile: read-only card list. */}
          <ul className="flex list-none flex-col gap-3 p-0 md:hidden">
            <ReverseCards
              slug={slug}
              fields={visibleFields}
              rows={visibleRows}
              cellStrings={cellStrings}
              resolveRelation={resolveRelation}
            />
          </ul>
        </>
      )}
    </section>
  );
}

/** Desktop: every visible field is a read-only column (no actions column). */
function ReverseTable({
  slug,
  fields,
  rows,
  cellStrings,
  resolveRelation,
  caption,
}: {
  slug: string;
  fields: FieldDefinition[];
  rows: RecordData[];
  cellStrings: CellStrings;
  resolveRelation: (field: FieldDefinition, value: unknown) => RelationResolution;
  caption: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            {fields.map((field) => (
              <TableHead key={field.key} scope="col" className="px-2">
                <span className="flex min-h-12 items-center">{field.label}</span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              {fields.map((field) => (
                <TableCell key={field.key}>
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
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Mobile: one read-only card per referencing row; first two fields headline it. */
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
