import { getTranslations } from "next-intl/server";

import type { SupplierSnapshot } from "@/types/db";

/**
 * PaymentInstructionsBlock (Story 12.6, I6) — the structured Payment Instructions the
 * customer needs to pay, rendered server-side from the FROZEN `supplier_snapshot` of an
 * issued invoice (never the live `business_profiles` row). Each row renders only when
 * its snapshot field is present; the whole block is omitted when no field is set.
 *
 * Labels resolve through the `InvoicePdf` next-intl namespace (shared with the frozen
 * PDF's payment block, so the on-screen and printed labels agree). Uses the viewer's
 * request locale for labels (the same convention as `IssuedInvoiceView`); the field
 * VALUES are frozen and language-agnostic.
 */

type PaymentRow = { label: string; value: string | null | undefined };

export async function PaymentInstructionsBlock({
  supplier,
}: {
  supplier: SupplierSnapshot | null;
}) {
  const t = await getTranslations("InvoicePdf");

  if (!supplier) {
    return null;
  }

  const rows: PaymentRow[] = [
    { label: t("paymentTerms"), value: supplier.default_payment_terms },
    { label: t("paymentEtransfer"), value: supplier.payment_etransfer_email },
    { label: t("paymentCheque"), value: supplier.payment_cheque_payable_to },
    {
      label: t("paymentChequeAddress"),
      value: supplier.payment_cheque_address,
    },
    { label: t("paymentCard"), value: supplier.payment_card_link },
  ].filter(
    (row): row is { label: string; value: string } =>
      typeof row.value === "string" && row.value.trim() !== "",
  );

  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">
        {t("paymentHeading")}
      </h2>
      <dl className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-[10rem_1fr]">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid gap-0.5 sm:col-span-2 sm:grid-cols-subgrid"
          >
            <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {row.label}
            </dt>
            <dd className="text-sm whitespace-pre-line break-words text-foreground">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
