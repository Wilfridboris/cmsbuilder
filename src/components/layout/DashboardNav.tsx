import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LayoutDashboard, Settings } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import type { MemberRole } from "@/types/db";

/**
 * Role-aware dashboard navigation (Story 2.4) — a Server Component.
 *
 * Renders the tenant dashboard link for EVERYONE and Admin-only links (Settings
 * today) ONLY when `role === 'admin'`. Because it resolves on the server, a
 * Member's HTML never contains the Admin links at all — role never reaches the
 * client (there is no client role provider today). This is the UI-hiding half of
 * RBAC; the API routes independently re-enforce Admin via the same guard, so
 * frontend hiding is never the sole gate.
 *
 * Scope (frozen): links only Admin surfaces that EXIST today (Settings). No
 * placeholder / disabled / dead links for surfaces later epics add (the
 * Conversational Editor, Billing) — those epics add their own entries behind the
 * same guard.
 *
 * Built to the web-uiux-architect standard: Tailwind v4, reuses the `ui/`
 * `buttonVariants` primitive, WCAG AA (a labelled `<nav>` landmark, visible
 * focus rings from the button primitive, `aria-hidden` decorative icons). All
 * copy resolves through the `DashboardNav` next-intl namespace (EN + FR).
 */
export async function DashboardNav({
  slug,
  role,
}: {
  slug: string;
  role: MemberRole;
}) {
  const t = await getTranslations("DashboardNav");
  const isAdmin = role === "admin";

  return (
    <nav
      aria-label={t("label")}
      className="w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60"
    >
      <div className="mx-auto flex w-full max-w-5xl items-center gap-1 px-6 py-3">
        <Link
          href={`/${slug}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-2")}
        >
          <LayoutDashboard aria-hidden="true" className="size-4" />
          <span>{t("dashboard")}</span>
        </Link>

        {isAdmin ? (
          <Link
            href={`/${slug}/settings`}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "gap-2",
            )}
          >
            <Settings aria-hidden="true" className="size-4" />
            <span>{t("settings")}</span>
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
