"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { RecordData } from "@/types/db";
import {
  createRecord,
  deleteRecord,
  RecordApiError,
} from "@/lib/data/records-client";
import {
  applyOptimisticAdd,
  applyOptimisticDelete,
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

const recordsKey = (slug: string, tableKey: string) =>
  ["records", slug, tableKey] as const;

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
export function useAddRecord(slug: string, tableKey: string) {
  const queryClient = useQueryClient();
  const key = recordsKey(slug, tableKey);

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

type DeleteVars = { id: string; expectedVersion: number };

/** `useDeleteRecord(slug, tableKey)` — optimistic soft-delete. */
export function useDeleteRecord(slug: string, tableKey: string) {
  const queryClient = useQueryClient();
  const key = recordsKey(slug, tableKey);

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
