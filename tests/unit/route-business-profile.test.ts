import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { AppError } from "@/types/api";

/**
 * Unit coverage for the `/api/business-profile` route family (Story 12.1) WITHOUT
 * a live DB or auth provider — mirroring `route-records.test.ts`: the REAL
 * `resolveOrgIdentity` runs (org resolved under a mocked RLS client), while the
 * caller identity, the admin role check, the mutation layer, and the logo storage
 * helpers are mocked. Locks the frozen I/O matrix rows that live in the handlers:
 *   GET  — load-none (200 {data:null}), load-existing (200 profile + signed logo);
 *   PUT  — upsert (200), legalNameRequired (400), registrationPairRequired (400);
 *   both — unauthenticated (401), non-member (403), Member (403), cross-org (403)
 *          reject before any profile access;
 *   POST /logo — accept (200 path + url), bad type/size (logoInvalid, no write).
 */

const getCurrentUser = vi.fn();
const requireAdmin = vi.fn();
const upsertBusinessProfile = vi.fn();
const setBusinessProfileLogoPath = vi.fn();
const uploadLogo = vi.fn();
const signLogoUrl = vi.fn();

type MaybeSingle = { data: unknown; error: unknown };
let orgRead: MaybeSingle; // organizations lookup inside resolveOrgIdentity (RLS)
let profileRead: MaybeSingle; // business_profiles maybeSingle for GET

function makeClient() {
  return {
    from(table: string) {
      const result = table === "organizations" ? orgRead : profileRead;
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => result }) }),
      };
    },
  };
}

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => makeClient(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/lib/auth/rbac", () => ({ requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/data/business-profile-mutate", () => ({
  upsertBusinessProfile,
  setBusinessProfileLogoPath,
}));
vi.mock("@/lib/storage/logo", () => ({ uploadLogo, signLogoUrl }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

function getReq(query: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/business-profile");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return { nextUrl: url } as unknown as NextRequest;
}

function putReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function logoReq(fields: { slug?: string; file?: File }): NextRequest {
  const form = new FormData();
  if (fields.slug !== undefined) form.set("slug", fields.slug);
  if (fields.file !== undefined) form.set("file", fields.file);
  return { formData: async () => form } as unknown as NextRequest;
}

const PROFILE_ROW = {
  organization_id: "org-1",
  legal_name: "Acme Inc.",
  operating_name: null,
  entity_type: null,
  jurisdiction: null,
  gst_hst_number: null,
  gst_hst_effective_date: null,
  logo_path: null,
  business_address: null,
  mailing_address: null,
  default_payment_terms: null,
  default_language: "en",
  payment_etransfer_email: null,
  payment_cheque_payable_to: null,
  payment_cheque_address: null,
  payment_card_link: null,
  actor_id: "admin-1",
  created_at: "2026-09-28T00:00:00Z",
  updated_at: "2026-09-28T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: an authenticated Admin of "acme" (org-1).
  getCurrentUser.mockResolvedValue({ id: "admin-1", email: "a@example.ca" });
  orgRead = { data: { id: "org-1" }, error: null };
  profileRead = { data: null, error: null };
  requireAdmin.mockResolvedValue({ organization_id: "org-1", role: "admin", slug: "acme" });
  upsertBusinessProfile.mockResolvedValue({ data: PROFILE_ROW, error: null });
  setBusinessProfileLogoPath.mockResolvedValue({
    data: { ...PROFILE_ROW, logo_path: "org-1/logo.png" },
    error: null,
  });
  uploadLogo.mockResolvedValue({ logoPath: "org-1/logo.png" });
  signLogoUrl.mockResolvedValue(null);
});

describe("GET /api/business-profile", () => {
  it("returns { data: null } when no profile is saved yet", async () => {
    const { GET } = await import("@/app/api/business-profile/route");
    const res = await GET(getReq({ slug: "acme" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toBeNull();
    expect(signLogoUrl).not.toHaveBeenCalled();
  });

  it("returns the existing profile plus a signed logo URL", async () => {
    const { GET } = await import("@/app/api/business-profile/route");
    profileRead = { data: { ...PROFILE_ROW, logo_path: "org-1/logo.png" }, error: null };
    signLogoUrl.mockResolvedValue("https://signed.example/logo.png");

    const res = await GET(getReq({ slug: "acme" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.profile.legal_name).toBe("Acme Inc.");
    expect(body.data.logoUrl).toBe("https://signed.example/logo.png");
    expect(signLogoUrl).toHaveBeenCalledWith(expect.anything(), "org-1/logo.png");
  });

  it("401 unauthorized when there is no session (no profile access)", async () => {
    const { GET } = await import("@/app/api/business-profile/route");
    getCurrentUser.mockResolvedValue(null);
    const res = await GET(getReq({ slug: "acme" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("403 forbidden for a non-member (org hidden under RLS)", async () => {
    const { GET } = await import("@/app/api/business-profile/route");
    orgRead = { data: null, error: null };
    const res = await GET(getReq({ slug: "acme" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
  });

  it("403 forbidden for a Member (requireAdmin rejects)", async () => {
    const { GET } = await import("@/app/api/business-profile/route");
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const res = await GET(getReq({ slug: "acme" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
  });

  it("403 forbidden for a cross-org Admin (slug mismatch)", async () => {
    const { GET } = await import("@/app/api/business-profile/route");
    requireAdmin.mockResolvedValue({ organization_id: "org-2", role: "admin", slug: "other" });
    const res = await GET(getReq({ slug: "acme" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
  });
});

describe("PUT /api/business-profile", () => {
  it("upserts a valid profile and returns 200 with the persisted row", async () => {
    const { PUT } = await import("@/app/api/business-profile/route");
    const res = await PUT(putReq({ slug: "acme", legalName: "Acme Inc." }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.profile.legal_name).toBe("Acme Inc.");
    // The write carries the mapped legal name and never touches logo_path.
    expect(upsertBusinessProfile).toHaveBeenCalledTimes(1);
    const [, writable] = upsertBusinessProfile.mock.calls[0];
    expect(writable.legal_name).toBe("Acme Inc.");
    expect(writable).not.toHaveProperty("logo_path");
  });

  it("400 legalNameRequired for a blank legal name (no write)", async () => {
    const { PUT } = await import("@/app/api/business-profile/route");
    const res = await PUT(putReq({ slug: "acme", legalName: "  " }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("BusinessProfile.error.legalNameRequired");
    expect(upsertBusinessProfile).not.toHaveBeenCalled();
  });

  it("400 registrationPairRequired for a GST/HST number without a date (no write)", async () => {
    const { PUT } = await import("@/app/api/business-profile/route");
    const res = await PUT(
      putReq({ slug: "acme", legalName: "Acme Inc.", gstHstNumber: "123456789 RT0001" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "BusinessProfile.error.registrationPairRequired",
    );
    expect(upsertBusinessProfile).not.toHaveBeenCalled();
  });

  it("401 unauthorized before any write", async () => {
    const { PUT } = await import("@/app/api/business-profile/route");
    getCurrentUser.mockResolvedValue(null);
    const res = await PUT(putReq({ slug: "acme", legalName: "Acme Inc." }));
    expect(res.status).toBe(401);
    expect(upsertBusinessProfile).not.toHaveBeenCalled();
  });

  it("403 forbidden for a Member before any write", async () => {
    const { PUT } = await import("@/app/api/business-profile/route");
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const res = await PUT(putReq({ slug: "acme", legalName: "Acme Inc." }));
    expect(res.status).toBe(403);
    expect(upsertBusinessProfile).not.toHaveBeenCalled();
  });
});

describe("POST /api/business-profile/logo", () => {
  const pngFile = () => new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });

  it("stores a valid logo and returns its path + a signed URL", async () => {
    const { POST } = await import("@/app/api/business-profile/logo/route");
    signLogoUrl.mockResolvedValue("https://signed.example/logo.png");

    const res = await POST(logoReq({ slug: "acme", file: pngFile() }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.logoPath).toBe("org-1/logo.png");
    expect(body.data.logoUrl).toBe("https://signed.example/logo.png");
    expect(uploadLogo).toHaveBeenCalledTimes(1);
    expect(setBusinessProfileLogoPath).toHaveBeenCalledTimes(1);
  });

  it("maps a bad image to logoInvalid and never persists a path", async () => {
    const { POST } = await import("@/app/api/business-profile/logo/route");
    uploadLogo.mockRejectedValue(new AppError(413, "BusinessProfile.error.logoInvalid"));

    const res = await POST(logoReq({ slug: "acme", file: pngFile() }));

    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("BusinessProfile.error.logoInvalid");
    expect(setBusinessProfileLogoPath).not.toHaveBeenCalled();
  });

  it("400 logoInvalid when the file part is missing", async () => {
    const { POST } = await import("@/app/api/business-profile/logo/route");
    const res = await POST(logoReq({ slug: "acme" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("BusinessProfile.error.logoInvalid");
    expect(uploadLogo).not.toHaveBeenCalled();
  });

  it("403 forbidden for a Member before any upload", async () => {
    const { POST } = await import("@/app/api/business-profile/logo/route");
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const res = await POST(logoReq({ slug: "acme", file: pngFile() }));
    expect(res.status).toBe(403);
    expect(uploadLogo).not.toHaveBeenCalled();
  });
});
