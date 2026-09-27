"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { RecordData } from "@/types/db";
import {
  createRecord,
  deleteRecord,
  fetchReferenceCount,
  updateRecord,
  RecordApiError,
  type RelationFilter,
} from "@/lib/data/records-client";
import {
  applyOptimisticAdd,
  applyOptimisticDelete,
  applyOptimisticUpdate,
} from "@/lib/forms/field-input";

/**
 * TanStack Query mutation hooks encapsulating the MANDATORY optimistic sequence
 * (Story 3.2): cancelQueries → snapshot previous → optimistic setQueryData →
 * roll back to the snapshot on error → invalidateQueries on settle. Both write
 * against the active table's key `['records', slug, tableKey]`.
 *
 * On error the hook surfaces the server's translated error CODE (from
 * `RecordApiError`) so the caller can resolve a non-technical message; a raw
 * error is never exposed.
 */

/**
 * Serialize the active relation filters into a stable, order-independent key part
 * (Story 3.8) so the records query key changes when a relation filter is added /
 * removed and the mutation hooks write against the SAME key `RecordsView` reads.
 * Sorted `field:id` strings — an empty list yields `[]`.
 */
export function relationFilterKeyPart(
  relationFilters: RelationFilter[],
): string[] {
  return relationFilters
    .map(({ field, targetId }) => `${field}:${targetId}`)
    .sort();
}

const recordsKey = (
  slug: string,
  tableKey: string,
  relationFilters: RelationFilter[] = [],
) => ["records", slug, tableKey, relationFilterKeyPart(relationFilters)] as const;

/** Prefix marking a client-only optimistic row that has no server row yet. */
export const OPTIMISTIC_ID_PREFIX = "optimistic-";

/** True while a row is an un-settled optimistic insert (no matching server row). */
export function isOptimisticId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX);
}

type AddContext = { previous: RecordData[] | undefined; tempId: string };
type DeleteContext = { previous: RecordData[] | undefined };

type AddVars = {
  /** Coerced `data` payload (blank fields already omitted). */
  data: Record<string, unknown>;
  /** Client-generated idempotency key deduping retried inserts in `mutate.ts`. */
  idempotencyKey: string;
};

/** `useAddRecord(slug, tableKey)` — optimistic insert at the top of the table. */
export function useAddRecord(
  slug: string,
  tableKey: string,
  relationFilters: RelationFilter[] = [],
) {
  const queryClient = useQueryClient();
  const key = recordsKey(slug, tableKey, relationFilters);

  return useMutation<RecordData, RecordApiError, AddVars, AddContext>({
    mutationFn: ({ data, idempotencyKey }) =>
      createRecord(slug, tableKey, data, idempotencyKey),
    onMutate: async ({ data }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<RecordData[]>(key);
      // A temporary client id + version reconciled to the server row on settle.
      const tempId = `${OPTIMISTIC_ID_PREFIX}${
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2)
      }`;
      const optimistic: RecordData = { id: tempId, version: 1, data };
      queryClient.setQueryData<RecordData[]>(key, (list) =>
        applyOptimisticAdd(list ?? [], optimistic),
      );
      return { previous, tempId };
    },
    onError: (_err, _vars, context) => {
      if (context) {
        queryClient.setQueryData<RecordData[]>(key, context.previous);
      }
    },
    onSettled: () => {
      // Authoritative refetch reconciles the temp row to the server id/version.
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

type UpdateContext = { previous: RecordData[] | undefined };

type UpdateVars = {
  /** The target row's id (a real server id — optimistic rows are guarded out). */
  id: string;
  /** The full merged row `data` (`{ ...row.data, [key]: value }`, cleared key omitted). */
  data: Record<string, unknown>;
  /** The version last read, gating the write (409 on a concurrent foreign edit). */
  expectedVersion: number;
};

/**
 * `useUpdateRecord(slug, tableKey)` — optimistic inline edit. Sends the FULL
 * merged `data` (like POST): `mutate`'s update replaces `records.data` wholesale
 * and `expectedVersion` gating turns a concurrent foreign edit into a clean 409
 * rather than a silent clobber. Runs the mandatory optimistic sequence and
 * reconciles the row's `version` from the server result on success.
 */
export function useUpdateRecord(
  slug: string,
  tableKey: string,
  relationFilters: RelationFilter[] = [],
) {
  const queryClient = useQueryClient();
  const key = recordsKey(slug, tableKey, relationFilters);

  return useMutation<RecordData, RecordApiError, UpdateVars, UpdateContext>({
    mutationFn: ({ id, data, expectedVersion }) =>
      updateRecord(slug, id, tableKey, data, expectedVersion),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<RecordData[]>(key);
      queryClient.setQueryData<RecordData[]>(key, (list) =>
        applyOptimisticUpdate(list ?? [], id, data),
      );
      return { previous };
    },
    onSuccess: (server) => {
      // Reconcile the edited row's version (and data) from the server result so
      // a follow-up edit gates on the fresh version without waiting for the
      // invalidate refetch.
      queryClient.setQueryData<RecordData[]>(key, (list) =>
        applyOptimisticUpdate(list ?? [], server.id, server.data, server.version),
      );
    },
    onError: (_err, _vars, context) => {
      if (context) {
        queryClient.setQueryData<RecordData[]>(key, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      // A row edit may have changed a `displayField` value, so any view that
      // resolves this row as a relation reference must re-resolve its label
      // (Story 3.7 AC4). Clear the relation-label prefix for the org — the label
      // is resolved at read time, never copied into the referencing row.
      void queryClient.invalidateQueries({
        queryKey: ["relation-labels", slug],
      });
    },
  });
}

type DeleteVars = { id: string; expectedVersion: number };

/** `useDeleteRecord(slug, tableKey)` — optimistic soft-delete. */
export function useDeleteRecord(
  slug: string,
  tableKey: string,
  relationFilters: RelationFilter[] = [],
) {
  const queryClient = useQueryClient();
  const key = recordsKey(slug, tableKey, relationFilters);

  return useMutation<void, RecordApiError, DeleteVars, DeleteContext>({
    mutationFn: ({ id, expectedVersion }) =>
      deleteRecord(slug, id, expectedVersion),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<RecordData[]>(key);
      queryClient.setQueryData<RecordData[]>(key, (list) =>
        applyOptimisticDelete(list ?? [], id),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context) {
        queryClient.setQueryData<RecordData[]>(key, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * `useReferenceCount(slug, table, id, { enabled })` (Story 3.8) — fetch how many
 * non-deleted rows reference the record queued for deletion, so the confirm dialog
 * can warn before a soft-delete. Keyed `["reference-count", slug, table, id]` and
 * gated by `enabled` (the dialog fetches only while it is open). A fetch failure is
 * left to the caller to surface as a neutral "couldn't verify" note — it never
 * blocks the delete.
 */
export function useReferenceCount(
  slug: string,
  table: string,
  id: string | null,
  { enabled }: { enabled: boolean },
) {
  return useQuery<number, RecordApiError>({
    queryKey: ["reference-count", slug, table, id],
    queryFn: () => fetchReferenceCount(slug, table, id as string),
    enabled: enabled && Boolean(id),
    staleTime: 0,
    retry: false,
  });
}
