import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { FormRow } from "@/types/db";
import {
  json,
  requireUser,
  resolveAdminIdentity,
  resolveWritableAdminIdentity,
  handleError,
} from "@/lib/api/route-helpers";
import { listForms } from "@/lib/data/forms";
import { createForm, type FormMutateResult } from "@/lib/data/form-mutate";
import { listQuerySchema, createBodySchema, firstFormErrorKey } from "./schemas";

/**
 * `GET /api/forms?slug=` (list) and `POST /api/forms` (create a form) — Epic 14,
 * Story 14.1, Admin-only.
 *
 * Both mirror the invoices route's auth chain: `requireUser()` (JWT-validated) → 401 if
 * none → resolve the org by `slug` UNDER the caller's RLS-scoped client (a non-member
 * sees no row → 403) → `requireAdmin` re-checks the role authoritatively and a
 * `membership.slug === slug` check rejects a cross-org Admin (403). ALL before any DB
 * access — so a Member / non-member / unauthenticated caller is denied BEFORE any form
 * work, independent of UI hiding.
 *
 * GET lists the org's forms, newest first (plain `resolveAdminIdentity` — reads are
 * never gated). POST creates an unpublished form (`resolveWritableAdminIdentity`),
 * deriving a kebab slug, org-uniquing it, and pre-filling `target_table_key` via the
 * intake heuristic; it returns `{ id, slug }`. Every failure resolves to a translated
 * `Forms.error.*` KEY (or a shared code) via the `{ data, error }` envelope.
 */

export const dynamic = "force-dynamic";

/** The POST response: the created form's identity (id + slug). */
export type CreatedFormPayload = FormMutateResult;

export async function GET(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<FormRow[]>>> {
  try {
    const parsed = listQuerySchema.safeParse({
      slug: req.nextUrl.searchParams.get("slug"),
    });
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug } = parsed.data;

    const user = await requireUser();
    const identity = await resolveAdminIdentity(slug, user);

    const forms = await listForms(identity.client, identity.orgId);
    return json<FormRow[]>({ data: forms, error: null }, 200);
  } catch (err) {
    return handleError<FormRow[]>(err, "/api/forms");
  }
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<CreatedFormPayload>>> {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "genericError");
    }

    // Authenticate + authorize BEFORE validating the full body, so an unauthenticated /
    // non-admin / cross-org caller is rejected (401/403) before any input work. Only the
    // slug is read from the body to run the gate.
    const user = await requireUser();
    const slugParsed = listQuerySchema.safeParse(raw);
    if (!slugParsed.success) {
      throw new AppError(400, "genericError");
    }
    const identity = await resolveWritableAdminIdentity(slugParsed.data.slug, user);

    const parsed = createBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, firstFormErrorKey(parsed.error));
    }

    const result = await createForm(identity, { title: parsed.data.title });
    if (result.error || !result.data) {
      throw new AppError(500, "writeFailed");
    }

    return json<CreatedFormPayload>({ data: result.data, error: null }, 200);
  } catch (err) {
    return handleError<CreatedFormPayload>(err, "/api/forms");
  }
}
