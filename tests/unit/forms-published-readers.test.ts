import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getPublishedFormBySlug,
  getPrimaryPublishedForm,
} from "@/lib/data/forms";

/**
 * Query-shape coverage for the Story 14.2 published-gated readers WITHOUT a live DB.
 * These two readers are the gate `resolvePublicFormTarget` relies on, so this locks the
 * exact filter/order chain each issues against the `forms` table (mirroring the
 * `form-slug.test.ts` fake-client pattern):
 *
 *   getPublishedFormBySlug →
 *     .from("forms").select("*").eq("organization_id",…).eq("slug",…)
 *       .eq("published",true).maybeSingle()
 *   getPrimaryPublishedForm →
 *     .from("forms").select("*").eq("organization_id",…).eq("published",true)
 *       .order("created_at",{ascending:true}).limit(1).maybeSingle()
 *
 * The invariants under test: the readers NEVER return an unpublished form (the
 * `published = true` filter is always applied), and "primary" is the OLDEST published
 * row (`created_at` ascending, limited to one). A query error surfaces as a thrown
 * generic message (the resolver collapses it to null).
 */

type Row = {
  id: string;
  organization_id: string;
  slug: string;
  published: boolean;
  created_at: string;
};

/**
 * A fake client that records the applied filters + ordering and returns the first row
 * matching the accumulated `eq` filters, honoring `order` + `limit`.
 */
function fakeClient(rows: Row[], opts: { error?: string } = {}): SupabaseClient {
  return {
    from() {
      const eqFilters: Record<string, unknown> = {};
      const orderKeys: { col: string; asc: boolean }[] = [];
      let limitN = Infinity;
      const chain = {
        select() {
          return chain;
        },
        eq(column: string, value: unknown) {
          eqFilters[column] = value;
          return chain;
        },
        order(column: string, { ascending }: { ascending: boolean }) {
          // Accumulate keys so a secondary sort (e.g. `id` after `created_at`) is
          // applied in sequence, mirroring PostgREST's multi-`order` behavior.
          orderKeys.push({ col: column, asc: ascending });
          return chain;
        },
        limit(n: number) {
          limitN = n;
          return chain;
        },
        async maybeSingle() {
          if (opts.error) {
            return { data: null, error: { message: opts.error } };
          }
          let matched = rows.filter((r) =>
            Object.entries(eqFilters).every(
              (entry) => (r as Record<string, unknown>)[entry[0]] === entry[1],
            ),
          );
          if (orderKeys.length > 0) {
            matched = [...matched].sort((a, b) => {
              for (const { col, asc } of orderKeys) {
                const av = String((a as Record<string, unknown>)[col]);
                const bv = String((b as Record<string, unknown>)[col]);
                const cmp = asc ? av.localeCompare(bv) : bv.localeCompare(av);
                if (cmp !== 0) return cmp;
              }
              return 0;
            });
          }
          const limited = matched.slice(0, limitN);
          return { data: limited[0] ?? null, error: null };
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

const PUBLISHED: Row = {
  id: "f-pub",
  organization_id: "org-1",
  slug: "contact",
  published: true,
  created_at: "2026-02-01T00:00:00Z",
};
const UNPUBLISHED: Row = {
  id: "f-draft",
  organization_id: "org-1",
  slug: "draft",
  published: false,
  created_at: "2026-01-01T00:00:00Z",
};

describe("getPublishedFormBySlug — published gate", () => {
  it("returns a published form matching (org, slug)", async () => {
    const client = fakeClient([PUBLISHED, UNPUBLISHED]);
    const form = await getPublishedFormBySlug(client, "org-1", "contact");
    expect(form?.id).toBe("f-pub");
  });

  it("returns null for an unpublished form (never surfaced on the public route)", async () => {
    const client = fakeClient([UNPUBLISHED]);
    expect(await getPublishedFormBySlug(client, "org-1", "draft")).toBeNull();
  });

  it("returns null for an unknown slug", async () => {
    const client = fakeClient([PUBLISHED]);
    expect(await getPublishedFormBySlug(client, "org-1", "nope")).toBeNull();
  });

  it("throws a generic message on a query error", async () => {
    const client = fakeClient([], { error: "boom" });
    await expect(
      getPublishedFormBySlug(client, "org-1", "contact"),
    ).rejects.toThrow(/Failed to load form/);
  });
});

describe("getPrimaryPublishedForm — oldest published", () => {
  it("returns the OLDEST published form by created_at (primary)", async () => {
    const older: Row = { ...PUBLISHED, id: "f-older", created_at: "2026-01-05T00:00:00Z" };
    const newer: Row = { ...PUBLISHED, id: "f-newer", created_at: "2026-03-01T00:00:00Z" };
    const client = fakeClient([newer, older, UNPUBLISHED]);
    const form = await getPrimaryPublishedForm(client, "org-1");
    expect(form?.id).toBe("f-older");
  });

  it("breaks a created_at tie deterministically by lowest id", async () => {
    // Two published forms share an identical created_at; the secondary `id` sort must
    // make the primary selection deterministic (lowest id), never order-of-insertion.
    const tieB: Row = { ...PUBLISHED, id: "f-b", created_at: "2026-01-01T00:00:00Z" };
    const tieA: Row = { ...PUBLISHED, id: "f-a", created_at: "2026-01-01T00:00:00Z" };
    expect((await getPrimaryPublishedForm(fakeClient([tieB, tieA]), "org-1"))?.id).toBe("f-a");
    expect((await getPrimaryPublishedForm(fakeClient([tieA, tieB]), "org-1"))?.id).toBe("f-a");
  });

  it("never selects an unpublished form even if it is older", async () => {
    const oldDraft: Row = { ...UNPUBLISHED, created_at: "2020-01-01T00:00:00Z" };
    const client = fakeClient([oldDraft, PUBLISHED]);
    const form = await getPrimaryPublishedForm(client, "org-1");
    expect(form?.id).toBe("f-pub");
  });

  it("returns null when the org has no published form (pre-14.3 default)", async () => {
    const client = fakeClient([UNPUBLISHED]);
    expect(await getPrimaryPublishedForm(client, "org-1")).toBeNull();
  });

  it("throws a generic message on a query error", async () => {
    const client = fakeClient([], { error: "boom" });
    await expect(getPrimaryPublishedForm(client, "org-1")).rejects.toThrow(
      /Failed to load form/,
    );
  });
});
