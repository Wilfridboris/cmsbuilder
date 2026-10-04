import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import type { FormRow } from "@/types/db";
import type { FormMutateIdentity } from "@/lib/data/form-mutate";

/**
 * Guarded-write coverage for the publish mutation + slug lock (Epic 14, Story 14.3).
 * Mocks the form read (`getFormById`) and the publish gate
 * (`evaluateFormPublishability`) so the test asserts the mutation's OWN contract: the
 * publish gate is re-evaluated server-side (blocked -> 409 publishBlocked, NO write),
 * unpublishing is always allowed, a slug edit on a published form is rejected
 * (409 slugLocked, before normalization), and an unknown id is a 404.
 *
 * The Supabase client is a thin chainable stub that records whether a write ran.
 */

const { getFormById, evaluateFormPublishability } = vi.hoisted(() => ({
  getFormById: vi.fn(),
  evaluateFormPublishability: vi.fn(),
}));

vi.mock("@/lib/data/forms", () => ({ getFormById }));
vi.mock("@/lib/forms/publishability", () => ({ evaluateFormPublishability }));

import { publishForm, updateFormSlug } from "@/lib/data/form-mutate";

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

/**
 * A chainable Supabase stub. `update(...).eq(...).eq(...).select(...).maybeSingle()`
 * resolves to `result`; `updateCalls` records the payload so a test can assert NO write
 * happened on a blocked path.
 */
function clientStub(result: { data: unknown; error: unknown }) {
  const updateCalls: unknown[] = [];
  const chain = {
    update(payload: unknown) {
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

describe("publishForm — publish gate", () => {
  it("publishes a form with a valid target (gate ok), bumping actor_id + published", async () => {
    getFormById.mockResolvedValue(form({ published: false }));
    evaluateFormPublishability.mockResolvedValue({
      publishable: true,
      reason: "ok",
    });
    const { client, updateCalls } = clientStub({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });

    const result = await publishForm(identity(client), {
      formId: "f1",
      published: true,
    });

    expect(result).toEqual({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({ published: true, actor_id: "user-1" });
    // Parity with renameForm: the write bumps updated_at.
    expect(updateCalls[0]).toHaveProperty("updated_at", expect.any(String));
  });

  it("rejects a blocked publish with 409 publishBlocked and NO write", async () => {
    getFormById.mockResolvedValue(form({ published: false }));
    evaluateFormPublishability.mockResolvedValue({
      publishable: false,
      reason: "no-target",
    });
    const { client, updateCalls } = clientStub({ data: null, error: null });

    await expect(
      publishForm(identity(client), { formId: "f1", published: true }),
    ).rejects.toMatchObject({
      statusCode: 409,
      userMessage: "Forms.error.publishBlocked",
    });
    expect(updateCalls).toHaveLength(0);
  });

  it("allows unpublishing without consulting the gate", async () => {
    getFormById.mockResolvedValue(form({ published: true }));
    const { client, updateCalls } = clientStub({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });

    const result = await publishForm(identity(client), {
      formId: "f1",
      published: false,
    });

    expect(result.error).toBeNull();
    expect(evaluateFormPublishability).not.toHaveBeenCalled();
    expect(updateCalls[0]).toMatchObject({ published: false });
  });

  it("404s an unknown / cross-org form id before any gate or write", async () => {
    getFormById.mockResolvedValue(null);
    const { client, updateCalls } = clientStub({ data: null, error: null });

    await expect(
      publishForm(identity(client), { formId: "nope", published: true }),
    ).rejects.toMatchObject({
      statusCode: 404,
      userMessage: "Forms.error.notFound",
    });
    expect(evaluateFormPublishability).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });
});

describe("updateFormSlug — slug lock on a published form", () => {
  it("rejects a slug edit on a published form with 409 slugLocked and NO write", async () => {
    getFormById.mockResolvedValue(form({ published: true }));
    const { client, updateCalls } = clientStub({ data: null, error: null });

    await expect(
      updateFormSlug(identity(client), { formId: "f1", slug: "new-slug" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      userMessage: "Forms.error.slugLocked",
    });
    expect(updateCalls).toHaveLength(0);
  });
});

describe("AppError shape", () => {
  it("publishBlocked is a 409 AppError (not a leaked internal)", () => {
    const err = new AppError(409, "Forms.error.publishBlocked");
    expect(err.statusCode).toBe(409);
    expect(err.userMessage).toBe("Forms.error.publishBlocked");
  });
});
