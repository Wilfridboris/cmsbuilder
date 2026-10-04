import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { RecordData } from "@/types/db";
import { getCurrentUser } from "@/lib/auth/session";
import { listRecords } from "@/lib/data/records";
import { mutate } from "@/lib/data/mutate";
import {
  json,
  resolveOrgIdentity,
  resolveWritableOrgIdentity,
  handleError,
} from "@/lib/api/route-helpers";
import { createBodySchema, listQuerySchema } from "./schemas";

/**
 * `GET /api/records?slug=&table=` (list) and `POST /api/records` (create) —
 * Story 3.2 record CRUD for the authenticated dashboard.
 *
 * Both mirror `api/invite/route.ts`: `getCurrentUser()` (JWT-validated) → 401 if
 * none → Zod-validate query/body → build the caller's RLS-scoped server client
 * from the request cookies → resolve the org by `slug` UNDER that RLS client
 * (RLS returns the org only if the caller is a member; a non-member sees no row
 * → 403). Writes go through the guarded `mutate.ts` layer with a `MutateIdentity`
 * of `{ client: rlsClient, actorId: user.id, orgId }` — never the admin client,
 * never a client-supplied org id.
 *
 * Every failure resolves to a translated error CODE via the `{ data, error }`
 * envelope; raw SQL/stacks are never leaked. `reportError` logs 5xx detail.
 */

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<RecordData[]>>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new AppError(401, "unauthorized");
    }

    const parsed = listQuerySchema.safeParse({
      slug: req.nextUrl.searchParams.get("slug"),
      table: req.nextUrl.searchParams.get("table"),
      // Repeatable `rel` params (`field:id`) → server-side relation filters.
      rel: req.nextUrl.searchParams.getAll("rel"),
    });
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug, table, rel } = parsed.data;

    const identity = await resolveOrgIdentity(slug, user.id);
    const result = await listRecords(identity.client, identity.orgId, table, rel);
    if (result.error) {
      throw new AppError(500, "loadFailed");
    }

    return json({ data: result.data ?? [], error: null }, 200);
  } catch (err) {
    return handleError(err, "/api/records");
  }
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<RecordData>>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new AppError(401, "unauthorized");
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "genericError");
    }
    const parsed = createBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug, table, data, idempotencyKey } = parsed.data;

    const identity = await resolveWritableOrgIdentity(slug, user.id);
    const result = await mutate(identity, "insert", table, data, {
      idempotencyKey,
    });
    if (result.error || !result.data) {
      // A relation referential-integrity rejection (Story 3.8) surfaces its own
      // translated code so the picker/UI can show "that link no longer exists"
      // rather than the generic write failure.
      if (result.error === "invalidReference") {
        throw new AppError(400, "invalidReference");
      }
      // A select-option membership rejection (Epic 13 retro A1) surfaces its own
      // translated code rather than the generic write failure.
      if (result.error === "invalidSelectValue") {
        throw new AppError(400, "invalidSelectValue");
      }
      throw new AppError(500, "writeFailed");
    }

    // The insert returns { id, version }; the created row's data is what we
    // sent (mutate stores it verbatim). Reconcile the optimistic row to this.
    const created: RecordData = {
      id: result.data.id,
      version: result.data.version,
      data,
    };
    return json({ data: created, error: null }, 200);
  } catch (err) {
    return handleError<RecordData>(err, "/api/records");
  }
}
