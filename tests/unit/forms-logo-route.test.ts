import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import type { FormRow } from "@/types/db";

/**
 * Invariant coverage for the published-gated public logo proxy
 * `GET /api/forms/logo/[slug]` (Epic 14, Story 14.6) — the frozen matrix rows:
 *   - unknown org slug                 -> 404 (no gate, no download);
 *   - org has NO published form        -> 404 (the published gate);
 *   - org published but logo_path null -> 404 (no bytes);
 *   - download yields no bytes         -> 404;
 *   - all present                      -> 200 with the correct Content-Type + a long
 *                                         Cache-Control, streaming the bytes.
 *
 * The private-bucket posture is preserved: the route never mints a signed URL and never
 * exposes the storage key. The service-role admin client, the published-gate reader
 * (`getPrimaryPublishedForm`), and the byte reader (`downloadLogoBytes`) are mocked.
 */

const createAdminClient = vi.fn();
const getPrimaryPublishedForm = vi.fn();
const downloadLogoBytes = vi.fn();
const reportError = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/data/forms", () => ({ getPrimaryPublishedForm }));
vi.mock("@/lib/storage/logo", () => ({ downloadLogoBytes }));
vi.mock("@/lib/observability/report", () => ({ reportError }));

const { GET } = await import("@/app/api/forms/logo/[slug]/route");

type Result = { data: unknown; error: unknown };

/**
 * A scriptable admin stub distinguishing the two queries the route issues:
 *   organizations:     .select("id").eq("slug", …).maybeSingle()
 *   business_profiles: .select("logo_path").eq("organization_id", …).maybeSingle()
 */
function adminStub(org: Result, profile: Result) {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () =>
            table === "business_profiles" ? profile : org,
          ),
        })),
      })),
    })),
  };
}

function params(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

const req = {} as unknown as NextRequest;

function publishedForm(): FormRow {
  return {
    id: "f1",
    organization_id: "org-1",
    title: "Contact",
    slug: "contact",
    target_table_key: "leads",
    published: true,
    intro_text: null,
    field_config: [],
    actor_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/forms/logo/[slug] — 404 cases leak nothing", () => {
  it("404s an unknown org slug, before the published gate or any download", async () => {
    createAdminClient.mockReturnValue(
      adminStub({ data: null, error: null }, { data: null, error: null }),
    );

    const res = await GET(req, params("ghost"));

    expect(res.status).toBe(404);
    expect(getPrimaryPublishedForm).not.toHaveBeenCalled();
    expect(downloadLogoBytes).not.toHaveBeenCalled();
  });

  it("404s when the org has NO published form (published gate)", async () => {
    createAdminClient.mockReturnValue(
      adminStub({ data: { id: "org-1" }, error: null }, { data: null, error: null }),
    );
    getPrimaryPublishedForm.mockResolvedValue(null);

    const res = await GET(req, params("acme"));

    expect(res.status).toBe(404);
    expect(getPrimaryPublishedForm).toHaveBeenCalledWith(expect.anything(), "org-1");
    // Gate fails before the profile read / download.
    expect(downloadLogoBytes).not.toHaveBeenCalled();
  });

  it("404s when the org is published but has no logo_path", async () => {
    createAdminClient.mockReturnValue(
      adminStub(
        { data: { id: "org-1" }, error: null },
        { data: { logo_path: null }, error: null },
      ),
    );
    getPrimaryPublishedForm.mockResolvedValue(publishedForm());

    const res = await GET(req, params("acme"));

    expect(res.status).toBe(404);
    expect(downloadLogoBytes).not.toHaveBeenCalled();
  });

  it("404s when the bytes cannot be downloaded (unsupported/empty/oversize)", async () => {
    createAdminClient.mockReturnValue(
      adminStub(
        { data: { id: "org-1" }, error: null },
        { data: { logo_path: "org-1/logo.png" }, error: null },
      ),
    );
    getPrimaryPublishedForm.mockResolvedValue(publishedForm());
    downloadLogoBytes.mockResolvedValue(null);

    const res = await GET(req, params("acme"));

    expect(res.status).toBe(404);
    expect(downloadLogoBytes).toHaveBeenCalledWith(expect.anything(), "org-1/logo.png");
  });

  it("404s (reported) when the admin client throws — never leaks internals", async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error("service role unavailable");
    });

    const res = await GET(req, params("acme"));

    expect(res.status).toBe(404);
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/forms/logo/[slug] — streams the logo when present", () => {
  it("200s with the correct Content-Type, a short Cache-Control, and the bytes", async () => {
    createAdminClient.mockReturnValue(
      adminStub(
        { data: { id: "org-1" }, error: null },
        { data: { logo_path: "org-1/logo.png" }, error: null },
      ),
    );
    getPrimaryPublishedForm.mockResolvedValue(publishedForm());
    const bytes = Buffer.from([1, 2, 3, 4]);
    downloadLogoBytes.mockResolvedValue({ bytes, contentType: "image/png" });

    const res = await GET(req, params("acme"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    const received = Buffer.from(await res.arrayBuffer());
    expect(received.equals(bytes)).toBe(true);
    expect(reportError).not.toHaveBeenCalled();
  });
});
