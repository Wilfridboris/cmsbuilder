import { describe, expect, it, vi } from "vitest";

import {
  invalidateOrgRecords,
  recordsChangeFilter,
  recordsChannelName,
} from "@/lib/data/realtime";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Unit coverage for the Story 3.6 pure Realtime seams — the channel config and
 * the invalidation behavior the subscription hook composes. These are socket-
 * and DOM-free, so they pin the frozen I/O matrix without jsdom or a WebSocket;
 * the live subscribe/reconnect DOM behavior is Playwright-verified per the
 * 3.1–3.5 precedent.
 */

const ORG_ID = "11111111-2222-3333-4444-555555555555";

describe("recordsChannelName", () => {
  it("keys the channel by the org UUID", () => {
    expect(recordsChannelName(ORG_ID)).toBe(`records-org-${ORG_ID}`);
  });

  it("gives distinct orgs distinct channel names", () => {
    expect(recordsChannelName("org-a")).not.toBe(recordsChannelName("org-b"));
  });
});

describe("recordsChangeFilter", () => {
  it("scopes postgres_changes to the caller's org", () => {
    expect(recordsChangeFilter(ORG_ID)).toBe(`organization_id=eq.${ORG_ID}`);
  });

  it("[6.3] scopes the subscription to organization_id with no second predicate", () => {
    // Story 6.3 (FR27, NFR-P5) invariant pinned here: the per-org records
    // subscription filters on organization_id and nothing else. That org-only
    // filter is what lets an anonymous public-intake row (actor_id =
    // INTAKE_ACTOR_ID, written by the service-role intake handler) reach the
    // owner's Realtime channel identically to a dashboard-authored write. If the
    // filter ever gained a second predicate, intake rows could silently stop
    // appearing in the owner's dashboard in real time.
    // Scope of this test: the pure filter string only. The surrounding live
    // behavior (the `event: "*"` subscription, the payload-agnostic handler
    // re-invalidating GET /api/records, and the ~2s delivery) is verified by the
    // post-commit Playwright manual review, since this repo has no jsdom.
    const filter = recordsChangeFilter(ORG_ID);

    // `toBe` proves the filter is exactly the org predicate (no actor or other
    // field); `not.toContain("&")` guards specifically against an appended,
    // compound (`&`-joined) predicate that an equality assertion alone invites a
    // future edit to "fix" by updating the expected string.
    expect(filter).toBe(`organization_id=eq.${ORG_ID}`);
    expect(filter).not.toContain("&");
  });
});

describe("invalidateOrgRecords", () => {
  it("invalidates the org's records AND relation-label prefix keys (never patches the cache)", () => {
    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    invalidateOrgRecords(queryClient, "acme");

    // Story 3.7 extends this to also invalidate the relation-label prefix so an
    // edited target's new label re-resolves at read time (AC4).
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["records", "acme"],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["relation-labels", "acme"],
    });
    // The prefix keys (no tableKey / targetTable) match every nested query, so
    // one call each reconciles every logical table + relation-label cached for
    // the org.
    for (const call of invalidateQueries.mock.calls) {
      const arg = call[0] as { queryKey: unknown[] };
      expect(arg.queryKey).toHaveLength(2);
    }
  });
});
