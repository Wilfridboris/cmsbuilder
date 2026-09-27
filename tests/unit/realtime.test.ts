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
});

describe("invalidateOrgRecords", () => {
  it("invalidates the org's records prefix key (never patches the cache)", () => {
    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    invalidateOrgRecords(queryClient, "acme");

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["records", "acme"],
    });
    // The prefix key (no tableKey) matches every ["records", slug, tableKey]
    // query, so one call reconciles every logical table cached for the org.
    const call = invalidateQueries.mock.calls[0][0] as {
      queryKey: unknown[];
    };
    expect(call.queryKey).toHaveLength(2);
  });
});
