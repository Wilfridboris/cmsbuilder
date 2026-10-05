import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";

/**
 * Regression guard for the Story 8.2 web app manifest (spec-8-2).
 *
 * The one load-bearing, deliberately non-default value is `start_url: "/home"`:
 * the spec's explicit deviation from `/` so the installed PWA lands on the
 * session-resolving `/home` route (not the public PromptBuilder landing). A
 * regression back to `/` would strand installed users on the anonymous page and,
 * without this test, ship with a green suite. Pin that value plus `standalone`
 * display and the three install icons.
 */
describe("app manifest (start_url deviation + install icons)", () => {
  const result = manifest();

  it("start_url points at the /home resolver, not / (the frozen deviation)", () => {
    expect(result.start_url).toBe("/home");
  });

  it("launches standalone", () => {
    expect(result.display).toBe("standalone");
  });

  it("ships the 192, 512, and maskable-512 install icons", () => {
    const icons = result.icons ?? [];
    expect(icons.some((i) => i.sizes === "192x192")).toBe(true);
    expect(
      icons.some((i) => i.sizes === "512x512" && i.purpose !== "maskable"),
    ).toBe(true);
    expect(
      icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable"),
    ).toBe(true);
  });
});
