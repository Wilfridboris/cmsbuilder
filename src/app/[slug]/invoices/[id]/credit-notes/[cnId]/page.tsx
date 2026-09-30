import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CreditNoteDraftForm } from "@/components/invoices/CreditNoteDraftForm";
import { IssuedCreditNoteView } from "@/components/invoices/IssuedCreditNoteView";
import { formatInvoiceNumber } from "@/lib/invoicing/tax";
import {
  loadInvoicePageContext,
  loadInvoiceForPage,
  loadCreditNoteForPage,
} from "../../../_shared";

/**
 * Admin-only credit-note page at `/{slug}/invoices/[id]/credit-notes/[cnId]` (Story 12.8).
 * Runs the Admin gate server-side (the API routes re-enforce it). BRANCHES on the loaded
 * credit-note status:
 *   - `draft`     -> `CreditNoteDraftForm` (edit mode, with the Issue action);
 *   - non-draft   -> `IssuedCreditNoteView` (read-only, from the frozen snapshots, with the
 *                    in-app Download PDF + Copy Link bar).
 * A missing credit note renders a not-found note.
 */

export const dynamic = "force-dynamic";

export default async function CreditNotePage({
  params,
}: {
  params: Promise<{ slug: string; id: string; cnId: string }>;
}) {
  const { slug, id, cnId } = await params;
  const t = await getTranslations("CreditNotes");

  const loaded = await loadCreditNoteForPage(slug, cnId);

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

      {!loaded ? (
        <p role="alert" className="text-sm text-destructive">
          {t("error.notFound")}
        </p>
      ) : loaded.creditNote.status === "draft" ? (
        <CreditNoteDraftFormWrapper slug={slug} id={id} cnId={cnId} />
      ) : (
        <IssuedCreditNoteView
          creditNote={loaded.creditNote}
          lineItems={loaded.lineItems}
          taxLines={loaded.taxLines}
          locale={await getLocale()}
        />
      )}
    </main>
  );
}

/**
 * Thin async wrapper that loads the page context (province/language/tax defaults) for the
 * edit form. Kept separate so the issued branch pays for none of that work.
 */
async function CreditNoteDraftFormWrapper({
  slug,
  id,
  cnId,
}: {
  slug: string;
  id: string;
  cnId: string;
}) {
  const [context, source] = await Promise.all([
    loadInvoicePageContext(slug),
    loadInvoiceForPage(slug, id),
  ]);
  const originalNumber = source
    ? formatInvoiceNumber(
        source.invoice.invoice_number === null
          ? null
          : Number(source.invoice.invoice_number),
      )
    : "";
  return (
    <CreditNoteDraftForm
      slug={slug}
      invoiceId={id}
      creditNoteId={cnId}
      originalInvoiceNumber={originalNumber}
      prefillLines={[]}
      defaultProvince={context.defaultProvince}
      defaultLanguage={context.defaultLanguage}
      taxRegistered={context.taxRegistered}
    />
  );
}
