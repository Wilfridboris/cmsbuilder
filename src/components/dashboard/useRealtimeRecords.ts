"use client";

import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  invalidateOrgRecords,
  recordsChangeFilter,
  recordsChannelName,
  shouldReconcileOnStatus,
} from "@/lib/data/realtime";

/**
 * `useRealtimeRecords({ slug, orgId })` — the Story 3.6 live multi-user sync.
 *
 * Subscribes the mounted dashboard to a Supabase Realtime `postgres_changes`
 * channel on `public.records`, scoped to the caller's org. On ANY received
 * change event (INSERT/UPDATE — app deletes are soft UPDATEs of `deleted_at`)
 * and on every reconcile-worthy subscribe status (`SUBSCRIBED` — initial
 * subscribe AND post-reconnect rejoin — plus `CHANNEL_ERROR` / `TIMED_OUT`, a
 * fallback refetch when the socket errors or times out so a dropped connection
 * never leaves the dashboard silently stale; see `shouldReconcileOnStatus`), it
 * calls `invalidateQueries(["records", slug])` so the cache refetches
 * authoritative state through the existing `GET /api/records` path. That refetch
 * runs over HTTP independent of the WebSocket, so it reconciles even while the
 * socket is down; supabase-js still owns reconnection (no bespoke retry loop). It
 * NEVER
 * calls `setQueryData` or applies the event payload to rows — the refetch is the
 * single source of truth (mandatory epic pattern), and a self-echoed event just
 * triggers an idempotent no-op refetch.
 *
 * The authenticated browser client (`@supabase/ssr` cookies) carries the user's
 * JWT, so RLS (`records_tenant_isolation`) delivers only the caller's org rows —
 * the org filter is a delivery optimization, not the security boundary. One
 * channel per mount; cleanup removes it on unmount so table switches / navigation
 * never leak channels or stack duplicate subscriptions.
 *
 * A side effect only: it changes no read/write path. The optimistic CRUD in
 * `useRecordMutations` (its own settle-time invalidate) is untouched.
 */
export function useRealtimeRecords({
  slug,
  orgId,
}: {
  slug: string;
  orgId: string;
}): void {
  const queryClient = useQueryClient();
  // One browser client per mounted dashboard (stable across re-renders). The
  // client reads the public anon key + session cookies; no secret is involved.
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  useEffect(() => {
    const invalidate = () => invalidateOrgRecords(queryClient, slug);

    const channel = supabase
      .channel(recordsChannelName(orgId))
      .on(
        // supabase-js types this event name as a string literal union its
        // Realtime typings don't export cleanly here; the payload is ignored
        // (we invalidate, never patch), so the handler needs no payload type.
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "records",
          filter: recordsChangeFilter(orgId),
        },
        () => invalidate(),
      )
      .subscribe((status) => {
        // Reconcile on SUBSCRIBED (initial subscribe AND every post-reconnect
        // rejoin, catching up on changes missed during the gap) and on
        // CHANNEL_ERROR / TIMED_OUT (an HTTP fallback refetch so an errored/
        // timed-out socket does not silently stale the view). Not on CLOSED (the
        // intentional teardown) or any unknown status. supabase-js auto-rejoins
        // the socket; no manual reload, no bespoke retry loop.
        if (shouldReconcileOnStatus(status)) {
          invalidate();
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, queryClient, slug, orgId]);
}
