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
  updateFormTarget,
  updateFormFieldConfig,
  updateFormIntroText,
  publishForm,
  deleteForm,
  type FormMutateResult,
} from "@/lib/data/form-mutate";
import {
  renameBodySchema,
  slugBodySchema,
  targetBodySchema,
  fieldConfigBodySchema,
  introTextBodySchema,
  publishBodySchema,
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
 * PATCH discriminates on the body: a `published` boolean is a publish toggle (checked
 * first; gated server-side, `publishBlocked` when the form has no valid target, URL
 * freezes on publish); a `targetTableKey` is a target-table choice (Story 14.4; validated
 * against the org's visible tables, `targetInvalid`, and locked with `targetLocked` once
 * published); a `title` is a rename (slug unchanged); a `newSlug` is a slug edit
 * (normalized to kebab, uniqueness-checked, `slugTaken`/`slugInvalid`, and rejected with
 * `slugLocked` once published). DELETE hard-deletes the form. Every failure resolves to a
 * translated KEY via the `{ data, error }` envelope; raw SQL never leaks.
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

    // Discriminate: a `published` boolean is a publish toggle (checked FIRST); then a
    // slug edit (`newSlug`) takes precedence over a rename (`title`). A body with none of
    // the valid shapes is a generic 400.
    const publishParse = publishBodySchema.safeParse(raw);
    if (publishParse.success) {
      const result = await publishForm(identity, {
        formId,
        published: publishParse.data.published,
      });
      if (result.error || !result.data) {
        throw new AppError(500, "writeFailed");
      }
      return json<FormMutateResult>({ data: result.data, error: null }, 200);
    }

    // A `targetTableKey` is a target-table choice (Story 14.4): checked after publish and
    // before slug/rename. The mutator validates the key names a currently-visible table
    // and locks the change while published.
    const targetParse = targetBodySchema.safeParse(raw);
    if (targetParse.success) {
      const result = await updateFormTarget(identity, {
        formId,
        targetTableKey: targetParse.data.targetTableKey,
      });
      if (result.error || !result.data) {
        throw new AppError(500, "writeFailed");
      }
      return json<FormMutateResult>({ data: result.data, error: null }, 200);
    }

    // A `fieldConfig` array is a per-field customization save (Story 14.5): checked after
    // target and before slug/rename. The mutator re-validates every entry against the
    // form's current target table (relation/stale keys dropped, FR78); not locked while
    // published (field config never changes where responses land).
    const fieldConfigParse = fieldConfigBodySchema.safeParse(raw);
    if (fieldConfigParse.success) {
      const result = await updateFormFieldConfig(identity, {
        formId,
        fieldConfig: fieldConfigParse.data.fieldConfig,
      });
      if (result.error || !result.data) {
        throw new AppError(500, "writeFailed");
      }
      return json<FormMutateResult>({ data: result.data, error: null }, 200);
    }

    // An `introText` string is an intro-text save (Story 14.6): checked after field-config
    // and before slug/rename. The mutator trims and stores null when blank; the schema caps
    // length at 500. A body that carries `introText` but fails validation (over-length)
    // surfaces `introTooLong` immediately rather than falling through to slug/rename.
    const introParse = introTextBodySchema.safeParse(raw);
    if (introParse.success) {
      const result = await updateFormIntroText(identity, {
        formId,
        introText: introParse.data.introText,
      });
      if (result.error || !result.data) {
        throw new AppError(500, "writeFailed");
      }
      return json<FormMutateResult>({ data: result.data, error: null }, 200);
    }
    if (
      raw !== null &&
      typeof raw === "object" &&
      "introText" in raw
    ) {
      // The body is an intro-text save that failed validation (over-length) — surface its
      // specific key instead of falling through to the slug/rename dispatch.
      throw new AppError(400, firstFormErrorKey(introParse.error));
    }

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
