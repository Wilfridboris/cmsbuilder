import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { deriveFormSlug, ensureUniqueFormSlug } from "@/lib/forms/form-slug";

/**
 * Story 14.1 — form slug invariants (the I/O & Edge-Case matrix for slugging).
 *
 * `deriveFormSlug` is a pure kebab + safe-fallback; `ensureUniqueFormSlug` is tested
 * against a tiny in-memory fake Supabase client that records the taken `(org, slug)`
 * pairs, so the `-N` suffixing, org-scoping, and self-exclusion are exercised without a
 * real DB.
 */

describe("deriveFormSlug", () => {
  it("kebab-cases a normal title", () => {
    expect(deriveFormSlug("Job Request")).toBe("job-request");
  });

  it("strips diacritics (French-generation path)", () => {
    expect(deriveFormSlug("Demande de Région")).toBe("demande-de-region");
  });

  it("collapses runs of non-alphanumerics to a single hyphen and trims", () => {
    expect(deriveFormSlug("  Hello --- World!!! ")).toBe("hello-world");
  });

  it("falls back to a safe base for a non-Latin-only title", () => {
    // No Latin alphanumerics survive the fold -> the `form` fallback (then org-uniqued).
    expect(deriveFormSlug("日本語")).toBe("form");
    expect(deriveFormSlug("   ")).toBe("form");
    expect(deriveFormSlug("!!!")).toBe("form");
  });
});

/**
 * A minimal fake of the PostgREST query chain the resolver uses:
 *   client.from("forms").select("id").eq(...).eq(...).neq(...)?.limit(1).maybeSingle()
 * `taken` is the set of slugs that exist for the queried org; `excludeId` lets the
 * self-exclusion path return "free" for the form's own row.
 */
function fakeClient(options: {
  takenByOrg: Record<string, Array<{ id: string; slug: string }>>;
}): SupabaseClient {
  return {
    from() {
      let orgId = "";
      let slug = "";
      let excludeId: string | null = null;
      const chain = {
        select() {
          return chain;
        },
        eq(column: string, value: string) {
          if (column === "organization_id") orgId = value;
          if (column === "slug") slug = value;
          return chain;
        },
        neq(_column: string, value: string) {
          excludeId = value;
          return chain;
        },
        limit() {
          return chain;
        },
        async maybeSingle() {
          const rows = options.takenByOrg[orgId] ?? [];
          const match = rows.find(
            (r) => r.slug === slug && r.id !== excludeId,
          );
          return { data: match ?? null, error: null };
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

describe("ensureUniqueFormSlug", () => {
  it("returns the base when it is free in the org", async () => {
    const client = fakeClient({ takenByOrg: {} });
    expect(await ensureUniqueFormSlug(client, "org-1", "job-request")).toBe(
      "job-request",
    );
  });

  it("suffixes -2 on a collision in the same org", async () => {
    const client = fakeClient({
      takenByOrg: { "org-1": [{ id: "f1", slug: "job-request" }] },
    });
    expect(await ensureUniqueFormSlug(client, "org-1", "job-request")).toBe(
      "job-request-2",
    );
  });

  it("skips consecutive taken suffixes (-2 taken -> -3)", async () => {
    const client = fakeClient({
      takenByOrg: {
        "org-1": [
          { id: "f1", slug: "job-request" },
          { id: "f2", slug: "job-request-2" },
        ],
      },
    });
    expect(await ensureUniqueFormSlug(client, "org-1", "job-request")).toBe(
      "job-request-3",
    );
  });

  it("is org-scoped: another org's identical slug does not collide", async () => {
    const client = fakeClient({
      takenByOrg: { "org-2": [{ id: "x", slug: "job-request" }] },
    });
    // org-1 has no `job-request`, so the base is free despite org-2 owning it.
    expect(await ensureUniqueFormSlug(client, "org-1", "job-request")).toBe(
      "job-request",
    );
  });

  it("excludes the form's own row (self-edit keeps its slug free)", async () => {
    const client = fakeClient({
      takenByOrg: { "org-1": [{ id: "f1", slug: "job-request" }] },
    });
    // Editing f1 to (re-normalize to) its own slug must not collide with itself.
    expect(
      await ensureUniqueFormSlug(client, "org-1", "job-request", "f1"),
    ).toBe("job-request");
  });

  it("still collides with a DIFFERENT form when excluding self", async () => {
    const client = fakeClient({
      takenByOrg: {
        "org-1": [
          { id: "f1", slug: "job-request" },
          { id: "f2", slug: "contact" },
        ],
      },
    });
    // f2 wants `job-request`, which f1 owns -> suffixed, not falsely freed by exclusion.
    expect(
      await ensureUniqueFormSlug(client, "org-1", "job-request", "f2"),
    ).toBe("job-request-2");
  });
});
