import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { SchemaDefinition } from "@/types/db";

/**
 * Unit coverage for the guarded schema-visibility write layer (Story 3.5),
 * mirroring `mutate.test.ts`: a fake Supabase client + a stubbed `getSchema`
 * stand in for the DB so we can assert the layer's contract without a live
 * connection —
 *   - a body naming an unknown table/field → 400 with NO write (never trust a
 *     client-supplied identifier);
 *   - a successful hide/show → the re-derived full definition is written with
 *     ONLY the target field's `hidden` flag changed, scoped to organization_id;
 *   - a read failure → 500 writeFailed, no write;
 *   - a DB write error → 500 writeFailed with the raw message never leaked.
 */

const getSchema = vi.fn();
vi.mock("@/lib/data/records", () => ({ getSchema }));

// Imported AFTER the mock so the layer picks up the stubbed getSchema.
const { setFieldVisibility, addRelationField, addField } = await import(
  "@/lib/data/schema-mutate"
);

function baseSchema(): SchemaDefinition {
  return {
    tables: [
      {
        key: "clients",
        label: "Clients",
        fields: [
          { key: "name", label: "Name", type: "text" },
          { key: "email", label: "Email", type: "email" },
        ],
      },
    ],
  };
}

function twoTableSchema(): SchemaDefinition {
  return {
    tables: [
      {
        key: "clients",
        label: "Clients",
        fields: [{ key: "name", label: "Name", type: "text" }],
      },
      {
        key: "jobs",
        label: "Jobs",
        fields: [{ key: "service", label: "Service", type: "text" }],
      },
    ],
  };
}

// Fake client capturing the org_schemas UPDATE chain:
//   client.from("org_schemas").update(payload).eq("organization_id", orgId)
let updatePayload: Record<string, unknown> | null;
let eqArgs: unknown[];
let dbError: { message: string } | null;
const updateSpy = vi.fn((payload: Record<string, unknown>) => {
  updatePayload = payload;
  return {
    eq: (...args: unknown[]) => {
      eqArgs = args;
      return Promise.resolve({ error: dbError });
    },
  };
});

function makeClient(): SupabaseClient {
  return {
    from(table: string) {
      if (table !== "org_schemas") {
        throw new Error(`unexpected table: ${table}`);
      }
      return { update: updateSpy };
    },
  } as unknown as SupabaseClient;
}

function identity() {
  return { client: makeClient(), actorId: "user-1", orgId: "org-1" };
}

beforeEach(() => {
  vi.clearAllMocks();
  updatePayload = null;
  eqArgs = [];
  dbError = null;
  getSchema.mockResolvedValue({ data: baseSchema(), error: null });
});

describe("setFieldVisibility", () => {
  it("hides a field: writes the re-derived definition with only that field's hidden flag set, scoped to the org", async () => {
    const res = await setFieldVisibility(identity(), "clients", "email", true);

    expect(res.error).toBeNull();
    expect(res.data).toEqual({
      tableKey: "clients",
      fieldKey: "email",
      hidden: true,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(eqArgs).toEqual(["organization_id", "org-1"]);

    const def = updatePayload?.definition as SchemaDefinition;
    const fields = def.tables[0].fields;
    // Only the target field flipped; the sibling field is untouched.
    expect(fields.find((f) => f.key === "email")?.hidden).toBe(true);
    expect(fields.find((f) => f.key === "name")?.hidden).toBeUndefined();
    // The definition is re-derived from the stored schema, not client-supplied.
    expect(def.tables[0].key).toBe("clients");
    expect(updatePayload).toHaveProperty("updated_at");
  });

  it("unhides a field: sets hidden false on the target", async () => {
    const hidden = baseSchema();
    hidden.tables[0].fields[1].hidden = true;
    getSchema.mockResolvedValue({ data: hidden, error: null });

    const res = await setFieldVisibility(identity(), "clients", "email", false);

    expect(res.data).toEqual({
      tableKey: "clients",
      fieldKey: "email",
      hidden: false,
    });
    const def = updatePayload?.definition as SchemaDefinition;
    expect(def.tables[0].fields.find((f) => f.key === "email")?.hidden).toBe(
      false,
    );
  });

  it("400 genericError with NO write when the field is unknown", async () => {
    await expect(
      setFieldVisibility(identity(), "clients", "nope", true),
    ).rejects.toMatchObject({ statusCode: 400, userMessage: "genericError" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("400 genericError with NO write when the table is unknown", async () => {
    await expect(
      setFieldVisibility(identity(), "nope", "email", true),
    ).rejects.toMatchObject({ statusCode: 400, userMessage: "genericError" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("500 writeFailed with NO write when the schema read fails", async () => {
    getSchema.mockResolvedValue({ data: null, error: "read boom" });

    await expect(
      setFieldVisibility(identity(), "clients", "email", true),
    ).rejects.toMatchObject({ statusCode: 500, userMessage: "writeFailed" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("500 writeFailed when the UPDATE errors, never leaking the raw message", async () => {
    dbError = { message: "duplicate key value boom" };

    const err = await setFieldVisibility(
      identity(),
      "clients",
      "email",
      true,
    ).catch((e: unknown) => e);

    expect(err).toMatchObject({ statusCode: 500, userMessage: "writeFailed" });
    expect((err as { userMessage: string }).userMessage).not.toContain("boom");
  });
});

describe("addRelationField (Story 3.7)", () => {
  it("appends a validated relation field and writes the re-derived definition scoped to the org", async () => {
    getSchema.mockResolvedValue({ data: twoTableSchema(), error: null });

    const res = await addRelationField(identity(), "jobs", {
      label: "Client",
      targetTable: "clients",
    });

    expect(res.error).toBeNull();
    expect(res.data).toEqual({
      tableKey: "jobs",
      fieldKey: "client",
      targetTable: "clients",
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(eqArgs).toEqual(["organization_id", "org-1"]);

    const def = updatePayload?.definition as SchemaDefinition;
    const jobs = def.tables.find((t) => t.key === "jobs");
    const added = jobs?.fields.find((f) => f.key === "client");
    expect(added).toMatchObject({
      key: "client",
      type: "relation",
      relationConfig: { targetTable: "clients", cardinality: "one" },
    });
    // The referenced table is untouched — a re-derived definition, not client input.
    expect(def.tables.find((t) => t.key === "clients")?.fields).toHaveLength(1);
  });

  it("400 addFieldFailed with NO write when the target table is unknown", async () => {
    getSchema.mockResolvedValue({ data: twoTableSchema(), error: null });

    await expect(
      addRelationField(identity(), "jobs", {
        label: "Vendor",
        targetTable: "vendors",
      }),
    ).rejects.toMatchObject({ statusCode: 400, userMessage: "addFieldFailed" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("400 addFieldFailed with NO write when the derived key collides", async () => {
    getSchema.mockResolvedValue({ data: twoTableSchema(), error: null });

    await expect(
      addRelationField(identity(), "jobs", {
        label: "Service", // normalizes to the existing "service" key
        targetTable: "clients",
      }),
    ).rejects.toMatchObject({ statusCode: 400, userMessage: "addFieldFailed" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("500 writeFailed with NO write when the schema read fails", async () => {
    getSchema.mockResolvedValue({ data: null, error: "read boom" });

    await expect(
      addRelationField(identity(), "jobs", {
        label: "Client",
        targetTable: "clients",
      }),
    ).rejects.toMatchObject({ statusCode: 500, userMessage: "writeFailed" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("500 writeFailed when the UPDATE errors, never leaking the raw message", async () => {
    getSchema.mockResolvedValue({ data: twoTableSchema(), error: null });
    dbError = { message: "constraint boom" };

    const err = await addRelationField(identity(), "jobs", {
      label: "Client",
      targetTable: "clients",
    }).catch((e: unknown) => e);

    expect(err).toMatchObject({ statusCode: 500, userMessage: "writeFailed" });
    expect((err as { userMessage: string }).userMessage).not.toContain("boom");
  });
});

describe("addField (Story 5.1)", () => {
  it("appends a validated scalar field and writes the re-derived definition scoped to the org", async () => {
    getSchema.mockResolvedValue({ data: twoTableSchema(), error: null });

    const res = await addField(identity(), "jobs", {
      label: "Warranty date",
      type: "date",
    });

    expect(res.error).toBeNull();
    expect(res.data).toEqual({ tableKey: "jobs", fieldKey: "warranty_date" });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    // The UPDATE is scoped to the caller's own org (tenant isolation).
    expect(eqArgs).toEqual(["organization_id", "org-1"]);

    const def = updatePayload?.definition as SchemaDefinition;
    const jobs = def.tables.find((t) => t.key === "jobs");
    expect(jobs?.fields.map((f) => f.key)).toEqual(["service", "warranty_date"]);
    expect(jobs?.fields.find((f) => f.key === "warranty_date")).toEqual({
      key: "warranty_date",
      label: "Warranty date",
      type: "date",
    });
    // Other tables are untouched — a re-derived definition, not client input.
    expect(def.tables.find((t) => t.key === "clients")?.fields).toHaveLength(1);
    expect(updatePayload).toHaveProperty("updated_at");
  });

  it("400 addFieldFailed with NO write when the target table is unknown", async () => {
    getSchema.mockResolvedValue({ data: twoTableSchema(), error: null });

    await expect(
      addField(identity(), "vendors", { label: "Rating", type: "number" }),
    ).rejects.toMatchObject({ statusCode: 400, userMessage: "addFieldFailed" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("400 addFieldFailed with NO write when the derived key collides with an existing field", async () => {
    getSchema.mockResolvedValue({ data: twoTableSchema(), error: null });

    await expect(
      addField(identity(), "jobs", { label: "Service", type: "text" }),
    ).rejects.toMatchObject({ statusCode: 400, userMessage: "addFieldFailed" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("400 addFieldFailed with NO write for a non-scalar (relation) type", async () => {
    getSchema.mockResolvedValue({ data: twoTableSchema(), error: null });

    await expect(
      addField(identity(), "jobs", { label: "Client", type: "relation" }),
    ).rejects.toMatchObject({ statusCode: 400, userMessage: "addFieldFailed" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("500 writeFailed with NO write when the schema read fails", async () => {
    getSchema.mockResolvedValue({ data: null, error: "read boom" });

    await expect(
      addField(identity(), "jobs", { label: "Warranty date", type: "date" }),
    ).rejects.toMatchObject({ statusCode: 500, userMessage: "writeFailed" });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("500 writeFailed when the UPDATE errors, never leaking the raw message", async () => {
    getSchema.mockResolvedValue({ data: twoTableSchema(), error: null });
    dbError = { message: "constraint boom" };

    const err = await addField(identity(), "jobs", {
      label: "Warranty date",
      type: "date",
    }).catch((e: unknown) => e);

    expect(err).toMatchObject({ statusCode: 500, userMessage: "writeFailed" });
    expect((err as { userMessage: string }).userMessage).not.toContain("boom");
  });
});
