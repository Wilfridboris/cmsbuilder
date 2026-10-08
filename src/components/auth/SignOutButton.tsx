"use client";

import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * SignOutButton (Story 15.1) — a small reusable sign-out affordance.
 *
 * A plain `<form>` posting to `/auth/signout` (a server route that clears the
 * session and redirects `/`), wrapping a ghost button. No client JS is required
 * for it to work, so it degrades gracefully. Reused on the auth-aware home card
 * and in `DashboardNav`. All copy resolves through the `SignOut` next-intl
 * namespace (EN + FR).
 */
export function SignOutButton({ className }: { className?: string }) {
  const t = useTranslations("SignOut");
  return (
    <form action="/auth/signout" method="post" className={className}>
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        className="gap-2 focus-visible:ring-2"
      >
        <LogOut aria-hidden="true" className="size-4" />
        <span>{t("label")}</span>
      </Button>
    </form>
  );
}
