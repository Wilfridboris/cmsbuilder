import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Clock, Mail, Trash2, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

/**
 * OffboardingSection (Story 8.5, FR38) — the explanatory "Close account" section on
 * the admin Settings page, wired after the Data Export section.
 *
 * Server component. It explains the offboarding lifecycle (30-day read-only grace →
 * day 1/7/25 reminders → permanent deletion at day 30), reassures that invoices are
 * retained six years by law, and surfaces the two safe actions: Manage Billing (where
 * cancellation actually happens, in Stripe — Option A: no destructive button here) and
 * Download My Data. Matches the shadcn New York / zinc idiom and semantic tokens,
 * WCAG AA, no em-dashes.
 */

export async function OffboardingSection() {
  const t = await getTranslations("Offboarding.section");

  const steps = [
    { Icon: Clock, text: t("stepGrace") },
    { Icon: Mail, text: t("stepReminders") },
    { Icon: Trash2, text: t("stepDeletion") },
  ];

  return (
    <section id="offboarding" className="flex flex-col gap-8 scroll-mt-16">
      <header className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground text-pretty">
          {t("subtitle")}
        </p>
      </header>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted/30 p-6">
        <p className="text-sm text-pretty">{t("lead")}</p>

        <ol className="flex flex-col gap-3">
          {steps.map(({ Icon, text }, index) => (
            <li key={index} className="flex items-start gap-3">
              <Icon
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-muted-foreground"
              />
              <span className="text-sm text-pretty">{text}</span>
            </li>
          ))}
        </ol>

        <div className="flex items-start gap-3 border-t border-border pt-4">
          <ShieldCheck
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-muted-foreground"
          />
          <span className="text-sm text-pretty">{t("retention")}</span>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href="#billing"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            {t("manageCta")}
          </Link>
          <Link
            href="#data-export"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            {t("downloadCta")}
          </Link>
        </div>
      </div>
    </section>
  );
}
