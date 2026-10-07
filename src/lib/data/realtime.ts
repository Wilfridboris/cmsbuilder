import type { QueryClient } from "@tanstack/react-query";

/**
 * Pure, socket-free helpers for the Story 3.6 Realtime records subscription.
 *
 * Kept out of the hook so the channel config (name, filter) and the invalidation
 * behavior are node-testable without a WebSocket or a DOM. `useRealtimeRecords`
 * composes these; the live subscribe/reconnect DOM behavior is verified by the
 * post-commit Playwright manual review (this repo has no jsdom).
 */

/**
 * The Realtime channel name for an org's records subscription. One channel per
 * mounted dashboard, keyed by the org UUID so subscriptions never collide.
 */
export function recordsChannelName(orgId: string): string {
  return `records-org-${orgId}`;
}

/**
 * The `postgres_changes` filter string scoping delivered events to the caller's
 * org. The org UUID is a tenant identifier, not a secret; RLS
 * (`records_tenant_isolation`) stays the security boundary and this filter is a
 * traffic optimization that avoids delivering-then-discarding other-org rows.
 */
export function recordsChangeFilter(orgId: string): string {
  return `organization_id=eq.${orgId}`;
}

/**
 * Invalidate every logical table cached for this org in one call.
 *
 * The prefix key `["records", slug]` matches every `["records", slug, tableKey]`
 * query, so the currently-viewed table refetches now and any other cached table
 * is marked stale (refetched when next viewed). The Realtime handler MUST react
 * this way and never `setQueryData` / patch the cache from the event payload —
 * authoritative state always comes from the `GET /api/records` refetch.
 *
 * It ALSO invalidates the relation-label prefix `["relation-labels", slug]`
 * (Story 3.7) so that when a referenced row's `displayField` value changes, every
 * referencing view re-resolves and shows the new label (AC4). Both mutation-time
 * invalidation (`useUpdateRecord.onSettled`) and this real-time (3.6) handler
 * clear it, so an edited target's label always refetches at read time — the label
 * is never copied into the referencing row.
 */
export function invalidateOrgRecords(
  queryClient: QueryClient,
  slug: string,
): void {
  void queryClient.invalidateQueries({ queryKey: ["records", slug] });
  void queryClient.invalidateQueries({ queryKey: ["relation-labels", slug] });
}

/**
 * Decide whether a Realtime subscribe status should trigger a reconcile
 * (`invalidateOrgRecords` → `GET /api/records` refetch).
 *
 * Returns `true` for:
 * - `"SUBSCRIBED"` — initial subscribe AND every post-reconnect rejoin (catch up
 *   on changes missed during the gap).
 * - `"CHANNEL_ERROR"` / `"TIMED_OUT"` — an errored or timed-out socket. The
 *   refetch runs over HTTP, independent of the WebSocket, so the dashboard
 *   reconciles authoritative state even while the socket is down instead of
 *   silently staling (epic-3 retro D6). supabase-js still owns reconnection; when
 *   it auto-rejoins, `SUBSCRIBED` fires again and reconciles once more.
 *
 * Returns `false` for everything else, including `"CLOSED"` — the intentional
 * `removeChannel`/unmount teardown path, where refetching a disappearing view is
 * wasted work — and any unknown/future status string.
 *
 * Pure and socket-free so the status→reconcile decision is node-testable without
 * a WebSocket; the hook composes it.
 */
export function shouldReconcileOnStatus(status: string): boolean {
  return (
    status === "SUBSCRIBED" ||
    status === "CHANNEL_ERROR" ||
    status === "TIMED_OUT"
  );
}
