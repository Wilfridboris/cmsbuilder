import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormRow, SchemaDefinition } from "@/types/db";
import type { FormMutateIdentity } from "@/lib/data/form-mutate";

/**
 * Guarded-write coverage for the per-field config save (Epic 14, Story 14.5). Mocks the
 * form read (`getFormById`) and schema read (`getSchema`) so the test asserts
 * `updateFormFieldConfig`'s OWN contract from the frozen I/O & Edge-Case Matrix:
 *   - valid write           -> persists filtered field_config, bumps actor_id/updated_at,
 *                              returns { id, slug };
 *   - relation-key rejected -> an entry naming a relation field is filtered out (FR78);
 *   - stale-key filtered    -> an entry naming a non-field of the target table is dropped;
 *   - 404 unknown/cross-org -> 404 notFound, before the schema read or any write;
 *   - published is allowed  -> no lock (unlike slug/target): the write proceeds.
 */

const { getFormById, getSchema } = vi.hoisted(() => ({
  getFormById: vi.fn(),
  getSchema: vi.fn(),
}));

vi.mock("@/lib/data/forms", () => ({ getFormById }));
vi.mock("@/lib/data/records", () => ({ getSchema }));

import { updateFormFieldConfig } from "@/lib/data/form-mutate";

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

/** `leads` has two scalar fields and one relation field (never storable, FR78). */
function schema(): SchemaDefinition {
  return {
    tables: [
      {
        key: "leads",
        label: "Leads",
        fields: [
          { key: "name", label: "Name", type: "text" },
          { key: "email", label: "Email", type: "email" },
          {
            key: "owner",
            label: "Owner",
            type: "relation",
            relationConfig: { targetTable: "clients", cardinality: "one" },
          },
        ],
      },
    ],
  } as SchemaDefinition;
}

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

describe("updateFormFieldConfig — valid write", () => {
  it("persists the filtered config + bumps actor_id/updated_at, returns { id, slug }", async () => {
    getFormById.mockResolvedValue(form({}));
    getSchema.mockResolvedValue({ data: schema(), error: null });
    const { client, updateCalls } = clientStub({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });

    const result = await updateFormFieldConfig(identity(client), {
      formId: "f1",
      fieldConfig: [
        { key: "name", included: true, label: "Full name", order: 0 },
        { key: "email", included: false, order: 1 },
      ],
    });

    expect(result).toEqual({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({
      field_config: [
        { key: "name", included: true, label: "Full name", order: 0 },
        { key: "email", included: false, order: 1 },
      ],
      actor_id: "user-1",
    });
    expect(updateCalls[0]).toHaveProperty("updated_at", expect.any(String));
  });
});

describe("updateFormFieldConfig — filtering (FR78 + drop-stale)", () => {
  it("drops an entry whose key is a RELATION field of the target table (FR78)", async () => {
    getFormById.mockResolvedValue(form({}));
    getSchema.mockResolvedValue({ data: schema(), error: null });
    const { client, updateCalls } = clientStub({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });

    await updateFormFieldConfig(identity(client), {
      formId: "f1",
      fieldConfig: [
        { key: "name", included: true, order: 0 },
        { key: "owner", included: true, label: "Owner", order: 1 },
      ],
    });

    expect(updateCalls).toHaveLength(1);
    const written = (updateCalls[0] as { field_config: { key: string }[] })
      .field_config;
    expect(written.map((e) => e.key)).toEqual(["name"]);
  });

  it("drops a stale key not present in the target table", async () => {
    getFormById.mockResolvedValue(form({}));
    getSchema.mockResolvedValue({ data: schema(), error: null });
    const { client, updateCalls } = clientStub({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });

    await updateFormFieldConfig(identity(client), {
      formId: "f1",
      fieldConfig: [
        { key: "name", order: 0 },
        { key: "ghost", included: true, order: 1 },
      ],
    });

    const written = (updateCalls[0] as { field_config: { key: string }[] })
      .field_config;
    expect(written.map((e) => e.key)).toEqual(["name"]);
  });
});

describe("updateFormFieldConfig — guards", () => {
  it("404s an unknown / cross-org form id before the schema read or any write", async () => {
    getFormById.mockResolvedValue(null);
    const { client, updateCalls } = clientStub({ data: null, error: null });

    await expect(
      updateFormFieldConfig(identity(client), {
        formId: "nope",
        fieldConfig: [{ key: "name", included: true, order: 0 }],
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      userMessage: "Forms.error.notFound",
    });
    expect(getSchema).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("is NOT locked while published: the write proceeds (unlike slug/target)", async () => {
    getFormById.mockResolvedValue(form({ published: true }));
    getSchema.mockResolvedValue({ data: schema(), error: null });
    const { client, updateCalls } = clientStub({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });

    const result = await updateFormFieldConfig(identity(client), {
      formId: "f1",
      fieldConfig: [{ key: "name", included: true, order: 0 }],
    });

    expect(result.error).toBeNull();
    expect(updateCalls).toHaveLength(1);
  });
});
