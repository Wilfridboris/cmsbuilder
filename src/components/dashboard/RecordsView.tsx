"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSwipeable } from "react-swipeable";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Eye,
  Maximize2,
  Trash2,
} from "lucide-react";

import type {
  FieldDefinition,
  MemberRole,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  fetchRecords,
  RecordApiError,
  type RelationFilter,
} from "@/lib/data/records-client";
import { blankDraftForFields, type Draft } from "@/lib/forms/field-input";
import { AddRecordForm } from "@/components/dashboard/AddRecordForm";
import { DeleteConfirmDialog } from "@/components/dashboard/DeleteConfirmDialog";
import { RecordReverseListDialog } from "@/components/dashboard/RecordReverseListDialog";
import {
  InlineEditCell,
  type InlineCommit,
} from "@/components/dashboard/InlineEditCell";
import {
  isOptimisticId,
  useAddRecord,
  useDeleteRecord,
  useReferenceCount,
  useUpdateRecord,
} from "@/components/dashboard/useRecordMutations";
import { useRealtimeRecords } from "@/components/dashboard/useRealtimeRecords";
import {
  useRelationLabels,
  type RelationResolution,
} from "@/components/dashboard/useRelationLabels";
import { RecordsToolbar } from "@/components/dashboard/RecordsToolbar";
import { ColumnVisibilityControl } from "@/components/dashboard/ColumnVisibilityControl";
import { AddRelationFieldControl } from "@/components/dashboard/AddRelationFieldControl";
import {
  applyFilterSort,
  eligibleFields,
  type FilterState,
  type SortState,
} from "@/lib/data/filter-sort";

/**
 * RecordsView (Story 3.1 + 3.2) — the responsive records surface for the
 * authenticated tenant dashboard (`/[slug]`).
 *
 * 3.1 gave the read-only surface: one logical table at a time via an accessible
 * tablist switcher, a semantic `<Table>` on desktop and a swipeable card list on
 * mobile. 3.2 layers CRUD on top WITHOUT changing that structure:
 *   - the active table's rows are read via `useQuery(['records', slug, tableKey])`
 *     seeded with the server-fetched rows as `initialData` (fast first paint,
 *     NFR-P3), with `GET /api/records` supplying the authoritative refetch on
 *     invalidate;
 *   - an inline quick-add row (desktop) / card (mobile) sits at the top of the
 *     active table, with an expand control that reopens the SAME form (sharing
 *     ONE lifted draft) inside a Radix modal — switching preserves the draft;
 *   - a per-record delete control (a desktop actions column, a mobile card
 *     action) opens a confirm dialog gating the optimistic soft-delete.
 *
 * All mutations run the mandatory TanStack optimistic sequence via the mutations
 * hook. Every failure rolls back and surfaces a translated, non-technical message
 * (never a raw error). Copy resolves through `SlugDashboard`.
 */

/**
 * Clamp a target table index to `[0, count - 1]` — no wraparound, so the ends of
 * the switcher/swipe feel like ends. Pure + exported for tests.
 */
export function clampTableIndex(index: number, count: number): number {
  return Math.max(0, Math.min(index, count - 1));
}

type RecordsViewProps = {
  /** Route slug — keys the record queries and scopes the API calls. */
  slug: string;
  /**
   * The org's UUID (resolved server-side). Scopes the Story 3.6 Realtime
   * channel (`organization_id=eq.<orgId>`). A tenant identifier, not a secret;
   * RLS stays the security boundary.
   */
  orgId: string;
  /**
   * The caller's role for this org (Story 3.5). The Admin-only column-hide
   * control renders only when `role === "admin"`; the server route's
   * `requireAdmin` is the real security boundary.
   */
  role: MemberRole;
  /** Visible logical tables (already filtered via `visibleTables`). */
  tables: TableDefinition[];
  /** Server-fetched rows per table key, seeding each table's query `initialData`. */
  recordsByTable: Record<string, RecordData[]>;
  /** Locale-dependent cell strings for `formatCell`. */
  cellStrings: CellStrings;
};

export function RecordsView({
  slug,
  orgId,
  role,
  tables,
  recordsByTable,
  cellStrings,
}: RecordsViewProps) {
  const t = useTranslations("SlugDashboard");
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(0);

  const safeIndex = Math.min(activeIndex, tables.length - 1);
  const activeTable = tables[safeIndex];
  const tableKey = activeTable.key;
  const hasSwitcher = tables.length > 1;

  const visibleFields = useMemo(
    () => activeTable.fields.filter((field) => !field.hidden),
    [activeTable],
  );

  // A quick lookup of the active table's field types, so we can tell a relation
  // filter (applied server-side) from a scalar filter (applied client-side).
  const fieldByKey = useMemo(() => {
    const map = new Map<string, FieldDefinition>();
    for (const field of activeTable.fields) map.set(field.key, field);
    return map;
  }, [activeTable]);

  // Story 3.6: subscribe this dashboard to the org's Realtime records channel.
  // A side effect only — on any change event (or reconnect) it invalidates
  // `["records", slug]` so the active table refetches authoritative state; it
  // never patches the cache. Scoped per org via the channel filter + RLS.
  useRealtimeRecords({ slug, orgId });

  // ONE lifted add-draft. When the active table changes we reset the draft (and
  // close the modal) DURING render via the "adjust state on prop change" pattern
  // (https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  // rather than an effect, so fields always match the current schema without a
  // cascading render.
  const [draft, setDraft] = useState<Draft>(() =>
    blankDraftForFields(visibleFields),
  );
  const [modalOpen, setModalOpen] = useState(false);
  // Bumped whenever the draft is reset externally (table change or add success)
  // and passed as the `key` of the AddRecordForm instances, so their local
  // per-field validation error state remounts fresh — otherwise a stale
  // "invalid" alert can linger on a now-emptied field after a reset.
  const [formResetKey, setFormResetKey] = useState(0);
  // Ephemeral, per-table filter/sort view state (Story 3.4). Reset on active-
  // table change via the same render-time "adjust state on prop change" pattern
  // as the draft — not persisted to URL, storage, or the server.
  const [sort, setSort] = useState<SortState>(null);
  const [filters, setFilters] = useState<FilterState[]>([]);
  // Story 3.9: the record being opened (drives the reverse-list dialog). Declared
  // here (before the table-change reset block) so it can be reset alongside the
  // other per-table view state below.
  const [opened, setOpened] = useState<RecordData | null>(null);

  const [draftTableKey, setDraftTableKey] = useState(tableKey);
  if (draftTableKey !== tableKey) {
    setDraftTableKey(tableKey);
    setDraft(blankDraftForFields(visibleFields));
    setModalOpen(false);
    setFormResetKey((k) => k + 1);
    setSort(null);
    setFilters([]);
    setOpened(null);
  }

  // Story 3.8: partition the active filters. RELATION filters are applied
  // SERVER-SIDE (JSONB containment) by riding in the records query key + params,
  // so the server narrows the set before it returns; SCALAR filters stay in the
  // client-side `applyFilterSort` pipeline over the returned rows — one coherent
  // AND: server relation-narrowing, then client scalar filter + sort.
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

  // Active table's rows via TanStack Query, seeded with server `initialData` so
  // the first paint needs no fetch; invalidations after a mutation refetch the
  // authoritative rows from GET /api/records. The relation filters are part of the
  // query key + request so a relation-filtered view is a distinct, server-narrowed
  // cache entry (Story 3.8). `initialData` only seeds the unfiltered view.
  const relationFilterKey = useMemo(
    () =>
      relationFilters.map((f) => `${f.field}:${f.targetId}`).sort(),
    [relationFilters],
  );
  const { data: rows = [] } = useQuery({
    queryKey: ["records", slug, tableKey, relationFilterKey],
    queryFn: () => fetchRecords(slug, tableKey, relationFilters),
    initialData:
      relationFilters.length === 0
        ? recordsByTable[tableKey] ?? []
        : undefined,
  });

  const addRecord = useAddRecord(slug, tableKey, relationFilters);
  const deleteRecord = useDeleteRecord(slug, tableKey, relationFilters);
  const updateRecord = useUpdateRecord(slug, tableKey, relationFilters);

  // The fields the toolbar and header sort affordances may target: visible
  // (including relation — Story 3.8). Sorting/filtering runs against
  // `activeTable.fields` so the comparators/predicates see each declared type.
  const sortableFields = useMemo(
    () => eligibleFields(activeTable.fields),
    [activeTable],
  );
  const sortableKeys = useMemo(
    () => new Set(sortableFields.map((field) => field.key)),
    [sortableFields],
  );

  // Story 3.7: batched read-time relation-label resolution for the active table.
  // Collects the distinct target ids referenced on this page and resolves them in
  // one `id IN (...)` fetch per target table. `resolveRelation(field, value)` →
  // `{ label } | { archived } | null` (null = still loading → skeleton). Both a
  // mutation settle and 3.6 real-time invalidate `["relation-labels", slug]`, so
  // an edited target's new label refetches (AC4). Resolve over the full `rows`
  // (not just the filtered page) so labels are ready regardless of filter/sort.
  const resolveRelation = useRelationLabels({ slug, table: activeTable, rows });

  // Story 3.8 relation SORT orders by the resolved display label. Adapt the
  // `RelationResolution` resolver to the `(field, value) => string | null` shape
  // `applyFilterSort` wants — an archived/loading value has no label (sorts last).
  const resolveRelationLabel = useMemo(
    () => (field: FieldDefinition, value: unknown): string | null => {
      const resolution = resolveRelation(field, value);
      if (resolution && "label" in resolution) return resolution.label;
      return null;
    },
    [resolveRelation],
  );

  // The rendered array: SCALAR filters (ANDed) then the single-column sort applied
  // to the (already server-relation-narrowed) rows. Relation sort orders by label
  // via the resolver. Never mutates the cache; feeds both the table and the cards.
  const visibleRows = useMemo(
    () =>
      applyFilterSort(
        rows,
        scalarFilters,
        sort,
        activeTable.fields,
        resolveRelationLabel,
      ),
    [rows, scalarFilters, sort, activeTable, resolveRelationLabel],
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

  // The record queued for deletion (drives the confirm dialog).
  const [pendingDelete, setPendingDelete] = useState<RecordData | null>(null);

  // Story 3.8: while the confirm dialog is open, fetch how many rows reference the
  // queued record so the dialog can warn before the soft-delete. A fetch failure
  // is surfaced as a neutral "couldn't verify" note (never blocks the delete).
  const referenceCount = useReferenceCount(
    slug,
    tableKey,
    pendingDelete?.id ?? null,
    { enabled: pendingDelete !== null },
  );

  // A single translated status/error line for the surface (rollback message).
  const [message, setMessage] = useState<string | null>(null);

  const resolveError = (err: unknown): string => {
    const code = err instanceof RecordApiError ? err.code : "genericError";
    switch (code) {
      case "writeFailed":
        return t("writeFailed");
      case "loadFailed":
        return t("loadFailed");
      case "versionConflict":
        return t("versionConflict");
      case "invalidReference":
        return t("invalidReference");
      default:
        return t("genericError");
    }
  };

  const handleAdd = (data: Record<string, unknown>) => {
    setMessage(null);
    const idempotencyKey =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    addRecord.mutate(
      { data, idempotencyKey },
      {
        onSuccess: () => {
          setDraft(blankDraftForFields(visibleFields));
          setModalOpen(false);
          setFormResetKey((k) => k + 1);
        },
        onError: (err) => setMessage(resolveError(err)),
      },
    );
  };

  // Queue a record for deletion. A not-yet-settled optimistic row has a temp id
  // that matches no server row, so deleting it would send that temp id and
  // surface a misleading "record changed" message — ignore it until the add
  // settles to a real row (a beat later the same control works).
  const requestDelete = (record: RecordData) => {
    if (isOptimisticId(record.id)) return;
    setPendingDelete(record);
  };

  // Open a record's reverse-list "account" (Story 3.9). Like delete, an un-settled
  // optimistic row has a temp id that references no real record, so opening it would
  // show empty reverse lists keyed on a non-existent id — ignore it until it settles.
  const requestOpen = (record: RecordData) => {
    if (isOptimisticId(record.id)) return;
    setOpened(record);
  };

  const handleConfirmDelete = () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setMessage(null);
    deleteRecord.mutate(
      { id: target.id, expectedVersion: target.version },
      {
        onError: (err) => setMessage(resolveError(err)),
      },
    );
    setPendingDelete(null);
  };

  // Commit one inline cell edit: build the FULL merged row `data` (a cleared
  // value drops the key), then run the optimistic PATCH gated on the row's
  // current version. An un-settled optimistic row has a temp id/version that
  // matches no server row, so its cells are non-editable and never reach here.
  const handleCellCommit = (
    row: RecordData,
    field: FieldDefinition,
    result: InlineCommit,
  ) => {
    if (isOptimisticId(row.id)) return;
    setMessage(null);
    const data: Record<string, unknown> = { ...row.data };
    if (result.kind === "omit") {
      delete data[field.key];
    } else {
      data[field.key] = result.value;
    }
    updateRecord.mutate(
      { id: row.id, data, expectedVersion: row.version },
      {
        onError: (err) => setMessage(resolveError(err)),
      },
    );
  };

  const goTo = (index: number) => {
    setActiveIndex(clampTableIndex(index, tables.length));
  };

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => goTo(safeIndex + 1),
    onSwipedRight: () => goTo(safeIndex - 1),
    trackMouse: false,
  });

  return (
    <div className="flex flex-col gap-4">
      {hasSwitcher ? (
        <div
          role="tablist"
          aria-label={t("switcherLabel")}
          aria-orientation="horizontal"
          className="flex flex-wrap items-center gap-2 border-b border-border pb-px"
        >
          {tables.map((table, index) => {
            const selected = index === safeIndex;
            return (
              <button
                key={table.key}
                type="button"
                role="tab"
                id={`records-tab-${table.key}`}
                aria-selected={selected}
                aria-controls={`records-panel-${table.key}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => goTo(index)}
                onKeyDown={(event) => {
                  const count = tables.length;
                  let next: number | null = null;
                  if (event.key === "ArrowRight") next = (index + 1) % count;
                  else if (event.key === "ArrowLeft")
                    next = (index - 1 + count) % count;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = count - 1;
                  if (next === null) return;
                  event.preventDefault();
                  goTo(next);
                  document
                    .getElementById(`records-tab-${tables[next].key}`)
                    ?.focus();
                }}
                className={cn(
                  "relative min-h-12 min-w-12 rounded-t-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  selected
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {table.label}
                {selected ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <section
        {...(hasSwitcher
          ? {
              role: "tabpanel" as const,
              id: `records-panel-${activeTable.key}`,
              "aria-labelledby": `records-tab-${activeTable.key}`,
              tabIndex: 0,
            }
          : {})}
        className="flex flex-col gap-4 focus-visible:outline-none"
      >
        {/* Rollback / error line for the whole surface. */}
        <StatusMessage message={message} />

        {/* Filter & sort toolbar — governs both the table and the cards. The
            Admin-only Columns manager (Story 3.5) sits alongside it in the same
            toolbar row; a Member never receives it (server `requireAdmin` is the
            real gate). */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <RecordsToolbar
            fields={activeTable.fields}
            slug={slug}
            resolveRelation={resolveRelation}
            filters={filters}
            sort={sort}
            onSortFieldChange={handleSortFieldChange}
            onSortToggle={() => {
              if (sort) cycleSort(sort.field);
            }}
            onAddFilter={addFilter}
            onRemoveFilter={removeFilter}
            onClearFilters={clearFilters}
          />
          {role === "admin" ? (
            <div className="flex flex-wrap items-center gap-2">
              <AddRelationFieldControl
                slug={slug}
                activeTable={activeTable}
                tables={tables}
                onSuccess={() => {
                  setMessage(null);
                  router.refresh();
                }}
                onError={(msg) => setMessage(msg)}
              />
              <ColumnVisibilityControl
                slug={slug}
                activeTable={activeTable}
                onToggled={() => {
                  setMessage(null);
                  router.refresh();
                }}
                onError={(msg) => setMessage(msg)}
              />
            </div>
          ) : null}
        </div>

        {/* Inline quick-add: a bordered adder at the top of the active table,
            sharing the lifted draft with the modal. The expand control reopens
            the same form in the modal. */}
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4">
          <AddRecordForm
            key={`inline-${formResetKey}`}
            slug={slug}
            table={activeTable}
            draft={draft}
            onDraftChange={setDraft}
            onSubmit={handleAdd}
            pending={addRecord.isPending}
            variant="inline"
            trailing={
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-12"
                onClick={() => setModalOpen(true)}
                aria-label={t("expandForm")}
              >
                <Maximize2 aria-hidden="true" className="size-4" />
              </Button>
            }
          />
        </div>

        {/* Desktop: semantic table with a trailing actions column. */}
        <div className="hidden md:block">
          {visibleRows.length === 0 ? (
            hasFilters ? (
              <FilteredEmpty
                title={t("noRecordsFound")}
                body={t("noRecordsFoundBody")}
                clearLabel={t("clearFilters")}
                onClear={clearFilters}
              />
            ) : (
              <EmptyTable message={t("emptyTable")} />
            )
          ) : (
            <RecordsTable
              slug={slug}
              table={activeTable}
              rows={visibleRows}
              cellStrings={cellStrings}
              resolveRelation={resolveRelation}
              caption={t("tableCaption", { table: activeTable.label })}
              actionsHeader={t("actionsHeader")}
              openLabel={t("openRecord")}
              deleteLabel={t("deleteRecord")}
              onOpen={requestOpen}
              onDelete={requestDelete}
              onCellCommit={handleCellCommit}
              editPending={updateRecord.isPending}
              sort={sort}
              sortableKeys={sortableKeys}
              onSort={cycleSort}
              sortAriaLabel={(fieldLabel, state) =>
                state === "asc"
                  ? t("sortAscending", { field: fieldLabel })
                  : state === "desc"
                    ? t("sortDescending", { field: fieldLabel })
                    : t("sortUnsorted", { field: fieldLabel })
              }
            />
          )}
        </div>

        {/* Mobile: card list, each card with a delete action. */}
        <div {...swipeHandlers} className="touch-pan-y md:hidden">
          {visibleRows.length === 0 ? (
            hasFilters ? (
              <FilteredEmpty
                title={t("noRecordsFound")}
                body={t("noRecordsFoundBody")}
                clearLabel={t("clearFilters")}
                onClear={clearFilters}
              />
            ) : (
              <EmptyTable message={t("emptyTable")} />
            )
          ) : (
            <ul
              aria-label={t("cardListLabel", { table: activeTable.label })}
              className="flex list-none flex-col gap-3 p-0"
            >
              <RecordsCards
                slug={slug}
                table={activeTable}
                rows={visibleRows}
                cellStrings={cellStrings}
                resolveRelation={resolveRelation}
                openLabel={t("openRecord")}
                deleteLabel={t("deleteRecord")}
                onOpen={requestOpen}
                onDelete={requestDelete}
                onCellCommit={handleCellCommit}
                editPending={updateRecord.isPending}
              />
            </ul>
          )}
        </div>
      </section>

      {/* Full-form modal — the SAME AddRecordForm over the SAME lifted draft. */}
      <Dialog
        open={modalOpen}
        onOpenChange={(next) => {
          if (!next && !addRecord.isPending) setModalOpen(false);
        }}
      >
        <DialogContent
          closeLabel={t("close")}
          className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle className="text-balance">
              {t("modalTitle", { table: activeTable.label })}
            </DialogTitle>
            <DialogDescription className="text-pretty">
              {t("modalSubtitle")}
            </DialogDescription>
          </DialogHeader>
          <AddRecordForm
            key={`modal-${formResetKey}`}
            slug={slug}
            table={activeTable}
            draft={draft}
            onDraftChange={setDraft}
            onSubmit={handleAdd}
            pending={addRecord.isPending}
            variant="modal"
          />
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={pendingDelete !== null}
        tableLabel={activeTable.label}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
        pending={deleteRecord.isPending}
        referenceCount={referenceCount.data ?? null}
        referenceCountLoading={referenceCount.isPending}
        referenceCountError={referenceCount.isError}
      />

      <RecordReverseListDialog
        open={opened !== null}
        table={activeTable}
        record={opened}
        tables={tables}
        slug={slug}
        cellStrings={cellStrings}
        onClose={() => setOpened(null)}
      />
    </div>
  );
}

function StatusMessage({ message }: { message: string | null }) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <AnimatePresence>
      {message ? (
        <motion.p
          key="status"
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {message}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

function EmptyTable({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground">{message}</p>;
}

/**
 * The filters-produced empty state (Story 3.4): distinct from the empty-table
 * state, never an error, with a control to clear the active filters.
 */
function FilteredEmpty({
  title,
  body,
  clearLabel,
  onClear,
}: {
  title: string;
  body: string;
  clearLabel: string;
  onClear: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border p-6"
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground">{body}</p>
      <Button
        type="button"
        variant="outline"
        className="mt-1 h-11 min-h-11"
        onClick={onClear}
      >
        {clearLabel}
      </Button>
    </div>
  );
}

/** Desktop: every visible field is a column, plus a trailing actions column. */
function RecordsTable({
  slug,
  table,
  rows,
  cellStrings,
  resolveRelation,
  caption,
  actionsHeader,
  openLabel,
  deleteLabel,
  onOpen,
  onDelete,
  onCellCommit,
  editPending,
  sort,
  sortableKeys,
  onSort,
  sortAriaLabel,
}: {
  slug: string;
  table: TableDefinition;
  rows: RecordData[];
  cellStrings: CellStrings;
  resolveRelation: (
    field: FieldDefinition,
    value: unknown,
  ) => RelationResolution;
  caption: string;
  actionsHeader: string;
  openLabel: string;
  deleteLabel: string;
  onOpen: (record: RecordData) => void;
  onDelete: (record: RecordData) => void;
  onCellCommit: (
    row: RecordData,
    field: FieldDefinition,
    result: InlineCommit,
  ) => void;
  editPending: boolean;
  sort: SortState;
  sortableKeys: Set<string>;
  onSort: (field: string) => void;
  sortAriaLabel: (fieldLabel: string, state: "none" | "asc" | "desc") => string;
}) {
  const fields = table.fields.filter((field) => !field.hidden);

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            {fields.map((field) => {
              const sortable = sortableKeys.has(field.key);
              const active = sort?.field === field.key;
              const ariaSort: "ascending" | "descending" | "none" = active
                ? sort!.direction === "asc"
                  ? "ascending"
                  : "descending"
                : "none";
              return (
                <TableHead
                  key={field.key}
                  scope="col"
                  className="p-0"
                  aria-sort={sortable ? ariaSort : undefined}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort(field.key)}
                      aria-label={sortAriaLabel(
                        field.label,
                        active ? sort!.direction : "none",
                      )}
                      className="flex min-h-12 w-full items-center gap-1.5 px-2 text-left font-medium transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    >
                      <span className="truncate">{field.label}</span>
                      {active ? (
                        sort!.direction === "asc" ? (
                          <ArrowUp aria-hidden="true" className="size-3.5 shrink-0" />
                        ) : (
                          <ArrowDown aria-hidden="true" className="size-3.5 shrink-0" />
                        )
                      ) : (
                        <ArrowUpDown
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-muted-foreground/50"
                        />
                      )}
                    </button>
                  ) : (
                    <span className="flex min-h-12 items-center px-2">
                      {field.label}
                    </span>
                  )}
                </TableHead>
              );
            })}
            <TableHead scope="col" className="text-right">
              <span className="sr-only">{actionsHeader}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const editableRow = !isOptimisticId(row.id);
            return (
            <TableRow key={row.id}>
              {fields.map((field) => (
                <TableCell key={field.key}>
                  <InlineEditCell
                    field={field}
                    value={row.data[field.key]}
                    cellStrings={cellStrings}
                    editable={editableRow}
                    pending={editPending}
                    slug={slug}
                    resolveRelation={resolveRelation}
                    onCommit={(result) => onCellCommit(row, field, result)}
                  />
                </TableCell>
              ))}
              <TableCell className="text-right">
                <div className="flex items-center justify-end">
                  {editableRow ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-12 text-muted-foreground hover:text-foreground"
                      onClick={() => onOpen(row)}
                      aria-label={openLabel}
                    >
                      <Eye aria-hidden="true" className="size-4" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-12 text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(row)}
                    aria-label={deleteLabel}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** Mobile: one card per record; first two visible fields headline it. */
function RecordsCards({
  slug,
  table,
  rows,
  cellStrings,
  resolveRelation,
  openLabel,
  deleteLabel,
  onOpen,
  onDelete,
  onCellCommit,
  editPending,
}: {
  slug: string;
  table: TableDefinition;
  rows: RecordData[];
  cellStrings: CellStrings;
  resolveRelation: (
    field: FieldDefinition,
    value: unknown,
  ) => RelationResolution;
  openLabel: string;
  deleteLabel: string;
  onOpen: (record: RecordData) => void;
  onDelete: (record: RecordData) => void;
  onCellCommit: (
    row: RecordData,
    field: FieldDefinition,
    result: InlineCommit,
  ) => void;
  editPending: boolean;
}) {
  const fields = table.fields.filter((field) => !field.hidden);
  const [primaryField, secondaryField, ...restFields] = fields;

  return (
    <>
      {rows.map((row) => {
        const editableRow = !isOptimisticId(row.id);
        const cellEditable = (_field: FieldDefinition) => editableRow;
        return (
          <li key={row.id}>
            <Card className="gap-0 py-4">
              <CardContent className="flex flex-col gap-2 px-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 flex flex-col gap-2">
                    {primaryField ? (
                      <div className="text-base font-medium text-foreground text-pretty">
                        <InlineEditCell
                          field={primaryField}
                          value={row.data[primaryField.key]}
                          cellStrings={cellStrings}
                          editable={cellEditable(primaryField)}
                          pending={editPending}
                          slug={slug}
                          resolveRelation={resolveRelation}
                          onCommit={(result) =>
                            onCellCommit(row, primaryField, result)
                          }
                        />
                      </div>
                    ) : null}
                    {secondaryField ? (
                      <div className="text-sm text-muted-foreground text-pretty">
                        <InlineEditCell
                          field={secondaryField}
                          value={row.data[secondaryField.key]}
                          cellStrings={cellStrings}
                          editable={cellEditable(secondaryField)}
                          pending={editPending}
                          slug={slug}
                          resolveRelation={resolveRelation}
                          onCommit={(result) =>
                            onCellCommit(row, secondaryField, result)
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center">
                    {editableRow ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-12 text-muted-foreground hover:text-foreground"
                        onClick={() => onOpen(row)}
                        aria-label={openLabel}
                      >
                        <Eye aria-hidden="true" className="size-4" />
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-12 text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(row)}
                      aria-label={deleteLabel}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                </div>
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
                            editable={cellEditable(field)}
                            pending={editPending}
                            slug={slug}
                            resolveRelation={resolveRelation}
                            onCommit={(result) =>
                              onCellCommit(row, field, result)
                            }
                          />
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </>
  );
}
