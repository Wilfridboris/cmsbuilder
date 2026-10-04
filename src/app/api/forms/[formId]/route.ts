import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import {
  json,
  requireUser,
  resolveWritableAdminIdentity,
  handleError,
} from "@/lib/api/route-helpers";
import {
  renameForm,
  updateFormSlug,
  deleteForm,
  type FormMutateResult,
} from "@/lib/data/form-mutate";
import {
  renameBodySchema,
  slugBodySchema,
  deleteQuerySchema,
  listQuerySchema,
  firstFormErrorKey,
} from "../schemas";

/**
 * `PATCH /api/forms/[formId]` (rename OR slug edit) and `DELETE /api/forms/[formId]?slug=`
 * — Epic 14, Story 14.1, Admin-only.
 *
 * Both run the full writable-admin gate BEFORE any DB access: `requireUser()` → 401 →
 * resolve the org by `slug` under the caller's RLS client (non-member → 403) →
 * `requireAdmin` + slug match (Member / cross-org Admin → 403). A `formId` not in the
 * caller's org is a 404 `Forms.error.notFound` (RLS hides it; the mutator surfaces 404).
 *
 * PATCH discriminates on the body: a `title` is a rename (slug unchanged); a `newSlug`
 * is a slug edit (normalized to kebab, uniqueness-checked, `slugTaken`/`slugInvalid` on
 * failure). DELETE hard-deletes the form. Every failure resolves to a translated KEY via
 * the `{ data, error }` envelope; raw SQL never leaks.
 */

export const dynamic = "force-dynamic";

export type DeleteFormPayload = { id: string };

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ formId: string }> },
): Promise<NextResponse<ApiResponse<FormMutateResult>>> {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "genericError");
    }

    const { formId } = await params;
    if (!formId) {
      throw new AppError(400, "genericError");
    }

    // Auth + authorize before validating the full body (slug from the body).
    const user = await requireUser();
    const slugParsed = listQuerySchema.safeParse(raw);
    if (!slugParsed.success) {
      throw new AppError(400, "genericError");
    }
    const identity = await resolveWritableAdminIdentity(slugParsed.data.slug, user);

    // Discriminate: a slug edit (`newSlug`) takes precedence over a rename (`title`). A
    // body with neither valid shape is a generic 400.
    const slugParse = slugBodySchema.safeParse(raw);
    if (slugParse.success) {
      const result = await updateFormSlug(identity, {
        formId,
        slug: slugParse.data.newSlug,
      });
      if (result.error || !result.data) {
        throw new AppError(500, "writeFailed");
      }
      return json<FormMutateResult>({ data: result.data, error: null }, 200);
    }

    const renameParse = renameBodySchema.safeParse(raw);
    if (renameParse.success) {
      const result = await renameForm(identity, {
        formId,
        title: renameParse.data.title,
      });
      if (result.error || !result.data) {
        throw new AppError(500, "writeFailed");
      }
      return json<FormMutateResult>({ data: result.data, error: null }, 200);
    }

    // Neither shape validated — surface the most specific key available.
    throw new AppError(400, firstFormErrorKey(renameParse.error));
  } catch (err) {
    return handleError<FormMutateResult>(err, "/api/forms/[formId]");
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ formId: string }> },
): Promise<NextResponse<ApiResponse<DeleteFormPayload>>> {
  try {
    const parsed = deleteQuerySchema.safeParse({
      slug: req.nextUrl.searchParams.get("slug"),
    });
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug } = parsed.data;

    const { formId } = await params;
    if (!formId) {
      throw new AppError(400, "genericError");
    }

    const user = await requireUser();
    const identity = await resolveWritableAdminIdentity(slug, user);

    const result = await deleteForm(identity, { formId });
    if (result.error || !result.data) {
      throw new AppError(500, "writeFailed");
    }

    return json<DeleteFormPayload>({ data: result.data, error: null }, 200);
  } catch (err) {
    return handleError<DeleteFormPayload>(err, "/api/forms/[formId]");
  }
}
