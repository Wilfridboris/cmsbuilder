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
import { issueInvoice } from "@/lib/data/invoice-mutate";
import { issueBodySchema } from "../../schemas";

/**
 * `POST /api/invoices/[id]/issue` — issue a validated draft (Story 12.4, Admin-only).
 *
 * Reuses the EXACT auth chain of the other invoice routes: `getCurrentUser()` → 401 →
 * resolve the org by `slug` UNDER the caller's RLS client (non-member → 403) →
 * `requireAdmin` (Member → 403) → slug match (cross-org Admin → 403), ALL before any
 * DB access.
 *
 * The body carries the org `slug` and the REQUIRED `version` the caller last read (the
 * optimistic-concurrency gate). No `issue_date` is accepted — it is server-authoritative
 * (TODAY). `issueInvoice` runs the synchronous `assertIssuable` compliance gate (which
 * throws a 422 `Invoice.error.*` with a plain-language reason on any failure), then
 * mints the gap-free number, freezes the snapshots + issue date + share token, and flips
 * status to `issued` in one transaction. A stale/non-draft row → 409. Every failure
 * resolves through the `{ data, error }` envelope; raw SQL never leaks.
 */

export const dynamic = "force-dynamic";

/** The POST response: the issued invoice's identity + its minted number. */
export type IssuedInvoicePayload = {
  id: string;
  version: number;
  invoice_number: number;
};

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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<ApiResponse<IssuedInvoicePayload>>> {
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

    // Auth + authorize BEFORE consuming the body — an unauthenticated / non-admin /
    // cross-org caller is rejected (401/403) before any input work.
    const user = await requireUser();
    const parsed = issueBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const identity = await resolveAdminIdentity(parsed.data.slug, user);

    const result = await issueInvoice(identity, {
      invoiceId: id,
      version: parsed.data.version,
    });
    if (result.error || !result.data) {
      throw new AppError(500, "writeFailed");
    }

    return json<IssuedInvoicePayload>(
      {
        data: {
          id: result.data.id,
          version: result.data.version,
          invoice_number: result.data.invoice_number,
        },
        error: null,
      },
      200,
    );
  } catch (err) {
    return handleError<IssuedInvoicePayload>(err, "/api/invoices/[id]/issue");
  }
}
