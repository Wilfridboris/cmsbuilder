import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { AppError } from "@/types/api";

/**
 * Auth-gate coverage for the `/api/forms` route family (Epic 14, Story 14.1) — the frozen
 * I/O & Edge-Case Matrix rows "Unauthenticated → 401" and "Member attempts any op → 403",
 * for every handler (GET/POST list+create, PATCH/DELETE edit). Mirrors the route-test
 * convention (`intake-submit-route.test.ts`): mock the auth + data seams, feed a fake
 * `NextRequest`, assert the `{ data, error }` envelope status/key.
 *
 * The REAL `json`/`handleError` run (via `importActual`) so the AppError→status mapping is
 * exercised; only `requireUser` / `resolveAdminIdentity` / `resolveWritableAdminIdentity`
 * are overridden (they wrap the already-tested `getCurrentUser`/`requireAdmin`/
 * `resolveOrgIdentity` helpers covered in `rbac.test.ts` + `auth-org.test.ts`). The data
 * layer is mocked purely to ASSERT no form read/write is reached once a gate rejects.
 */

// Hoisted so the vi.mock factories (themselves hoisted above the imports) can safely
// reference these spies without a temporal-dead-zone error.
const {
  requireUser,
  resolveAdminIdentity,
  resolveWritableAdminIdentity,
  listForms,
  getFormById,
  createForm,
  renameForm,
  updateFormSlug,
  updateFormTarget,
  publishForm,
  deleteForm,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  resolveAdminIdentity: vi.fn(),
  resolveWritableAdminIdentity: vi.fn(),
  listForms: vi.fn(),
  getFormById: vi.fn(),
  createForm: vi.fn(),
  renameForm: vi.fn(),
  updateFormSlug: vi.fn(),
  updateFormTarget: vi.fn(),
  publishForm: vi.fn(),
  deleteForm: vi.fn(),
}));

vi.mock("@/lib/api/route-helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/route-helpers")>();
  return {
    ...actual,
    requireUser,
    resolveAdminIdentity,
    resolveWritableAdminIdentity,
  };
});

vi.mock("@/lib/data/forms", () => ({ listForms, getFormById }));
vi.mock("@/lib/data/form-mutate", () => ({
  createForm,
  renameForm,
  updateFormSlug,
  updateFormTarget,
  publishForm,
  deleteForm,
}));

import { GET, POST } from "@/app/api/forms/route";
import { PATCH, DELETE } from "@/app/api/forms/[formId]/route";

const SLUG = "acme";

function queryReq(slug: string): NextRequest {
  return {
    nextUrl: { searchParams: new URLSearchParams({ slug }) },
  } as unknown as NextRequest;
}

function bodyReq(body: unknown): NextRequest {
  return {
    json: async () => body,
    nextUrl: { searchParams: new URLSearchParams() },
  } as unknown as NextRequest;
}

function formParams() {
  return { params: Promise.resolve({ formId: "f1" }) };
}

/** Run each handler with inputs valid enough to REACH the auth gate. */
const CALLS: Array<{ name: string; run: () => Promise<Response> }> = [
  { name: "GET", run: () => GET(queryReq(SLUG)) },
  { name: "POST", run: () => POST(bodyReq({ slug: SLUG, title: "Job Request" })) },
  {
    name: "PATCH",
    run: () => PATCH(bodyReq({ slug: SLUG, title: "Renamed" }), formParams()),
  },
  { name: "DELETE", run: () => DELETE(queryReq(SLUG), formParams()) },
];

function expectNoDataAccess() {
  expect(listForms).not.toHaveBeenCalled();
  expect(getFormById).not.toHaveBeenCalled();
  expect(createForm).not.toHaveBeenCalled();
  expect(renameForm).not.toHaveBeenCalled();
  expect(updateFormSlug).not.toHaveBeenCalled();
  expect(updateFormTarget).not.toHaveBeenCalled();
  expect(publishForm).not.toHaveBeenCalled();
  expect(deleteForm).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/api/forms auth gate", () => {
  it.each(CALLS)(
    "$name → 401 unauthorized for an unauthenticated caller, before any DB access",
    async ({ run }) => {
      // requireUser is the FIRST gate every handler hits.
      requireUser.mockRejectedValue(new AppError(401, "unauthorized"));

      const res = await run();
      const body = (await res.json()) as { data: unknown; error: string | null };

      expect(res.status).toBe(401);
      expect(body).toEqual({ data: null, error: "unauthorized" });
      expectNoDataAccess();
    },
  );

  it.each(CALLS)(
    "$name → 403 forbidden for a Member / non-admin, before any DB access",
    async ({ run }) => {
      requireUser.mockResolvedValue({ id: "user-1" });
      resolveAdminIdentity.mockRejectedValue(new AppError(403, "forbidden"));
      resolveWritableAdminIdentity.mockRejectedValue(
        new AppError(403, "forbidden"),
      );

      const res = await run();
      const body = (await res.json()) as { data: unknown; error: string | null };

      expect(res.status).toBe(403);
      expect(body).toEqual({ data: null, error: "forbidden" });
      expectNoDataAccess();
    },
  );
});

/**
 * Body-dispatch + validation coverage with the auth gate PASSING (an Admin): once
 * `requireUser` + `resolveWritableAdminIdentity` resolve, the handler's own zod
 * validation and PATCH discrimination (`updateFormSlug` vs `renameForm`) must behave per
 * the frozen matrix. The mutators are stubbed to a trivial envelope so the assertion is
 * about WHICH mutator ran (and whether validation short-circuits before any write).
 */
describe("/api/forms body dispatch (gate passing)", () => {
  const IDENTITY = { client: {}, actorId: "user-1", orgId: "org-1" };

  beforeEach(() => {
    requireUser.mockResolvedValue({ id: "user-1" });
    resolveAdminIdentity.mockResolvedValue(IDENTITY);
    resolveWritableAdminIdentity.mockResolvedValue(IDENTITY);
  });

  it("POST with a blank/whitespace title → 400 titleRequired, createForm never called", async () => {
    const res = await POST(bodyReq({ slug: SLUG, title: "   " }));
    const body = (await res.json()) as { data: unknown; error: string | null };

    expect(res.status).toBe(400);
    expect(body).toEqual({ data: null, error: "Forms.error.titleRequired" });
    expect(createForm).not.toHaveBeenCalled();
  });

  it("PATCH { slug, newSlug } dispatches to updateFormSlug (not renameForm) and returns its result", async () => {
    updateFormSlug.mockResolvedValue({
      data: { id: "f1", slug: "renamed-slug" },
      error: null,
    });

    const res = await PATCH(
      bodyReq({ slug: SLUG, newSlug: "renamed-slug" }),
      formParams(),
    );
    const body = (await res.json()) as { data: unknown; error: string | null };

    expect(res.status).toBe(200);
    expect(body).toEqual({ data: { id: "f1", slug: "renamed-slug" }, error: null });
    expect(updateFormSlug).toHaveBeenCalledTimes(1);
    expect(updateFormSlug).toHaveBeenCalledWith(IDENTITY, {
      formId: "f1",
      slug: "renamed-slug",
    });
    expect(renameForm).not.toHaveBeenCalled();
  });

  it("PATCH { slug, title } dispatches to renameForm (not updateFormSlug)", async () => {
    renameForm.mockResolvedValue({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });

    const res = await PATCH(
      bodyReq({ slug: SLUG, title: "Renamed" }),
      formParams(),
    );
    const body = (await res.json()) as { data: unknown; error: string | null };

    expect(res.status).toBe(200);
    expect(body).toEqual({ data: { id: "f1", slug: "job-request" }, error: null });
    expect(renameForm).toHaveBeenCalledTimes(1);
    expect(renameForm).toHaveBeenCalledWith(IDENTITY, {
      formId: "f1",
      title: "Renamed",
    });
    expect(updateFormSlug).not.toHaveBeenCalled();
  });

  it("PATCH { slug } only (neither title nor newSlug) → 400 and no mutator runs", async () => {
    const res = await PATCH(bodyReq({ slug: SLUG }), formParams());

    expect(res.status).toBe(400);
    expect(updateFormSlug).not.toHaveBeenCalled();
    expect(updateFormTarget).not.toHaveBeenCalled();
    expect(renameForm).not.toHaveBeenCalled();
    expect(publishForm).not.toHaveBeenCalled();
  });

  it("PATCH { slug, targetTableKey } dispatches to updateFormTarget (not slug/rename/publish)", async () => {
    updateFormTarget.mockResolvedValue({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });

    const res = await PATCH(
      bodyReq({ slug: SLUG, targetTableKey: "leads" }),
      formParams(),
    );
    const body = (await res.json()) as { data: unknown; error: string | null };

    expect(res.status).toBe(200);
    expect(body).toEqual({ data: { id: "f1", slug: "job-request" }, error: null });
    expect(updateFormTarget).toHaveBeenCalledTimes(1);
    expect(updateFormTarget).toHaveBeenCalledWith(IDENTITY, {
      formId: "f1",
      targetTableKey: "leads",
    });
    expect(publishForm).not.toHaveBeenCalled();
    expect(updateFormSlug).not.toHaveBeenCalled();
    expect(renameForm).not.toHaveBeenCalled();
  });

  it("PATCH target branch ordering: publish is still checked FIRST, target before slug/rename", async () => {
    // A body carrying BOTH `published` and `targetTableKey` hits the publish branch first
    // (publish is the earliest discriminator), so the target branch never runs.
    publishForm.mockResolvedValue({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });

    await PATCH(
      bodyReq({ slug: SLUG, published: true, targetTableKey: "leads" }),
      formParams(),
    );

    expect(publishForm).toHaveBeenCalledTimes(1);
    expect(updateFormTarget).not.toHaveBeenCalled();

    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "user-1" });
    resolveWritableAdminIdentity.mockResolvedValue(IDENTITY);

    // A target body carries no `title`/`newSlug`, so target is reached before slug/rename.
    updateFormTarget.mockResolvedValue({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });
    await PATCH(
      bodyReq({ slug: SLUG, targetTableKey: "leads" }),
      formParams(),
    );
    expect(updateFormTarget).toHaveBeenCalledTimes(1);
    expect(updateFormSlug).not.toHaveBeenCalled();
    expect(renameForm).not.toHaveBeenCalled();
  });

  it("PATCH { slug, published } dispatches to publishForm (not slug/rename) and returns its result", async () => {
    publishForm.mockResolvedValue({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });

    const res = await PATCH(
      bodyReq({ slug: SLUG, published: true }),
      formParams(),
    );
    const body = (await res.json()) as { data: unknown; error: string | null };

    expect(res.status).toBe(200);
    expect(body).toEqual({ data: { id: "f1", slug: "job-request" }, error: null });
    expect(publishForm).toHaveBeenCalledTimes(1);
    expect(publishForm).toHaveBeenCalledWith(IDENTITY, {
      formId: "f1",
      published: true,
    });
    expect(updateFormSlug).not.toHaveBeenCalled();
    expect(renameForm).not.toHaveBeenCalled();
  });

  it("PATCH publish branch is checked FIRST: { slug, title } does NOT reach publishForm", async () => {
    renameForm.mockResolvedValue({
      data: { id: "f1", slug: "job-request" },
      error: null,
    });

    await PATCH(bodyReq({ slug: SLUG, title: "Renamed" }), formParams());

    // A rename body carries no `published` boolean, so the publish branch is skipped
    // and the body falls through to the rename dispatch.
    expect(publishForm).not.toHaveBeenCalled();
    expect(renameForm).toHaveBeenCalledTimes(1);
  });
});
