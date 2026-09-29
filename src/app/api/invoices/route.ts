import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { InvoiceRow } from "@/types/db";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/rbac";
import { json, resolveOrgIdentity, handleError } from "@/lib/api/route-helpers";
import type { OrgIdentity } from "@/lib/api/route-helpers";
import { listInvoices, customerRecordBelongsToOrg } from "@/lib/data/invoices";
import { saveInvoiceDraft } from "@/lib/data/invoice-mutate";
import {
  draftBodySchema,
  listQuerySchema,
  firstInvoiceErrorKey,
  toWritableDraft,
} from "./schemas";

/**
 * `GET /api/invoices?slug=` (list) and `POST /api/invoices` (create a draft) —
 * Story 12.2 invoice drafting, Admin-only.
 *
 * Both mirror the Business Profile route's auth chain: `getCurrentUser()`
 * (JWT-validated) → 401 if none → resolve the org by `slug` UNDER the caller's
 * RLS-scoped client (a non-member sees no row → 403) → `requireAdmin` re-checks
 * the role authoritatively from `org_members` (a Member → 403) and a
 * `membership.slug === slug` check rejects a cross-org Admin (403). ALL before any
 * DB access.
 *
 * GET lists the org's invoices, newest first. POST creates a `status='draft'`
 * invoice with its line items atomically through the guarded mutation layer (the
 * `save_invoice_draft` RPC under the caller's RLS client — never the admin client,
 * never `records`/`org_schemas`). Any `customerRecordId` is verified to belong to
 * the org before the write (else `customerRecordInvalid`).
 *
 * Every failure resolves to a translated `Invoice.error.*` KEY (or a shared code)
 * via the `{ data, error }` envelope; raw SQL/stacks never leak.
 */

export const dynamic = "force-dynamic";

/** The POST response: the created draft's identity (id + version). */
export type CreatedInvoicePayload = { id: string; version: number };

/** Authenticate the caller (401 when there is no session). */
async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AppError(401, "unauthorized");
  }
  return user;
}

/**
 * Shared Admin gate: resolve the (already-authenticated) caller's RLS identity for
 * `slug` and re-enforce Admin authoritatively, rejecting a non-member / Member /
 * cross-org Admin — all before any DB access. Returns the RLS-scoped identity.
 */
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
): Promise<NextResponse<ApiResponse<InvoiceRow[]>>> {
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

    const result = await listInvoices(identity.client, identity.orgId);
    if (result.error) {
      throw new AppError(500, "loadFailed");
    }

    return json<InvoiceRow[]>({ data: result.data ?? [], error: null }, 200);
  } catch (err) {
    return handleError<InvoiceRow[]>(err, "/api/invoices");
  }
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<CreatedInvoicePayload>>> {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "genericError");
    }

    // Authenticate + authorize BEFORE validating the full body, so an
    // unauthenticated / non-admin / cross-org caller is rejected (401/403) before
    // any input work. Only the slug is read from the body to run the gate.
    const user = await requireUser();
    const slugParsed = listQuerySchema.safeParse(raw);
    if (!slugParsed.success) {
      throw new AppError(400, "genericError");
    }
    const identity = await resolveAdminIdentity(slugParsed.data.slug, user);

    const parsed = draftBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, firstInvoiceErrorKey(parsed.error));
    }
    const writable = toWritableDraft(parsed.data);

    // Verify any linked customer record belongs to the org (under RLS) before the
    // write — the cross-org-link matrix row.
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
      invoiceId: null,
      referenceDate,
    });
    if (result.error || !result.data) {
      throw new AppError(500, "writeFailed");
    }

    return json<CreatedInvoicePayload>(
      { data: { id: result.data.id, version: result.data.version }, error: null },
      200,
    );
  } catch (err) {
    return handleError<CreatedInvoicePayload>(err, "/api/invoices");
  }
}
