import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/types/api";

/**
 * Unit coverage for the guarded Forms write layer (Epic 14, Story 14.1), mirroring
 * `business-profile-mutate.test.ts`: a fake Supabase client stands in for the DB and the
 * slug/schema seams are stubbed, so we pin the mutator's ORCHESTRATION + error mapping
 * without a live connection. It locks the frozen I/O & Edge-Case Matrix rows that live in
 * the mutator (the pure slug suffixing/org-scoping rows are covered by `form-slug.test.ts`):
 *   - create happy path   → inserts title/slug/target_table_key/actor_id ONLY (published,
 *                           field_config left to their DB defaults) and returns { id, slug };
 *   - heuristic → null     → target_table_key is null when no intake table is selected;
 *   - blank title          → 400 Forms.error.titleRequired, no write (create + rename);
 *   - slug valid           → slug updated, returns { id, slug };
 *   - slug taken           → 409 Forms.error.slugTaken, no write;
 *   - slug normalize-empty → 400 Forms.error.slugInvalid, no write;
 *   - rename               → title updated, slug untouched;
 *   - delete               → row removed, returns { id };
 *   - cross-org/unknown id → 404 Forms.error.notFound (rename/slug/delete).
 *
 * `getSchema` + `selectIntakeTable` (target pre-fill) and `deriveFormSlug` +
 * `ensureUniqueFormSlug` + `getFormById` (slug/existence seams, each separately tested)
 * are mocked; the REAL `kebabCase` runs so `slugInvalid` normalize-to-empty is exercised.
 */

const { getSchema } = vi.hoisted(() => ({ getSchema: vi.fn() }));
const { selectIntakeTable } = vi.hoisted(() => ({ selectIntakeTable: vi.fn() }));
const { getFormById } = vi.hoisted(() => ({ getFormById: vi.fn() }));
const { deriveFormSlug } = vi.hoisted(() => ({ deriveFormSlug: vi.fn() }));
const { ensureUniqueFormSlug } = vi.hoisted(() => ({
  ensureUniqueFormSlug: vi.fn(),
}));

vi.mock("@/lib/data/records", () => ({ getSchema }));
vi.mock("@/lib/intake/target", () => ({ selectIntakeTable }));
vi.mock("@/lib/data/forms", () => ({ getFormById }));
vi.mock("@/lib/forms/form-slug", () => ({ deriveFormSlug, ensureUniqueFormSlug }));

import {
  createForm,
  renameForm,
  updateFormSlug,
  deleteForm,
} from "@/lib/data/form-mutate";

// Captured write chains + their configurable results.
const insertSpy = vi.fn();
const updateSpy = vi.fn();
const deleteSpy = vi.fn();

let insertResult: { data: unknown; error: unknown };
let updateResult: { data: unknown; error: unknown };
let deleteResult: { data: unknown; error: unknown };

function makeClient(): SupabaseClient {
  return {
    from(table: string) {
      if (table !== "forms") {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        insert(payload: unknown) {
          insertSpy(payload);
          return { select: () => ({ single: async () => insertResult }) };
        },
        update(payload: unknown) {
          updateSpy(payload);
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({ maybeSingle: async () => updateResult }),
              }),
            }),
          };
        },
        delete() {
          deleteSpy();
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({ maybeSingle: async () => deleteResult }),
              }),
            }),
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

function identity() {
  return { client: makeClient(), actorId: "user-1", orgId: "org-1" };
}

beforeEach(() => {
  vi.clearAllMocks();
  insertResult = { data: { id: "f1", slug: "job-request" }, error: null };
  updateResult = { data: { id: "f1", slug: "job-request" }, error: null };
  deleteResult = { data: { id: "f1" }, error: null };
  getSchema.mockResolvedValue({ data: { tables: [] }, error: null });
  selectIntakeTable.mockReturnValue({ key: "jobs" });
  deriveFormSlug.mockReturnValue("job-request");
  ensureUniqueFormSlug.mockResolvedValue("job-request");
  getFormById.mockResolvedValue({ id: "f1", slug: "job-request" });
});

describe("createForm", () => {
  it("pre-fills target_table_key from the heuristic, omits published/field_config, returns { id, slug }", async () => {
    const res = await createForm(identity(), { title: "Job Request" });

    expect(res.error).toBeNull();
    expect(res.data).toEqual({ id: "f1", slug: "job-request" });
    expect(insertSpy).toHaveBeenCalledTimes(1);

    const payload = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    // Exactly the wired columns — published/intro_text/field_config fall to DB defaults.
    expect(payload).toEqual({
      organization_id: "org-1",
      title: "Job Request",
      slug: "job-request",
      target_table_key: "jobs",
      actor_id: "user-1",
    });
    expect(payload).not.toHaveProperty("published");
    expect(payload).not.toHaveProperty("field_config");
  });

  it("stores target_table_key = null when the intake heuristic selects no table", async () => {
    selectIntakeTable.mockReturnValue(null);

    const res = await createForm(identity(), { title: "Job Request" });

    expect(res.error).toBeNull();
    const payload = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.target_table_key).toBeNull();
  });

  it("rejects a blank/whitespace title with 400 titleRequired and never writes", async () => {
    const err = await createForm(identity(), { title: "   " }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({
      statusCode: 400,
      userMessage: "Forms.error.titleRequired",
    });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("retries on a 23505 unique violation and resolves with the next suffixed slug", async () => {
    // First insert loses the slug race (23505); the second, with the next suffix, wins.
    // `ensureUniqueFormSlug` re-queries each attempt: base, then base-2. The retry's
    // slug call fires BEFORE its insert, so flip `insertResult` to success there — the
    // single-`insertResult` fake needs no queue.
    insertResult = { data: null, error: { code: "23505" } };
    ensureUniqueFormSlug
      .mockResolvedValueOnce("job-request")
      .mockImplementationOnce(async () => {
        insertResult = { data: { id: "f1", slug: "job-request-2" }, error: null };
        return "job-request-2";
      });

    const res = await createForm(identity(), { title: "Job Request" });

    expect(res.error).toBeNull();
    expect(res.data).toEqual({ id: "f1", slug: "job-request-2" });
    expect(insertSpy).toHaveBeenCalledTimes(2);
  });

  it("surfaces a schema READ error as 500 writeFailed and never inserts", async () => {
    getSchema.mockResolvedValue({ data: null, error: { message: "boom" } });

    const err = await createForm(identity(), { title: "Job Request" }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 500, userMessage: "writeFailed" });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("exhausts MAX_SLUG_RETRIES when every insert collides (23505) and throws writeFailed", async () => {
    // Every attempt's insert returns 23505 (a pathological collision storm): the loop
    // runs its full budget, then falls through to the terminal writeFailed.
    insertResult = { data: null, error: { code: "23505" } };
    ensureUniqueFormSlug.mockResolvedValue("job-request");

    const err = await createForm(identity(), { title: "Job Request" }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 500, userMessage: "writeFailed" });
    // Insert attempted the full retry budget (MAX_SLUG_RETRIES = 25).
    expect(insertSpy).toHaveBeenCalledTimes(25);
  });
});

describe("renameForm", () => {
  it("updates the title and leaves the slug untouched", async () => {
    const res = await renameForm(identity(), { formId: "f1", title: "New Name" });

    expect(res.error).toBeNull();
    expect(res.data).toEqual({ id: "f1", slug: "job-request" });
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({ title: "New Name", actor_id: "user-1" });
    expect(payload).toHaveProperty("updated_at");
    // Rename must never touch the slug (slug is edited separately).
    expect(payload).not.toHaveProperty("slug");
  });

  it("rejects a blank title with 400 titleRequired and never writes", async () => {
    const err = await renameForm(identity(), { formId: "f1", title: "  " }).catch(
      (e: unknown) => e,
    );

    expect(err).toMatchObject({
      statusCode: 400,
      userMessage: "Forms.error.titleRequired",
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("404 notFound for a cross-org/unknown id (update matches no row)", async () => {
    updateResult = { data: null, error: null };

    const err = await renameForm(identity(), {
      formId: "nope",
      title: "New Name",
    }).catch((e: unknown) => e);

    expect(err).toMatchObject({
      statusCode: 404,
      userMessage: "Forms.error.notFound",
    });
  });
});

describe("updateFormSlug", () => {
  it("updates the slug when the normalized value is free in the org", async () => {
    deriveFormSlug.mockReturnValue("contact");
    ensureUniqueFormSlug.mockResolvedValue("contact");
    updateResult = { data: { id: "f1", slug: "contact" }, error: null };

    const res = await updateFormSlug(identity(), { formId: "f1", slug: "Contact" });

    expect(res.error).toBeNull();
    expect(res.data).toEqual({ id: "f1", slug: "contact" });
    const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({ slug: "contact", actor_id: "user-1" });
  });

  it("409 slugTaken (no write) when the normalized slug collides with another form", async () => {
    deriveFormSlug.mockReturnValue("contact");
    // A taken slug comes back suffixed — the signal the mutator rejects on.
    ensureUniqueFormSlug.mockResolvedValue("contact-2");

    const err = await updateFormSlug(identity(), {
      formId: "f1",
      slug: "Contact",
    }).catch((e: unknown) => e);

    expect(err).toMatchObject({
      statusCode: 409,
      userMessage: "Forms.error.slugTaken",
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("400 slugInvalid (no write) when the requested slug normalizes to empty", async () => {
    // Real kebabCase("日本語") === "" -> an explicit slug edit that normalizes to nothing.
    const err = await updateFormSlug(identity(), {
      formId: "f1",
      slug: "日本語",
    }).catch((e: unknown) => e);

    expect(err).toMatchObject({
      statusCode: 400,
      userMessage: "Forms.error.slugInvalid",
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("404 notFound when the form id is not in the caller's org", async () => {
    getFormById.mockResolvedValue(null);

    const err = await updateFormSlug(identity(), {
      formId: "nope",
      slug: "contact",
    }).catch((e: unknown) => e);

    expect(err).toMatchObject({
      statusCode: 404,
      userMessage: "Forms.error.notFound",
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe("deleteForm", () => {
  it("hard-deletes and returns the id", async () => {
    const res = await deleteForm(identity(), { formId: "f1" });

    expect(res.error).toBeNull();
    expect(res.data).toEqual({ id: "f1" });
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it("404 notFound for a cross-org/unknown id (delete matches no row)", async () => {
    deleteResult = { data: null, error: null };

    const err = await deleteForm(identity(), { formId: "nope" }).catch(
      (e: unknown) => e,
    );

    expect(err).toMatchObject({
      statusCode: 404,
      userMessage: "Forms.error.notFound",
    });
  });
});
