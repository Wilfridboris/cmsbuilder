import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CreditNoteDraftForm,
  type CreditNotePrefillLine,
} from "@/components/invoices/CreditNoteDraftForm";
import { formatInvoiceNumber } from "@/lib/invoicing/tax";
import { loadInvoicePageContext, loadInvoiceForPage } from "../../../_shared";

/**
 * Admin-only new-credit-note-draft page at `/{slug}/invoices/[id]/credit-notes/new` (Story
 * 12.8). Gates via `loadInvoicePageContext` (province/language/tax defaults) and loads the
 * source invoice via `loadInvoiceForPage` for the prefill + creditable check. The draft
 * form is PREFILLED from the source invoice's frozen line items (the common correction is
 * re-stating the invoice with one figure fixed). A non-creditable / missing source renders
 * a not-found note. The create endpoint re-enforces Admin + the creditable check server-side.
 */

export const dynamic = "force-dynamic";

/** Source invoice statuses that may be credited. */
const CREDITABLE = new Set(["issued", "paid", "overdue"]);

export default async function NewCreditNotePage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const t = await getTranslations("CreditNotes");

  const context = await loadInvoicePageContext(slug);
  const source = await loadInvoiceForPage(slug, id);

  const creditable = source !== null && CREDITABLE.has(source.invoice.status);

  const prefillLines: CreditNotePrefillLine[] = creditable
    ? source!.lineItems.map((item) => ({
        description: item.description,
        quantity:
          typeof item.quantity === "number"
            ? item.quantity
            : Number(item.quantity),
        unitPrice:
          typeof item.unit_price === "number"
            ? item.unit_price
            : Number(item.unit_price),
      }))
    : [];

  const originalNumber = creditable
    ? formatInvoiceNumber(
        source!.invoice.invoice_number === null
          ? null
          : Number(source!.invoice.invoice_number),
      )
    : "";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <Link
        href={`/${slug}/invoices/${id}`}
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "w-fit gap-2",
        )}
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("backToInvoice")}
      </Link>

      {!creditable ? (
        <p role="alert" className="text-sm text-destructive">
          {t("error.notIssued")}
        </p>
      ) : (
        <CreditNoteDraftForm
          slug={slug}
          invoiceId={id}
          creditNoteId={null}
          originalInvoiceNumber={originalNumber}
          prefillLines={prefillLines}
          defaultProvince={source!.invoice.place_of_supply_province ?? context.defaultProvince}
          defaultLanguage={source!.invoice.language}
          taxRegistered={context.taxRegistered}
        />
      )}
    </main>
  );
}
