import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { downloadLogoBytes, MAX_LOGO_BYTES } from "@/lib/storage/logo";

/**
 * Direct unit coverage for `downloadLogoBytes` (Story 14.6) — the raw-bytes reader behind
 * the published-gated public logo proxy. The route test (`forms-logo-route.test.ts`) MOCKS
 * this helper, so without this file the real extension->content-type mapping and the
 * empty/oversize guards never execute and a regression would ship green (mirrors the repo
 * convention of unit-testing the sibling pure helper `validateLogo`).
 *
 * The Supabase `storage.from(bucket).download(path)` call is stubbed with a minimal chain;
 * `download` resolves to `{ data, error }` where `data` is a Blob-like object exposing
 * `arrayBuffer()`.
 */

/** A Blob-like download payload of `size` bytes with a working `arrayBuffer()`. */
function blobOf(size: number) {
  return {
    async arrayBuffer() {
      return new Uint8Array(size).buffer;
    },
  };
}

/** A Supabase stub whose `storage.from().download()` resolves to `result`. */
function clientReturning(result: { data: unknown; error: unknown }): SupabaseClient {
  return {
    storage: {
      from: vi.fn(() => ({
        download: vi.fn(async () => result),
      })),
    },
  } as unknown as SupabaseClient;
}

const okClient = () => clientReturning({ data: blobOf(1024), error: null });

describe("downloadLogoBytes — content-type mapping", () => {
  it("maps a .png key to image/png", async () => {
    const out = await downloadLogoBytes(okClient(), "org-1/logo.png");
    expect(out?.contentType).toBe("image/png");
    expect(out?.bytes.byteLength).toBe(1024);
  });

  it("maps a .jpg key to image/jpeg", async () => {
    const out = await downloadLogoBytes(okClient(), "org-1/logo.jpg");
    expect(out?.contentType).toBe("image/jpeg");
  });

  it("maps a .jpeg key to image/jpeg", async () => {
    const out = await downloadLogoBytes(okClient(), "org-1/logo.jpeg");
    expect(out?.contentType).toBe("image/jpeg");
  });

  it("returns null for an unsupported extension (never downloads)", async () => {
    const download = vi.fn();
    const client = {
      storage: { from: vi.fn(() => ({ download })) },
    } as unknown as SupabaseClient;
    expect(await downloadLogoBytes(client, "org-1/logo.svg")).toBeNull();
    // The extension gate short-circuits before any storage read.
    expect(download).not.toHaveBeenCalled();
  });
});

describe("downloadLogoBytes — null/guard cases", () => {
  it("returns null for a null path", async () => {
    expect(await downloadLogoBytes(okClient(), null)).toBeNull();
  });

  it("returns null on a download error", async () => {
    const client = clientReturning({ data: null, error: { message: "boom" } });
    expect(await downloadLogoBytes(client, "org-1/logo.png")).toBeNull();
  });

  it("returns null for an empty (0-byte) object", async () => {
    const client = clientReturning({ data: blobOf(0), error: null });
    expect(await downloadLogoBytes(client, "org-1/logo.png")).toBeNull();
  });

  it("returns null for an object over MAX_LOGO_BYTES", async () => {
    const client = clientReturning({ data: blobOf(MAX_LOGO_BYTES + 1), error: null });
    expect(await downloadLogoBytes(client, "org-1/logo.png")).toBeNull();
  });
});
