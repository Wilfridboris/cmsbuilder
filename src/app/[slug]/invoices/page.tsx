import { getLocale } from "next-intl/server";

import { InvoicesList } from "@/components/invoices/InvoicesList";
import { loadInvoicePageContext } from "./_shared";

/**
 * Admin-only Invoices list at `/{slug}/invoices` (Story 12.2). Server component:
 * gates via `loadInvoicePageContext` (non-Admin bounces to `/{slug}`), then renders
 * the client `InvoicesList` which fetches the org's invoices. The list endpoint
 * re-enforces Admin server-side (frontend gating is never the sole enforcement).
 */

export const dynamic = "force-dynamic";

export default async function InvoicesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await loadInvoicePageContext(slug);
  const locale = await getLocale();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16">
      <InvoicesList slug={slug} locale={locale} />
    </main>
  );
}
