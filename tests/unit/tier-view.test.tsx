import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Render coverage for the Story 7.5 `TierView` card against the frozen matrix:
 *   - subscribed card: tier label + inclusions + next-billing-date, NO meter;
 *   - degraded (Stripe down): tier label + inclusions, NO next-billing-date;
 *   - upgrade prompt shown vs hidden (non-blocking role="status" + portal CTA).
 * The repo test env is `node` (no jsdom), so `next-intl`, `framer-motion`, and the
 * Button are mocked the way the other component tests do, and we assert on the HTML
 * string. The `nextBillingDate` translation echoes its key so we can assert presence
 * / omission without an ICU formatter.
 */

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, values?: Record<string, unknown>) =>
      values ? `${key}(${Object.keys(values).join(",")})` : key,
}));
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children }: { children?: ReactNode }) =>
          children ?? null,
    },
  ),
  useReducedMotion: () => true,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children?: ReactNode }) => <button>{children}</button>,
}));

import { TierView } from "@/components/settings/TierView";

function render(node: ReactNode): string {
  return renderToStaticMarkup(node);
}

describe("TierView render", () => {
  it("subscribed card: tier label, inclusions, next billing date, no meter", () => {
    const html = render(
      <TierView
        slug="acme"
        tier="solo"
        nextBillingDate="2026-11-01T00:00:00.000Z"
        showUpgradePrompt={false}
        suggestedTier={null}
      />,
    );
    // Tier label + heading.
    expect(html).toContain("tierHeading");
    expect(html).toContain("tierLabel(tier)");
    // All four flat-tier inclusions.
    expect(html).toContain("inclusionsHeading");
    expect(html).toContain("inclusionTeam");
    expect(html).toContain("inclusionCustomers");
    expect(html).toContain("inclusionRecords");
    expect(html).toContain("inclusionImport");
    // Next billing date present.
    expect(html).toContain("nextBillingDate(date)");
    // No usage meter / spend cap language anywhere.
    expect(html.toLowerCase()).not.toContain("meter");
    expect(html.toLowerCase()).not.toContain("remaining");
    // No prompt.
    expect(html).not.toContain("upgradePromptTitle");
  });

  it("degraded (Stripe down): tier + inclusions, NO next-billing-date", () => {
    const html = render(
      <TierView
        slug="acme"
        tier="crew"
        nextBillingDate={null}
        showUpgradePrompt={false}
        suggestedTier={null}
      />,
    );
    expect(html).toContain("tierLabel(tier)");
    expect(html).toContain("inclusionsHeading");
    // The next-billing-date line is omitted entirely.
    expect(html).not.toContain("nextBillingDate");
  });

  it("upgrade prompt shown: non-blocking role=status + portal CTA", () => {
    const html = render(
      <TierView
        slug="acme"
        tier="solo"
        nextBillingDate="2026-11-01T00:00:00.000Z"
        showUpgradePrompt={true}
        suggestedTier="crew"
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("upgradePromptTitle");
    expect(html).toContain("upgradePromptBody(currentTier,suggestedTier)");
    expect(html).toContain("upgradePromptCta");
  });

  it("upgrade prompt hidden: no status callout", () => {
    const html = render(
      <TierView
        slug="acme"
        tier="shop"
        nextBillingDate="2026-11-01T00:00:00.000Z"
        showUpgradePrompt={false}
        suggestedTier={null}
      />,
    );
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("upgradePromptTitle");
  });
});
