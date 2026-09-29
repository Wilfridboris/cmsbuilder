import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InvoiceDraftForm } from "@/components/invoices/InvoiceDraftForm";
import { loadInvoicePageContext } from "../_shared";

/**
 * Admin-only new-invoice-draft page at `/{slug}/invoices/new` (Story 12.2). Gates
 * via `loadInvoicePageContext`, then renders `InvoiceDraftForm` in create mode with
 * the org's tables (for the linked-record picker) and the Business Profile
 * province/language defaults. The create endpoint re-enforces Admin server-side.
 */

export const dynamic = "force-dynamic";

export default async function NewInvoicePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const context = await loadInvoicePageContext(slug);
  const t = await getTranslations("Invoices");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <Link
        href={`/${slug}/invoices`}
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "w-fit gap-2",
        )}
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("backToList")}
      </Link>
      <InvoiceDraftForm
        slug={slug}
        invoiceId={null}
        tables={context.tables}
        defaultProvince={context.defaultProvince}
        defaultLanguage={context.defaultLanguage}
      />
    </main>
  );
}
