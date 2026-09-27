import { describe, expect, it } from "vitest";

import { searchQuerySchema } from "@/app/api/records/search/schemas";
import {
  MAX_LABEL_IDS,
  labelsQuerySchema,
} from "@/app/api/records/labels/schemas";

/**
 * Pure Zod-shape coverage for the two Story 3.7 GET-route validators, mirroring
 * `records-api.test.ts`. Locks the `ids` split/trim/dedup transform, the
 * `MAX_LABEL_IDS` cap (the only bound on the `id IN (...)` list), and the
 * defaulted empty search query.
 */

describe("labelsQuerySchema", () => {
  it("splits, trims, and filters a comma-separated id list", () => {
    const parsed = labelsQuerySchema.parse({
      slug: "acme",
      table: "clients",
      ids: " c1 , c2 ,, c3 ",
    });
    expect(parsed.ids).toEqual(["c1", "c2", "c3"]);
  });

  it("rejects an all-blank id list", () => {
    expect(
      labelsQuerySchema.safeParse({ slug: "acme", table: "clients", ids: " , , " })
        .success,
    ).toBe(false);
  });

  it(`rejects more than MAX_LABEL_IDS (${MAX_LABEL_IDS}) ids`, () => {
    const ids = Array.from({ length: MAX_LABEL_IDS + 1 }, (_, i) => `id${i}`).join(
      ",",
    );
    expect(
      labelsQuerySchema.safeParse({ slug: "acme", table: "clients", ids }).success,
    ).toBe(false);
  });

  it(`accepts exactly MAX_LABEL_IDS (${MAX_LABEL_IDS}) ids`, () => {
    const ids = Array.from({ length: MAX_LABEL_IDS }, (_, i) => `id${i}`).join(",");
    expect(
      labelsQuerySchema.safeParse({ slug: "acme", table: "clients", ids }).success,
    ).toBe(true);
  });

  it("requires slug, table, and ids", () => {
    expect(labelsQuerySchema.safeParse({ slug: "acme", table: "clients" }).success).toBe(
      false,
    );
    expect(labelsQuerySchema.safeParse({ table: "clients", ids: "c1" }).success).toBe(
      false,
    );
  });
});

describe("searchQuerySchema", () => {
  it("defaults an omitted query to an empty string", () => {
    const parsed = searchQuerySchema.parse({ slug: "acme", table: "clients" });
    expect(parsed.query).toBe("");
  });

  it("requires a non-empty slug and table", () => {
    expect(searchQuerySchema.safeParse({ slug: "", table: "clients" }).success).toBe(
      false,
    );
    expect(searchQuerySchema.safeParse({ slug: "acme", table: "" }).success).toBe(false);
  });

  it("rejects a query longer than 200 chars", () => {
    expect(
      searchQuerySchema.safeParse({
        slug: "acme",
        table: "clients",
        query: "x".repeat(201),
      }).success,
    ).toBe(false);
  });
});
