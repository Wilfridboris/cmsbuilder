import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Coverage for the Story 7.4 `TrialBanner` — the frozen I/O & Edge-Case Matrix's
 * three banner rows plus the Admin-only-CTA rule. The repo test env is `node` (no
 * jsdom), so `next-intl`, `framer-motion`, and `next/link` are mocked the same way
 * the other component tests do and we assert on the rendered HTML string:
 *   - converting (trial, 1..2 days left) → prompt with the days message; admin sees
 *     the Add-billing CTA, a member does not;
 *   - read-only (read_only, or an expired trial) → paused notice; admin CTA, member
 *     the member-variant notice without a CTA;
 *   - hidden (trial > 2 days, or active) → renders nothing.
 * The pure `resolveBannerState` helper is unit-tested directly for the state rows.
 */

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, values?: Record<string, unknown>) =>
      values ? `${key} days=${Object.values(values).join(",")}` : key,
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
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { TrialBanner, resolveBannerState } from "@/components/layout/TrialBanner";

function render(node: ReactNode): string {
  return renderToStaticMarkup(node);
}

describe("resolveBannerState", () => {
  it("read_only → readOnly regardless of days", () => {
    expect(resolveBannerState("read_only", null)).toBe("readOnly");
    expect(resolveBannerState("read_only", 5)).toBe("readOnly");
  });

  it("an expired trial (days <= 0) → readOnly", () => {
    expect(resolveBannerState("trial", 0)).toBe("readOnly");
    expect(resolveBannerState("trial", -1)).toBe("readOnly");
  });

  it("a trial with 1..2 days left → converting", () => {
    expect(resolveBannerState("trial", 1)).toBe("converting");
    expect(resolveBannerState("trial", 2)).toBe("converting");
  });

  it("a trial with more than 2 days left → hidden", () => {
    expect(resolveBannerState("trial", 3)).toBe("hidden");
  });

  it("a trial with no clock (null days) → hidden", () => {
    expect(resolveBannerState("trial", null)).toBe("hidden");
  });

  it("active → hidden", () => {
    expect(resolveBannerState("active", null)).toBe("hidden");
    expect(resolveBannerState("past_due", null)).toBe("hidden");
  });
});

describe("TrialBanner render", () => {
  it("converting (admin): shows the days message and the Add-billing CTA to settings#billing", () => {
    const html = render(
      <TrialBanner
        slug="acme"
        subscriptionStatus="trial"
        daysRemaining={2}
        role="admin"
      />,
    );
    expect(html).toContain("convertingTitle");
    expect(html).toContain("convertingMessage days=2");
    expect(html).toContain("addBillingCta");
    expect(html).toContain('href="/acme/settings#billing"');
  });

  it("converting (member): shows the prompt but NO Add-billing CTA", () => {
    const html = render(
      <TrialBanner
        slug="acme"
        subscriptionStatus="trial"
        daysRemaining={1}
        role="member"
      />,
    );
    expect(html).toContain("convertingMessage");
    expect(html).not.toContain("addBillingCta");
    expect(html).not.toContain("settings#billing");
  });

  it("read-only (admin): shows the paused notice and the CTA", () => {
    const html = render(
      <TrialBanner
        slug="acme"
        subscriptionStatus="read_only"
        daysRemaining={null}
        role="admin"
      />,
    );
    expect(html).toContain("readOnlyTitle");
    expect(html).toContain("readOnlyMessage");
    expect(html).toContain("addBillingCta");
  });

  it("read-only (member): shows the member-variant notice without a CTA", () => {
    const html = render(
      <TrialBanner
        slug="acme"
        subscriptionStatus="read_only"
        daysRemaining={null}
        role="member"
      />,
    );
    expect(html).toContain("readOnlyMessageMember");
    expect(html).not.toContain("addBillingCta");
  });

  it("expired trial not yet flipped renders the read-only notice", () => {
    const html = render(
      <TrialBanner
        slug="acme"
        subscriptionStatus="trial"
        daysRemaining={0}
        role="admin"
      />,
    );
    expect(html).toContain("readOnlyTitle");
    expect(html).toContain("addBillingCta");
  });

  it("hidden (trial, >2 days) renders nothing", () => {
    const html = render(
      <TrialBanner
        slug="acme"
        subscriptionStatus="trial"
        daysRemaining={5}
        role="admin"
      />,
    );
    expect(html).toBe("");
  });

  it("hidden (active) renders nothing", () => {
    const html = render(
      <TrialBanner
        slug="acme"
        subscriptionStatus="active"
        daysRemaining={null}
        role="admin"
      />,
    );
    expect(html).toBe("");
  });
});
