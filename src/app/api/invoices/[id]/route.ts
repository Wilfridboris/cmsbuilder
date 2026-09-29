import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/rbac";
import { json, resolveOrgIdentity, handleError } from "@/lib/api/route-helpers";
import type { OrgIdentity } from "@/lib/api/route-helpers";
import {
  getInvoiceWithLineItems,
  customerRecordBelongsToOrg,
  type InvoiceWithLineItems,
} from "@/lib/data/invoices";
import {
  saveInvoiceDraft,
  discardInvoiceDraft,
} from "@/lib/data/invoice-mutate";
import {
  draftBodySchema,
  getQuerySchema,
  firstInvoiceErrorKey,
  toWritableDraft,
} from "../schemas";

/**
 * `GET /api/invoices/[id]?slug=` (load a draft + its line items + customer label),
 * `PUT /api/invoices/[id]` (update the draft, version-gated), and
 * `DELETE /api/invoices/[id]?slug=` (discard the draft) — Story 12.2, Admin-only.
 *
 * All three share the Admin gate of `GET /api/invoices`: `getCurrentUser()` → 401
 * → resolve the org by `slug` UNDER the caller's RLS client (non-member → 403) →
 * `requireAdmin` (Member → 403) → slug match (cross-org Admin → 403), ALL before
 * any DB access. Slug is in the query (GET/DELETE) or the body (PUT).
 *
 * PUT updates through the guarded mutation layer (the `save_invoice_draft` RPC),
 * gated on `version`; a stale or non-`draft` row → 409 `versionConflict`, nothing
 * written. DELETE hard-deletes only a `draft` (else 409 `notDraft`). Every failure
 * resolves to a translated KEY via the `{ data, error }` envelope; raw SQL never
 * leaks.
 */

export const dynamic = "force-dynamic";

export type DiscardInvoicePayload = { id: string };

async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AppError(401, "unauthorized");
  }
  return user;
}

async function resolveAdminIdentity(
  slug: string,
  user: User,
): Promise<OrgIdentity> {
  const identity = await resolveOrgIdentity(slug, user.id);
  const membership = await requireAdmin(user, createAdminClient());
  if (membership.slug !== slug) {
    throw new AppError(403, "forbidden");
  }
  return identity;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<ApiResponse<InvoiceWithLineItems | null>>> {
  try {
    const parsed = getQuerySchema.safeParse({
      slug: req.nextUrl.searchParams.get("slug"),
    });
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug } = parsed.data;

    const { id } = await params;
    if (!id) {
      throw new AppError(400, "genericError");
    }

    const user = await requireUser();
    const identity = await resolveAdminIdentity(slug, user);

    const result = await getInvoiceWithLineItems(
      identity.client,
      identity.orgId,
      id,
    );
    if (result.error) {
      throw new AppError(500, "loadFailed");
    }
    // A null payload means the invoice does not exist under this org (RLS-hidden
    // or unknown id) — surface a 404 rather than a 200 with null data.
    if (!result.data) {
      throw new AppError(404, "notFound");
    }

    return json<InvoiceWithLineItems | null>(
      { data: result.data, error: null },
      200,
    );
  } catch (err) {
    return handleError<InvoiceWithLineItems | null>(err, "/api/invoices/[id]");
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<ApiResponse<{ id: string; version: number }>>> {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "genericError");
    }

    const { id } = await params;
    if (!id) {
      throw new AppError(400, "genericError");
    }

    // Auth + authorize before validating the full body (slug from the body).
    const user = await requireUser();
    const slugParsed = getQuerySchema.safeParse(raw);
    if (!slugParsed.success) {
      throw new AppError(400, "genericError");
    }
    const identity = await resolveAdminIdentity(slugParsed.data.slug, user);

    const parsed = draftBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, firstInvoiceErrorKey(parsed.error));
    }
    const writable = toWritableDraft(parsed.data);

    // An update MUST carry the version it last read (the optimistic-concurrency
    // gate). Absent → treat as a stale/invalid update rather than an accidental
    // create.
    if (writable.version === null) {
      throw new AppError(409, "versionConflict");
    }

    if (writable.customerRecordId) {
      const ok = await customerRecordBelongsToOrg(
        identity.client,
        identity.orgId,
        writable.customerRecordId,
      );
      if (!ok) {
        throw new AppError(400, "Invoice.error.customerRecordInvalid");
      }
    }

    // A draft has no issue date (that is set at issue, 12.4), so the registration
    // predicate is evaluated against TODAY as a provisional reference (YYYY-MM-DD).
    // Story 12.4 recomputes authoritatively against the real issue date.
    const referenceDate = new Date().toISOString().slice(0, 10);

    const result = await saveInvoiceDraft(identity, {
      ...writable,
      invoiceId: id,
      referenceDate,
    });
    if (result.error || !result.data) {
      throw new AppError(500, "writeFailed");
    }

    return json<{ id: string; version: number }>(
      { data: { id: result.data.id, version: result.data.version }, error: null },
      200,
    );
  } catch (err) {
    return handleError<{ id: string; version: number }>(
      err,
      "/api/invoices/[id]",
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<ApiResponse<DiscardInvoicePayload>>> {
  try {
    const parsed = getQuerySchema.safeParse({
      slug: req.nextUrl.searchParams.get("slug"),
    });
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug } = parsed.data;

    const { id } = await params;
    if (!id) {
      throw new AppError(400, "genericError");
    }

    const user = await requireUser();
    const identity = await resolveAdminIdentity(slug, user);

    const result = await discardInvoiceDraft(identity, id);
    if (result.error || !result.data) {
      throw new AppError(500, "writeFailed");
    }

    return json<DiscardInvoicePayload>(
      { data: { id: result.data.id }, error: null },
      200,
    );
  } catch (err) {
    return handleError<DiscardInvoicePayload>(err, "/api/invoices/[id]");
  }
}
