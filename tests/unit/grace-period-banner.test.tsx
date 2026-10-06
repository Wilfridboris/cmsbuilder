import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Coverage for the Story 8.5 `GracePeriodBanner` — the offboarding grace notice's
 * admin-only-CTA rule and the admin/member message variants, mirroring the sibling
 * `trial-banner.test.tsx`. The repo test env is `node` (no jsdom), so `next-intl`,
 * `framer-motion`, and `next/link` are mocked the same way and we assert on the
 * rendered HTML string:
 *   - admin → the deletion-date message + countdown, and BOTH CTAs ("Download my
 *     data" to settings#offboarding, "Keep my account" to settings#billing);
 *   - member → the member-variant message + countdown, and NEITHER CTA (billing /
 *     export are Admin-only RBAC).
 * Guards against a regression that inverts the role check and exposes the admin
 * billing/export CTAs to a non-admin member.
 */

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, values?: Record<string, unknown>) =>
      values ? `${key} vals=${Object.values(values).join(",")}` : key,
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

import { GracePeriodBanner } from "@/components/layout/GracePeriodBanner";

function render(node: ReactNode): string {
  return renderToStaticMarkup(node);
}

describe("GracePeriodBanner render", () => {
  it("admin: shows the deletion-date message, countdown, and BOTH CTAs with their hrefs", () => {
    const html = render(
      <GracePeriodBanner
        slug="acme"
        role="admin"
        daysRemaining={12}
        deletionDateLabel="November 5, 2026"
      />,
    );
    expect(html).toContain("banner.title");
    expect(html).toContain("banner.message vals=November 5, 2026");
    expect(html).toContain("banner.countdown vals=12");
    expect(html).toContain("banner.downloadCta");
    expect(html).toContain("banner.keepCta");
    expect(html).toContain('href="/acme/settings#offboarding"');
    expect(html).toContain('href="/acme/settings#billing"');
  });

  it("member: shows the member-variant message + countdown but NEITHER CTA", () => {
    const html = render(
      <GracePeriodBanner
        slug="acme"
        role="member"
        daysRemaining={12}
        deletionDateLabel="November 5, 2026"
      />,
    );
    expect(html).toContain("banner.messageMember vals=November 5, 2026");
    expect(html).toContain("banner.countdown vals=12");
    expect(html).not.toContain("banner.downloadCta");
    expect(html).not.toContain("banner.keepCta");
    expect(html).not.toContain("settings#offboarding");
    expect(html).not.toContain("settings#billing");
  });

  it("member: does NOT render the admin message variant", () => {
    const html = render(
      <GracePeriodBanner
        slug="acme"
        role="member"
        daysRemaining={1}
        deletionDateLabel="November 5, 2026"
      />,
    );
    // The admin key `banner.message` must never leak into the member render; only
    // `banner.messageMember` (which shares the prefix) is allowed.
    expect(html).not.toMatch(/banner\.message vals=/);
  });
});
