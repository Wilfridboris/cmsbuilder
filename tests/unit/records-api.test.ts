import { describe, expect, it } from "vitest";

import {
  createBodySchema,
  deleteQuerySchema,
  listQuerySchema,
} from "@/app/api/records/schemas";

/**
 * Pure schema-shape coverage for the `/api/records` route validators (Story 3.2)
 * — no HTTP harness, no live DB/auth. Asserts the Zod schemas accept well-formed
 * shapes and reject the malformed ones the routes must 400 on (missing/blank
 * slug/table, wrong `data` type, missing idempotency key, a non-numeric or
 * negative `expectedVersion`).
 */

describe("createBodySchema (POST /api/records)", () => {
  it("accepts a well-formed create body", () => {
    const parsed = createBodySchema.safeParse({
      slug: "mikes-plumbing",
      table: "clients",
      data: { name: "Ada", amount: 12 },
      idempotencyKey: "abc-123",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an empty data object (all fields blank/omitted)", () => {
    expect(
      createBodySchema.safeParse({
        slug: "s",
        table: "t",
        data: {},
        idempotencyKey: "k",
      }).success,
    ).toBe(true);
  });

  it("rejects a blank slug or table", () => {
    expect(
      createBodySchema.safeParse({
        slug: "",
        table: "t",
        data: {},
        idempotencyKey: "k",
      }).success,
    ).toBe(false);
    expect(
      createBodySchema.safeParse({
        slug: "s",
        table: "   ",
        data: {},
        idempotencyKey: "k",
      }).success,
    ).toBe(false);
  });

  it("rejects a missing idempotency key and a non-object data", () => {
    expect(
      createBodySchema.safeParse({ slug: "s", table: "t", data: {} }).success,
    ).toBe(false);
    expect(
      createBodySchema.safeParse({
        slug: "s",
        table: "t",
        data: "not-an-object",
        idempotencyKey: "k",
      }).success,
    ).toBe(false);
  });
});

describe("listQuerySchema (GET /api/records)", () => {
  it("accepts a slug + table pair", () => {
    expect(listQuerySchema.safeParse({ slug: "s", table: "t" }).success).toBe(
      true,
    );
  });

  it("rejects a missing/blank slug or table", () => {
    expect(listQuerySchema.safeParse({ slug: "s" }).success).toBe(false);
    expect(listQuerySchema.safeParse({ slug: "", table: "t" }).success).toBe(
      false,
    );
    expect(listQuerySchema.safeParse({ slug: "s", table: null }).success).toBe(
      false,
    );
  });

  it("defaults rel to an empty list when absent (Story 3.8)", () => {
    const parsed = listQuerySchema.safeParse({ slug: "s", table: "t" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.rel).toEqual([]);
  });

  it("parses repeatable `field:id` rel params into relation filters", () => {
    const parsed = listQuerySchema.safeParse({
      slug: "s",
      table: "jobs",
      rel: ["client:c1", "lead:u9"],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rel).toEqual([
        { field: "client", targetId: "c1" },
        { field: "lead", targetId: "u9" },
      ]);
    }
  });

  it("splits on the first colon so a colon in the id survives", () => {
    const parsed = listQuerySchema.safeParse({
      slug: "s",
      table: "jobs",
      rel: ["client:a:b"],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rel).toEqual([{ field: "client", targetId: "a:b" }]);
    }
  });

  it("rejects a malformed rel param (no colon, empty field, or empty id)", () => {
    expect(
      listQuerySchema.safeParse({ slug: "s", table: "t", rel: ["nocolon"] })
        .success,
    ).toBe(false);
    expect(
      listQuerySchema.safeParse({ slug: "s", table: "t", rel: [":c1"] }).success,
    ).toBe(false);
    expect(
      listQuerySchema.safeParse({ slug: "s", table: "t", rel: ["client:"] })
        .success,
    ).toBe(false);
  });
});

describe("deleteQuerySchema (DELETE /api/records/[id])", () => {
  it("accepts a slug + numeric-string expectedVersion (coerced)", () => {
    const parsed = deleteQuerySchema.safeParse({
      slug: "s",
      expectedVersion: "3",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.expectedVersion).toBe(3);
    }
  });

  it("accepts version 0", () => {
    expect(
      deleteQuerySchema.safeParse({ slug: "s", expectedVersion: "0" }).success,
    ).toBe(true);
  });

  it("rejects a non-numeric, negative, or missing expectedVersion", () => {
    expect(
      deleteQuerySchema.safeParse({ slug: "s", expectedVersion: "abc" }).success,
    ).toBe(false);
    expect(
      deleteQuerySchema.safeParse({ slug: "s", expectedVersion: "-1" }).success,
    ).toBe(false);
    expect(deleteQuerySchema.safeParse({ slug: "s" }).success).toBe(false);
  });

  it("rejects a blank slug", () => {
    expect(
      deleteQuerySchema.safeParse({ slug: "", expectedVersion: "1" }).success,
    ).toBe(false);
  });
});
