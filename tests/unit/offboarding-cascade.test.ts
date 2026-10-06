import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cascadeDeleteOrganization,
  CASCADE_INCLUDE_TABLES,
  CASCADE_EXCLUDE_TABLES,
} from "@/lib/offboarding/cascade-delete";

/**
 * Unit coverage for the Day-30 offboarding cascade (Story 8.5, FR38) WITHOUT a live
 * DB. A fake service-role client records every table/filter touched and every storage
 * op. Pins the single non-obvious correctness point of the story:
 *   - the purge deletes EXACTLY the INCLUDE set, each filtered by organization_id;
 *   - it NEVER references any EXCLUDE (retained invoice/credit-note) table;
 *   - it NEVER deletes the `organizations` row (that would cascade the retained docs);
 *   - it removes the org's business-logos object(s);
 *   - it writes the `deleted` tombstone + offboarding_purged_at on the surviving row;
 *   - it is re-entrant (a clean re-run with nothing left still tombstones).
 */

const ORG = "org-xyz";

type DeleteCall = { table: string; column: string; value: string };
type UpdateCall = { table: string; patch: Record<string, unknown>; id: string };

function makeClient(opts?: {
  listObjects?: { name: string }[];
  listError?: { message: string } | null;
}) {
  const deletes: DeleteCall[] = [];
  const updates: UpdateCall[] = [];
  const removed: string[][] = [];
  const tablesTouched: string[] = [];

  const client = {
    from(table: string) {
      tablesTouched.push(table);
      return {
        delete: () => ({
          eq: async (column: string, value: string) => {
            deletes.push({ table, column, value });
            return { error: null };
          },
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            updates.push({ table, patch, id });
            return { error: null };
          },
        }),
      };
    },
    storage: {
      from: (_bucket: string) => ({
        list: async (_prefix: string) => ({
          data: opts?.listObjects ?? [{ name: "logo.png" }],
          error: opts?.listError ?? null,
        }),
        remove: async (keys: string[]) => {
          removed.push(keys);
          return { error: null };
        },
      }),
    },
  };

  return { client, deletes, updates, removed, tablesTouched };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cascadeDeleteOrganization (Story 8.5)", () => {
  it("deletes EXACTLY the INCLUDE set, each filtered by organization_id", async () => {
    const { client, deletes } = makeClient();
    await cascadeDeleteOrganization(client as never, ORG);

    const deletedTables = deletes.map((d) => d.table);
    // Every INCLUDE table was deleted, exactly once.
    expect(deletedTables).toEqual([...CASCADE_INCLUDE_TABLES]);
    // Each delete is scoped by organization_id to this org.
    for (const d of deletes) {
      expect(d.column).toBe("organization_id");
      expect(d.value).toBe(ORG);
    }
  });

  it("NEVER references any EXCLUDE (retained invoice/credit-note) table", async () => {
    const { client, tablesTouched } = makeClient();
    await cascadeDeleteOrganization(client as never, ORG);
    for (const excluded of CASCADE_EXCLUDE_TABLES) {
      expect(tablesTouched).not.toContain(excluded);
    }
  });

  it("NEVER deletes the organizations row (keeps the retained-docs tombstone)", async () => {
    const { client, deletes } = makeClient();
    await cascadeDeleteOrganization(client as never, ORG);
    expect(deletes.some((d) => d.table === "organizations")).toBe(false);
  });

  it("removes the org's business-logos object(s)", async () => {
    const { client, removed } = makeClient({
      listObjects: [{ name: "logo.png" }],
    });
    const result = await cascadeDeleteOrganization(client as never, ORG);
    expect(removed).toEqual([[`${ORG}/logo.png`]]);
    expect(result.logosRemoved).toBe(1);
  });

  it("writes the deleted tombstone + offboarding_purged_at on the surviving org row", async () => {
    const { client, updates } = makeClient();
    await cascadeDeleteOrganization(client as never, ORG);

    const tombstone = updates.find((u) => u.table === "organizations");
    expect(tombstone).toBeDefined();
    expect(tombstone!.id).toBe(ORG);
    expect(tombstone!.patch.subscription_status).toBe("deleted");
    expect(tombstone!.patch.offboarding_purged_at).toEqual(expect.any(String));
  });

  it("is re-entrant: a re-run with nothing left still tombstones (no logo removal)", async () => {
    const { client, deletes, updates, removed } = makeClient({
      listObjects: [],
    });
    const result = await cascadeDeleteOrganization(client as never, ORG);
    // Deletes still issued (idempotent — zero rows affected downstream).
    expect(deletes.map((d) => d.table)).toEqual([...CASCADE_INCLUDE_TABLES]);
    // No logo to remove.
    expect(removed).toHaveLength(0);
    expect(result.logosRemoved).toBe(0);
    // Tombstone still written.
    expect(updates.some((u) => u.table === "organizations")).toBe(true);
  });

  it("the EXCLUDE list and INCLUDE list are disjoint (static guard)", () => {
    for (const t of CASCADE_INCLUDE_TABLES) {
      expect(CASCADE_EXCLUDE_TABLES).not.toContain(t as never);
    }
    expect(CASCADE_EXCLUDE_TABLES).not.toContain("organizations" as never);
  });
});
