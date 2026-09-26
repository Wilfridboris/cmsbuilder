import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardNav } from "@/components/layout/DashboardNav";

/**
 * UI coverage for the role-aware `DashboardNav` server component (Story 2.4),
 * closing the three UI rows of the frozen I/O matrix:
 *   - Member views dashboard → Admin-only nav (Settings) ABSENT, dashboard present;
 *   - Admin views dashboard  → Admin-only nav (Settings) PRESENT;
 *   - Locale toggled to FR   → nav copy renders translated (no hardcoded strings).
 *
 * `DashboardNav` is an async Server Component, so we invoke it directly and walk
 * the returned React element tree (the test env is `node`, no DOM). `next-intl`'s
 * `getTranslations` is mocked to a swappable dictionary so we can assert both the
 * key wiring and the FR-translated render without a real i18n runtime.
 */

let dict: Record<string, string>;

vi.mock("next-intl/server", () => ({
  getTranslations: async (_ns: string) => (key: string) => dict[key] ?? key,
}));

const EN = { label: "Dashboard navigation", dashboard: "Dashboard", settings: "Settings" };
const FR = {
  label: "Navigation du tableau de bord",
  dashboard: "Tableau de bord",
  settings: "Paramètres",
};

/** Recursively collect every `href`, `aria-label`, and string child in a tree. */
function collect(
  node: unknown,
  hrefs: string[],
  texts: string[],
): void {
  if (node == null || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") {
    texts.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, hrefs, texts);
    return;
  }
  const props = (node as { props?: Record<string, unknown> }).props;
  if (!props) return;
  if (typeof props.href === "string") hrefs.push(props.href);
  if (typeof props["aria-label"] === "string") texts.push(props["aria-label"] as string);
  collect(props.children, hrefs, texts);
}

async function renderNav(role: "admin" | "member", slug = "mikes-plumbing-laval") {
  const element = await DashboardNav({ slug, role });
  const hrefs: string[] = [];
  const texts: string[] = [];
  collect(element, hrefs, texts);
  return { hrefs, texts };
}

describe("DashboardNav", () => {
  beforeEach(() => {
    dict = EN;
  });

  it("hides the Admin-only Settings link from a Member (dashboard stays)", async () => {
    const { hrefs } = await renderNav("member");

    expect(hrefs).toContain("/mikes-plumbing-laval");
    expect(hrefs).not.toContain("/mikes-plumbing-laval/settings");
  });

  it("shows the Admin-only Settings link to an Admin", async () => {
    const { hrefs } = await renderNav("admin");

    expect(hrefs).toContain("/mikes-plumbing-laval");
    expect(hrefs).toContain("/mikes-plumbing-laval/settings");
  });

  it("renders nav copy translated when the locale is FR", async () => {
    dict = FR;

    const { texts } = await renderNav("admin");

    expect(texts).toContain("Tableau de bord");
    expect(texts).toContain("Paramètres");
    expect(texts).toContain("Navigation du tableau de bord");
    // No English fallback leaked through.
    expect(texts).not.toContain("Settings");
    expect(texts).not.toContain("Dashboard");
  });
});
