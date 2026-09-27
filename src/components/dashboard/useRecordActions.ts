import { useState } from "react";
import { useTranslations } from "next-intl";

import type { FieldDefinition, RecordData } from "@/types/db";
import type { RelationFilter } from "@/lib/data/records-client";
import { RecordApiError } from "@/lib/data/records-client";
import {
  isOptimisticId,
  useAddRecord,
  useDeleteRecord,
  useReferenceCount,
  useUpdateRecord,
} from "@/components/dashboard/useRecordMutations";
import type { InlineCommit } from "@/components/dashboard/InlineEditCell";

/**
 * The record write surface for `RecordsView` (Stories 3.2, 3.3, 3.8, 3.9): the
 * three CRUD mutations, the queued delete/open records, the delete-guard
 * reference count, and the single rollback/error message line — plus the
 * handlers that wire them together on the mandatory optimistic sequence.
 *
 * Extracted from `RecordsView` so the component body reads as composition rather
 * than a 200-line tangle of mutation wiring. `onAddSuccess` resets the lifted
 * add-draft (owned by `useAddDraft`) after a successful add.
 *
 * The open reverse-list record resets when the active table changes (the same
 * per-table view-state reset as 3.4); `message` and `pendingDelete` intentionally
 * persist across a table switch, matching the original behavior.
 */
export function useRecordActions({
  slug,
  tableKey,
  relationFilters,
  onAddSuccess,
}: {
  slug: string;
  tableKey: string;
  relationFilters: RelationFilter[];
  onAddSuccess: () => void;
}) {
  const t = useTranslations("SlugDashboard");

  const addRecord = useAddRecord(slug, tableKey, relationFilters);
  const deleteRecord = useDeleteRecord(slug, tableKey, relationFilters);
  const updateRecord = useUpdateRecord(slug, tableKey, relationFilters);

  const [message, setMessage] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RecordData | null>(null);
  const [opened, setOpened] = useState<RecordData | null>(null);

  const [seenTableKey, setSeenTableKey] = useState(tableKey);
  if (seenTableKey !== tableKey) {
    setSeenTableKey(tableKey);
    setOpened(null);
  }

  // Story 3.8: while the confirm dialog is open, count the rows referencing the
  // queued record so the dialog can warn before the soft-delete. A fetch failure
  // is surfaced as a neutral note by the dialog and never blocks the delete.
  const referenceCount = useReferenceCount(
    slug,
    tableKey,
    pendingDelete?.id ?? null,
    { enabled: pendingDelete !== null },
  );

  const translateError = (err: unknown): string => {
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
        onSuccess: () => onAddSuccess(),
        onError: (err) => setMessage(translateError(err)),
      },
    );
  };

  // A not-yet-settled optimistic row has a temp id that matches no server row, so
  // deleting/opening it would send a bad id — ignore it until the add settles.
  const requestDelete = (record: RecordData) => {
    if (isOptimisticId(record.id)) return;
    setPendingDelete(record);
  };

  const requestOpen = (record: RecordData) => {
    if (isOptimisticId(record.id)) return;
    setOpened(record);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setMessage(null);
    deleteRecord.mutate(
      { id: target.id, expectedVersion: target.version },
      { onError: (err) => setMessage(translateError(err)) },
    );
    setPendingDelete(null);
  };

  // Commit one inline cell edit: build the FULL merged row `data` (a cleared value
  // drops the key), then run the optimistic PATCH gated on the row's version.
  const commitCellEdit = (
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
      { onError: (err) => setMessage(translateError(err)) },
    );
  };

  return {
    addPending: addRecord.isPending,
    deletePending: deleteRecord.isPending,
    updatePending: updateRecord.isPending,
    message,
    setMessage,
    pendingDelete,
    setPendingDelete,
    opened,
    setOpened,
    referenceCount,
    handleAdd,
    requestDelete,
    requestOpen,
    confirmDelete,
    commitCellEdit,
  };
}
