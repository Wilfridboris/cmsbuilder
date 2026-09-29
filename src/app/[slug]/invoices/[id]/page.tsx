import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InvoiceDraftForm } from "@/components/invoices/InvoiceDraftForm";
import { IssuedInvoiceView } from "@/components/invoices/IssuedInvoiceView";
import { loadInvoicePageContext, loadInvoiceForPage } from "../_shared";

/**
 * Admin-only invoice page at `/{slug}/invoices/[id]` (Story 12.2 + 12.4). Both the
 * context loader and the invoice loader run the same Admin gate server-side (the API
 * routes re-enforce it independently). It BRANCHES on the loaded invoice status:
 *   - `draft`     -> `InvoiceDraftForm` (edit mode, with the Issue action);
 *   - non-draft   -> `IssuedInvoiceView` (read-only, rendered from the frozen snapshots).
 * A missing invoice renders a not-found note.
 */

export const dynamic = "force-dynamic";

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const t = await getTranslations("Invoices");

  const loaded = await loadInvoiceForPage(slug, id);

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

      {!loaded ? (
        <p role="alert" className="text-sm text-destructive">
          {t("error.notFound")}
        </p>
      ) : loaded.invoice.status === "draft" ? (
        <InvoiceDraftFormWrapper slug={slug} id={id} />
      ) : (
        <IssuedInvoiceView
          invoice={loaded.invoice}
          lineItems={loaded.lineItems}
          taxLines={loaded.taxLines}
          locale={await getLocale()}
        />
      )}
    </main>
  );
}

/**
 * Thin async wrapper that loads the draft-page context (province/language defaults +
 * `taxRegistered`) for the edit form. Kept separate so the issued branch pays for none
 * of that work.
 */
async function InvoiceDraftFormWrapper({
  slug,
  id,
}: {
  slug: string;
  id: string;
}) {
  const context = await loadInvoicePageContext(slug);
  return (
    <InvoiceDraftForm
      slug={slug}
      invoiceId={id}
      tables={context.tables}
      defaultProvince={context.defaultProvince}
      defaultLanguage={context.defaultLanguage}
      taxRegistered={context.taxRegistered}
    />
  );
}
