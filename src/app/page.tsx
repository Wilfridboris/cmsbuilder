import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";

import { getCurrentUser } from "@/lib/auth/session";
import { resolveUserPrimaryOrgSlug } from "@/lib/auth/org";
import { createAdminClient } from "@/lib/supabase/admin";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LocaleToggle } from "@/components/i18n/LocaleToggle";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { HomeClaimView } from "@/components/home/HomeClaimView";

/**
 * Landing route (Story 1.3, extended 2.1, reshaped auth-aware in 15.1).
 *
 * A SERVER component that branches on the session:
 *   - signed-in owner with a resolved org → a "go to my dashboard" card (links
 *     `/{slug}`) + a sign-out affordance, never the empty claim form;
 *   - signed-out visitor, or a signed-in user with no org yet (first-time) →
 *     the client claim UI (`HomeClaimView`) with the strengthened log-in entry.
 *
 * A signed-in visitor is never auto-redirected off `/` (the sign-out affordance
 * must stay reachable). The EN/FR toggle is surfaced top-right on both branches.
 */

export const dynamic = "force-dynamic";

export default async function Home() {
  const t = await getTranslations("Home");

  // Guarded like the resolver below: an auth-provider / cookie fault degrades to
  // the claim UI rather than crashing the home route (its most-hit surface).
  let user = null;
  try {
    user = await getCurrentUser();
  } catch {
    user = null;
  }

  let signedIn: { slug: string; name: string } | null = null;
  if (user) {
    const admin = createAdminClient();
    try {
      const resolved = await resolveUserPrimaryOrgSlug(user.id, admin);
      if (resolved) {
        // Fetch the display name for the greeting; fall back to the slug if the
        // name read fails (never block the card on it).
        const { data: org } = await admin
          .from("organizations")
          .select("name")
          .eq("slug", resolved.slug)
          .maybeSingle();
        signedIn = {
          slug: resolved.slug,
          name: (org?.name as string | undefined) ?? resolved.slug,
        };
      }
    } catch {
      // A resolver fault degrades to the claim UI rather than crashing the home
      // route; the user can still reach their dashboard via /login.
      signedIn = null;
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div className="flex justify-end">
        <LocaleToggle />
      </div>

      {signedIn ? (
        <section className="mx-auto w-full max-w-md animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
          <div className="flex flex-col items-center gap-6 rounded-2xl border bg-card p-8 text-center shadow-xl shadow-black/5">
            <header className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-balance">
                {t("signedInTitle", { name: signedIn.name })}
              </h1>
              <p className="text-sm text-muted-foreground text-pretty">
                {t("signedInBody")}
              </p>
            </header>
            <Link
              href={`/${signedIn.slug}`}
              className={cn(
                buttonVariants({ size: "lg" }),
                "group min-h-12 w-full gap-2 text-base",
              )}
            >
              <span>{t("signedInCta")}</span>
              <ArrowRight
                aria-hidden="true"
                className="size-4 transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
              />
            </Link>
            <SignOutButton />
          </div>
        </section>
      ) : (
        <HomeClaimView />
      )}
    </main>
  );
}
