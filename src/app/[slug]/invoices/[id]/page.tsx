import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InvoiceDraftForm } from "@/components/invoices/InvoiceDraftForm";
import { IssuedInvoiceView } from "@/components/invoices/IssuedInvoiceView";
import { InvoiceDeliveryActions } from "@/components/invoices/InvoiceDeliveryActions";
import { InvoicePaymentActions } from "@/components/invoices/InvoicePaymentActions";
import { formatInvoiceNumber } from "@/lib/invoicing/tax";
import { loadInvoicePageContext, loadInvoiceForPage } from "../_shared";

/** Statuses whose issued view shows the delivery bar (hidden for draft and void). */
const DELIVERABLE_STATUSES = new Set(["issued", "paid", "overdue"]);

/**
 * Extract an email-looking recipient from a frozen customer snapshot's `data` (Story
 * 12.6). Prefills the send dialog ONLY when the snapshot holds a plausible email — the
 * owner always confirms/edits before sending, so a loose heuristic is safe. Standalone
 * / email-less snapshots yield null (an empty required field).
 */
function customerEmailPrefill(
  data: Record<string, unknown> | undefined,
): string | null {
  if (!data) return null;
  for (const value of Object.values(data)) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return trimmed;
      }
    }
  }
  return null;
}

/**
 * Coerce a PostgREST numeric-boundary total to a plain "1234.56" string for the mark-paid
 * amount default (Story 12.7). The dialog's amount field is a bare number input, so a raw
 * 2-decimal string (no currency symbol/grouping) is the correct editable default.
 */
function invoiceTotalString(value: number | string): string {
  const n = typeof value === "number" ? value : Number(value);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

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
        <>
          <IssuedInvoiceView
            invoice={loaded.invoice}
            lineItems={loaded.lineItems}
            taxLines={loaded.taxLines}
            locale={await getLocale()}
          />
          {/* Mark paid: only for an issued invoice (hidden for draft/paid/void). */}
          {loaded.invoice.status === "issued" ? (
            <InvoicePaymentActions
              slug={slug}
              invoiceId={loaded.invoice.id}
              version={loaded.invoice.version}
              invoiceTotal={invoiceTotalString(loaded.invoice.total)}
              language={loaded.invoice.language}
            />
          ) : null}
          {DELIVERABLE_STATUSES.has(loaded.invoice.status) &&
          loaded.invoice.share_token ? (
            <InvoiceDeliveryActions
              slug={slug}
              invoiceId={loaded.invoice.id}
              shareToken={loaded.invoice.share_token}
              invoiceNumber={formatInvoiceNumber(
                loaded.invoice.invoice_number === null
                  ? null
                  : Number(loaded.invoice.invoice_number),
              )}
              language={loaded.invoice.language}
              customerEmailPrefill={customerEmailPrefill(
                loaded.invoice.customer_snapshot?.data,
              )}
            />
          ) : null}
        </>
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
