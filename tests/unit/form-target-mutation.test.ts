import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormRow, SchemaDefinition } from "@/types/db";
import type { FormMutateIdentity } from "@/lib/data/form-mutate";

/**
 * Guarded-write coverage for the target-table choice (Epic 14, Story 14.4). Mocks the
 * form read (`getFormById`) and the schema read (`getSchema`) so the test asserts
 * `updateFormTarget`'s OWN contract from the frozen I/O & Edge-Case Matrix:
 *   - change to a visible table   -> persists target_table_key + filtered field_config,
 *                                    bumps actor_id + updated_at, returns { id, slug };
 *   - field_config drop-stale     -> entries whose key is not a field of the NEW table are
 *                                    dropped; matching entries preserved;
 *   - non-visible / unknown key   -> 400 targetInvalid, NO write;
 *   - 404 unknown / cross-org id  -> 404 notFound, before the schema read or any write;
 *   - published form              -> 409 targetLocked, BEFORE validating the new key, NO
 *                                    write (and the schema is never read).
 *
 * The Supabase client is a thin chainable stub that records whether a write ran and the
 * payload it carried.
 */

const { getFormById, getSchema } = vi.hoisted(() => ({
  getFormById: vi.fn(),
  getSchema: vi.fn(),
}));

vi.mock("@/lib/data/forms", () => ({ getFormById }));
vi.mock("@/lib/data/records", () => ({ getSchema }));

import { updateFormTarget } from "@/lib/data/form-mutate";

function form(partial: Partial<FormRow>): FormRow {
  return {
    id: "f1",
    organization_id: "org-1",
    title: "Job Request",
    slug: "job-request",
    target_table_key: "leads",
    published: false,
    intro_text: null,
    field_config: [],
    actor_id: null,
    created_at: "2026-10-04T00:00:00Z",
    updated_at: "2026-10-04T00:00:00Z",
    ...partial,
  };
}

/** A schema with two visible tables and one hidden table, for the visibility check. */
function schema(): SchemaDefinition {
  return {
    tables: [
      {
        key: "leads",
        label: "Leads",
        fields: [
          { key: "name", label: "Name", type: "text" },
          { key: "email", label: "Email", type: "email" },
        ],
      },
      {
        key: "clients",
        label: "Clients",
        fields: [
          { key: "company", label: "Company", type: "text" },
          { key: "phone", label: "Phone", type: "phone" },
        ],
      },
      {
        key: "archive",
        label: "Archive",
        hidden: true,
        fields: [{ key: "note", label: "Note", type: "text" }],
      },
    ],
  } as SchemaDefinition;
}

/**
 * A chainable Supabase stub. `update(...).eq(...).eq(...).select(...).maybeSingle()`
 * resolves to `result`; `updateCalls` records the payload so a test can assert NO write
 * happened on a blocked path and inspect the written field_config.
 */
function clientStub(result: { data: unknown; error: unknown }) {
  const updateCalls: Record<string, unknown>[] = [];
  const chain = {
    update(payload: Record<string, unknown>) {
      updateCalls.push(payload);
      return chain;
    },
    eq() {
      return chain;
    },
    select() {
      return chain;
    },
    async maybeSingle() {
      return result;
    },
  };
  const client = {
    from() {
      return chain;
    },
  } as unknown as SupabaseClient;
  return { client, updateCalls };
}

function identity(client: SupabaseClient): FormMutateIdentity {
  return { client, actorId: "user-1", orgId: "org-1" };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateFormTarget — change to a visible table", () => {
  it("persists the new target + bumps actor_id/updated_at, returns { id, slug }", async () => {
    getFormById.mockResolvedValue(form({ target_table_key: "leads" }));
    getSchema.mockResolvedValue({ data: schema(), error: null });
    const { client, updateCalls } = clientStub({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });

    const result = await updateFormTarget(identity(client), {
      formId: "f1",
      targetTableKey: "clients",
    });

    expect(result).toEqual({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({
      target_table_key: "clients",
      actor_id: "user-1",
    });
    expect(updateCalls[0]).toHaveProperty("updated_at", expect.any(String));
  });

  it("drops field_config entries not present in the new table, preserving matching ones", async () => {
    // field_config references `company` (a `clients` field) and `name` (a `leads` field).
    // Moving the target to `clients` must drop `name` and keep `company`.
    getFormById.mockResolvedValue(
      form({
        target_table_key: "leads",
        field_config: [
          { key: "company", label: "Co." },
          { key: "name", label: "Full name" },
        ],
      }),
    );
    getSchema.mockResolvedValue({ data: schema(), error: null });
    const { client, updateCalls } = clientStub({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });

    await updateFormTarget(identity(client), {
      formId: "f1",
      targetTableKey: "clients",
    });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({
      target_table_key: "clients",
      field_config: [{ key: "company", label: "Co." }],
    });
  });
});

describe("updateFormTarget — rejections", () => {
  it("rejects a non-visible (hidden) target with 400 targetInvalid and NO write", async () => {
    getFormById.mockResolvedValue(form({ published: false }));
    getSchema.mockResolvedValue({ data: schema(), error: null });
    const { client, updateCalls } = clientStub({ data: null, error: null });

    await expect(
      updateFormTarget(identity(client), {
        formId: "f1",
        targetTableKey: "archive", // hidden table
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      userMessage: "Forms.error.targetInvalid",
    });
    expect(updateCalls).toHaveLength(0);
  });

  it("rejects an unknown / cross-org target key with 400 targetInvalid and NO write", async () => {
    getFormById.mockResolvedValue(form({ published: false }));
    getSchema.mockResolvedValue({ data: schema(), error: null });
    const { client, updateCalls } = clientStub({ data: null, error: null });

    await expect(
      updateFormTarget(identity(client), {
        formId: "f1",
        targetTableKey: "does-not-exist",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      userMessage: "Forms.error.targetInvalid",
    });
    expect(updateCalls).toHaveLength(0);
  });

  it("404s an unknown / cross-org form id before the schema read or any write", async () => {
    getFormById.mockResolvedValue(null);
    const { client, updateCalls } = clientStub({ data: null, error: null });

    await expect(
      updateFormTarget(identity(client), {
        formId: "nope",
        targetTableKey: "leads",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      userMessage: "Forms.error.notFound",
    });
    expect(getSchema).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("rejects a target change on a PUBLISHED form with 409 targetLocked, before validating the key and with NO schema read or write", async () => {
    getFormById.mockResolvedValue(form({ published: true }));
    const { client, updateCalls } = clientStub({ data: null, error: null });

    await expect(
      updateFormTarget(identity(client), {
        formId: "f1",
        targetTableKey: "clients",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      userMessage: "Forms.error.targetLocked",
    });
    // The lock is checked BEFORE validating the new key: the schema is never read.
    expect(getSchema).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("fails closed (400 targetInvalid) when the schema cannot be read", async () => {
    getFormById.mockResolvedValue(form({ published: false }));
    getSchema.mockResolvedValue({ data: null, error: "boom" });
    const { client, updateCalls } = clientStub({ data: null, error: null });

    await expect(
      updateFormTarget(identity(client), {
        formId: "f1",
        targetTableKey: "clients",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      userMessage: "Forms.error.targetInvalid",
    });
    expect(updateCalls).toHaveLength(0);
  });
});
