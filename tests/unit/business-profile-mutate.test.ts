import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import type { BusinessProfileWritable } from "@/app/api/business-profile/schemas";
import {
  upsertBusinessProfile,
  setBusinessProfileLogoPath,
} from "@/lib/data/business-profile-mutate";
import { signLogoUrl, LOGO_BUCKET } from "@/lib/storage/logo";

/**
 * Unit coverage for the guarded Business Profile write layer (Story 12.1),
 * mirroring `schema-mutate.test.ts`: a fake Supabase client stands in for the DB
 * so we can pin the layer's contract without a live connection —
 *   - `upsertBusinessProfile` writes the org-scoped payload with `onConflict:
 *     organization_id` and DELIBERATELY omits `logo_path` (a plain save never
 *     clobbers an uploaded logo); a DB error → 500 writeFailed, raw message hidden;
 *   - `setBusinessProfileLogoPath` UPDATEs when a row exists and INSERTs a
 *     placeholder (`legal_name: ""`) when none does — the branch the route tests
 *     mock away entirely;
 *   - `signLogoUrl` returns null for a null path and for a storage error (a missing
 *     preview is non-fatal — the profile still loads), and the signed URL on success.
 */

// Fake client capturing the business_profiles write chains + storage signing.
let readResult: { data: unknown; error: unknown };
let writeResult: { data: unknown; error: unknown };
let signResult: { data: { signedUrl: string } | null; error: unknown };

const upsertSpy = vi.fn();
const updateSpy = vi.fn();
const insertSpy = vi.fn();
const updateEqSpy = vi.fn();
const createSignedUrlSpy = vi.fn();

function makeClient(): SupabaseClient {
  return {
    from(table: string) {
      if (table !== "business_profiles") {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        upsert(payload: unknown, opts: unknown) {
          upsertSpy(payload, opts);
          return { select: () => ({ single: async () => writeResult }) };
        },
        update(payload: unknown) {
          updateSpy(payload);
          return {
            eq: (col: string, val: string) => {
              updateEqSpy(col, val);
              return { select: () => ({ single: async () => writeResult }) };
            },
          };
        },
        insert(payload: unknown) {
          insertSpy(payload);
          return { select: () => ({ single: async () => writeResult }) };
        },
        // The read path: .select("organization_id").eq(...).maybeSingle()
        select: () => ({
          eq: () => ({ maybeSingle: async () => readResult }),
        }),
      };
    },
    storage: {
      from(bucket: string) {
        return {
          createSignedUrl: async (path: string, ttl: number) => {
            createSignedUrlSpy(bucket, path, ttl);
            return signResult;
          },
        };
      },
    },
  } as unknown as SupabaseClient;
}

function identity() {
  return { client: makeClient(), actorId: "user-1", orgId: "org-1" };
}

const WRITABLE: BusinessProfileWritable = {
  legal_name: "Acme Inc.",
  operating_name: null,
  entity_type: null,
  jurisdiction: null,
  gst_hst_number: null,
  gst_hst_effective_date: null,
  business_address: null,
  mailing_address: null,
  default_payment_terms: null,
  default_language: "en",
  payment_etransfer_email: null,
  payment_cheque_payable_to: null,
  payment_card_link: null,
  payment_cheque_address: null,
};

const ROW = { organization_id: "org-1", legal_name: "Acme Inc.", logo_path: null };

beforeEach(() => {
  vi.clearAllMocks();
  readResult = { data: null, error: null };
  writeResult = { data: ROW, error: null };
  signResult = { data: { signedUrl: "https://signed.example/logo.png" }, error: null };
});

describe("upsertBusinessProfile", () => {
  it("upserts the org-scoped payload with onConflict, omitting logo_path", async () => {
    const res = await upsertBusinessProfile(identity(), WRITABLE);

    expect(res.error).toBeNull();
    expect(res.data).toBe(ROW);
    expect(upsertSpy).toHaveBeenCalledTimes(1);

    const [payload, opts] = upsertSpy.mock.calls[0];
    expect(opts).toEqual({ onConflict: "organization_id" });
    expect(payload).toMatchObject({
      organization_id: "org-1",
      actor_id: "user-1",
      legal_name: "Acme Inc.",
    });
    expect(payload).toHaveProperty("updated_at");
    // A plain profile save must never write logo_path (server-owned by the logo route).
    expect(payload).not.toHaveProperty("logo_path");
  });

  it("500 writeFailed when the upsert errors, never leaking the raw message", async () => {
    writeResult = { data: null, error: { message: "duplicate key boom" } };

    const err = await upsertBusinessProfile(identity(), WRITABLE).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 500, userMessage: "writeFailed" });
    expect((err as { userMessage: string }).userMessage).not.toContain("boom");
  });
});

describe("setBusinessProfileLogoPath", () => {
  it("UPDATEs logo_path on the existing row, scoped to the org", async () => {
    readResult = { data: { organization_id: "org-1" }, error: null };
    writeResult = { data: { ...ROW, logo_path: "org-1/logo.png" }, error: null };

    const res = await setBusinessProfileLogoPath(identity(), "org-1/logo.png");

    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ logo_path: "org-1/logo.png" });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSpy.mock.calls[0][0]).toMatchObject({
      logo_path: "org-1/logo.png",
      actor_id: "user-1",
    });
    expect(updateEqSpy).toHaveBeenCalledWith("organization_id", "org-1");
  });

  it("INSERTs a placeholder row (legal_name empty) when no profile exists yet", async () => {
    readResult = { data: null, error: null };
    writeResult = {
      data: { ...ROW, legal_name: "", logo_path: "org-1/logo.png" },
      error: null,
    };

    const res = await setBusinessProfileLogoPath(identity(), "org-1/logo.png");

    expect(res.error).toBeNull();
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(insertSpy.mock.calls[0][0]).toEqual({
      organization_id: "org-1",
      legal_name: "",
      logo_path: "org-1/logo.png",
      actor_id: "user-1",
    });
  });

  it("500 writeFailed with NO write when the existence read fails", async () => {
    readResult = { data: null, error: { message: "read boom" } };

    const err = await setBusinessProfileLogoPath(
      identity(),
      "org-1/logo.png",
    ).catch((e: unknown) => e);

    expect(err).toMatchObject({ statusCode: 500, userMessage: "writeFailed" });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe("signLogoUrl", () => {
  it("returns null for a null path without touching storage", async () => {
    const url = await signLogoUrl(makeClient(), null);
    expect(url).toBeNull();
    expect(createSignedUrlSpy).not.toHaveBeenCalled();
  });

  it("returns null (non-fatal) when signing errors", async () => {
    signResult = { data: null, error: { message: "sign boom" } };
    const url = await signLogoUrl(makeClient(), "org-1/logo.png");
    expect(url).toBeNull();
  });

  it("returns the signed URL from the private bucket on success", async () => {
    const url = await signLogoUrl(makeClient(), "org-1/logo.png");
    expect(url).toBe("https://signed.example/logo.png");
    expect(createSignedUrlSpy).toHaveBeenCalledWith(
      LOGO_BUCKET,
      "org-1/logo.png",
      expect.any(Number),
    );
  });
});
