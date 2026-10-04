import { describe, expect, it } from "vitest";

import { publicFormUrl } from "@/lib/forms/share";

/**
 * Unit coverage for the pure public-form URL builder (Epic 14, Story 14.3). No DOM —
 * the share surface derives `origin` from `window.location.origin` at runtime, but the
 * URL contract is testable without a browser. Asserts the
 * `{origin}/forms/{orgSlug}/{formSlug}` shape and per-segment percent-encoding so a slug
 * with reserved characters never corrupts the path.
 */

describe("publicFormUrl", () => {
  it("builds {origin}/forms/{orgSlug}/{formSlug}", () => {
    expect(publicFormUrl("https://scheza.com", "acme", "job-request")).toBe(
      "https://scheza.com/forms/acme/job-request",
    );
  });

  it("preserves a non-root origin host and strips no path it is given", () => {
    expect(publicFormUrl("http://localhost:3000", "acme", "contact")).toBe(
      "http://localhost:3000/forms/acme/contact",
    );
  });

  it("percent-encodes each segment independently", () => {
    // A space and a slash in the form slug must not break the path shape.
    expect(publicFormUrl("https://scheza.com", "ac me", "a/b c")).toBe(
      "https://scheza.com/forms/ac%20me/a%2Fb%20c",
    );
  });

  it("encodes reserved characters that would otherwise be interpreted", () => {
    expect(publicFormUrl("https://scheza.com", "org", "a?b#c")).toBe(
      "https://scheza.com/forms/org/a%3Fb%23c",
    );
  });
});
