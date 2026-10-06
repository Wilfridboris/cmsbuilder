import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Archive } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * AccountClosedScreen (Story 8.5, FR38) — the terminal "account closed" panel shown
 * in place of the dashboard nav + children when an org has reached the `deleted`
 * tombstone (the Day-30 cascade has run).
 *
 * Server component (no interactivity): calm, muted, NOT failure-red — the account is
 * simply gone, not in error. A muted icon well, a reassuring note that tax-required
 * invoices are retained separately, and one quiet link home. WCAG AA; the heading is
 * wired via `aria-labelledby`. The fade-in honors reduced motion
 * (`motion-reduce:animate-none`).
 */

export async function AccountClosedScreen() {
  const t = await getTranslations("Offboarding");

  return (
    <main
      aria-labelledby="account-closed-heading"
      className="grid min-h-dvh place-items-center bg-background px-6"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-border bg-card p-8 text-center shadow-sm animate-in fade-in duration-500 motion-reduce:animate-none">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Archive aria-hidden="true" className="size-6" />
        </div>
        <h1
          id="account-closed-heading"
          className="text-xl font-semibold tracking-tight text-balance"
        >
          {t("accountClosed.title")}
        </h1>
        <p className="text-sm text-muted-foreground text-pretty">
          {t("accountClosed.body")}
        </p>
        <Link
          href="/"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          {t("accountClosed.homeCta")}
        </Link>
      </div>
    </main>
  );
}
