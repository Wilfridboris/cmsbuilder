import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormRow } from "@/types/db";
import type { FormMutateIdentity } from "@/lib/data/form-mutate";

/**
 * Guarded-write coverage for the intro-text save (Epic 14, Story 14.6). Mocks the form read
 * (`getFormById`) so the test asserts `updateFormIntroText`'s OWN contract from the frozen
 * I/O & Edge-Case Matrix:
 *   - valid write        -> persists trimmed intro_text + bumps actor_id/updated_at, returns
 *                           { id, slug };
 *   - blank -> null      -> a whitespace-only value is stored as null (clears the intro);
 *   - 404 unknown id     -> 404 notFound, before any write;
 *   - writes while published -> NO lock (intro never changes where responses land).
 *
 * The >500-char rejection is enforced by the route's zod schema (`introTextBodySchema`),
 * covered in `forms-route.test.ts`; the mutator itself does not re-check length.
 *
 * The Supabase client is a thin chainable stub that records whether a write ran and the
 * payload it carried.
 */

const { getFormById } = vi.hoisted(() => ({
  getFormById: vi.fn(),
}));

vi.mock("@/lib/data/forms", () => ({ getFormById }));
// Pulled in by form-mutate's module graph; stub to keep this a pure unit.
vi.mock("@/lib/data/records", () => ({ getSchema: vi.fn() }));

import { updateFormIntroText } from "@/lib/data/form-mutate";

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
 * happened on a blocked path and inspect the written intro_text.
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

describe("updateFormIntroText — valid write", () => {
  it("persists the trimmed intro + bumps actor_id/updated_at, returns { id, slug }", async () => {
    getFormById.mockResolvedValue(form({}));
    const { client, updateCalls } = clientStub({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });

    const result = await updateFormIntroText(identity(client), {
      formId: "f1",
      introText: "  Welcome to our intake form.  ",
    });

    expect(result).toEqual({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({
      intro_text: "Welcome to our intake form.",
      actor_id: "user-1",
    });
    expect(updateCalls[0]).toHaveProperty("updated_at", expect.any(String));
  });

  it("stores null when the value is blank/whitespace (clears the intro)", async () => {
    getFormById.mockResolvedValue(form({ intro_text: "old text" }));
    const { client, updateCalls } = clientStub({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });

    await updateFormIntroText(identity(client), {
      formId: "f1",
      introText: "   ",
    });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({ intro_text: null });
  });

  it("writes even while the form is PUBLISHED (no lock — intro never moves responses)", async () => {
    getFormById.mockResolvedValue(form({ published: true }));
    const { client, updateCalls } = clientStub({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });

    const result = await updateFormIntroText(identity(client), {
      formId: "f1",
      introText: "Published intro",
    });

    expect(result.error).toBeNull();
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({ intro_text: "Published intro" });
  });
});

describe("updateFormIntroText — rejections", () => {
  it("404s an unknown / cross-org form id before any write", async () => {
    getFormById.mockResolvedValue(null);
    const { client, updateCalls } = clientStub({ data: null, error: null });

    await expect(
      updateFormIntroText(identity(client), {
        formId: "nope",
        introText: "hi",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      userMessage: "Forms.error.notFound",
    });
    expect(updateCalls).toHaveLength(0);
  });

  it("404s when the row vanishes between the read and the write (RLS-hidden)", async () => {
    getFormById.mockResolvedValue(form({}));
    const { client, updateCalls } = clientStub({ data: null, error: null });

    await expect(
      updateFormIntroText(identity(client), {
        formId: "f1",
        introText: "hi",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      userMessage: "Forms.error.notFound",
    });
    // The write WAS attempted (the read passed), but returned no row.
    expect(updateCalls).toHaveLength(1);
  });
});
