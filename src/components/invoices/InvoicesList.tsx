"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { FileText, Plus } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { InvoiceRow, InvoiceStatus } from "@/types/db";
import { InvoiceApiError, listInvoices } from "@/lib/data/invoices-client";

/**
 * InvoicesList (Story 12.2) — the Admin-only list of the org's invoices. Loads via
 * `GET /api/invoices` (newest first), renders an empty state with a "New invoice"
 * action, or a table linking each invoice to its edit page. Reuses the `ui/table`
 * + `ui/badge` primitives; all copy resolves through the `Invoices` namespace.
 *
 * Story 12.2 only ever creates drafts, but the status column renders every
 * lifecycle value (draft|issued|paid|overdue|void) so 12.3+ need no change here.
 */

/** Server error codes this list maps to a translated message; anything else → generic. */
const ERROR_KEYS = new Set(["forbidden", "unauthorized", "loadFailed", "genericError"]);

/** Resolve a server error code to a translated message, guarding unknown codes. */
function resolveListError(t: (key: string) => string, code: string): string {
  const short = code.replace(/^Invoice\.error\./, "");
  return ERROR_KEYS.has(short) ? t(`error.${short}`) : t("error.genericError");
}

const STATUS_LABEL_KEY: Record<InvoiceStatus, string> = {
  draft: "statusDraft",
  issued: "statusIssued",
  paid: "statusPaid",
  overdue: "statusOverdue",
  void: "statusVoid",
};

const STATUS_VARIANT: Record<
  InvoiceStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "secondary",
  issued: "default",
  paid: "default",
  overdue: "destructive",
  void: "outline",
};

function formatUpdated(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function InvoicesList({
  slug,
  locale,
}: {
  slug: string;
  locale: string;
}) {
  const t = useTranslations("Invoices");

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await listInvoices(slug);
        if (active) setInvoices(rows);
      } catch (err) {
        if (!active) return;
        const code = err instanceof InvoiceApiError ? err.code : "loadFailed";
        setError(resolveListError(t, code));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            {t("listTitle")}
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground text-pretty">
            {t("listSubtitle")}
          </p>
        </div>
        <Link
          href={`/${slug}/invoices/new`}
          className={cn(buttonVariants({ variant: "default" }), "min-h-12 gap-2")}
        >
          <Plus aria-hidden="true" className="size-4" />
          {t("newInvoice")}
        </Link>
      </header>

      {loading ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 w-full animate-pulse rounded-md bg-muted" />
          ))}
          <span className="sr-only">{t("loading")}</span>
        </div>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : invoices.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <div
            aria-hidden="true"
            className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <FileText className="size-6" />
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold text-foreground">
              {t("emptyTitle")}
            </h2>
            <p className="max-w-sm text-sm text-muted-foreground text-pretty">
              {t("emptyBody")}
            </p>
          </div>
          <Link
            href={`/${slug}/invoices/new`}
            className={cn(buttonVariants({ variant: "default" }), "min-h-12 gap-2")}
          >
            <Plus aria-hidden="true" className="size-4" />
            {t("emptyAction")}
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead>{t("colUpdated")}</TableHead>
                <TableHead className="text-right">{t("colAction")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[invoice.status]}>
                      {t(STATUS_LABEL_KEY[invoice.status])}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatUpdated(invoice.updated_at, locale)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/${slug}/invoices/${invoice.id}`}
                      className={cn(
                        buttonVariants({ variant: "ghost", size: "sm" }),
                        "min-h-9",
                      )}
                      aria-label={t("openInvoice")}
                    >
                      {t("colAction")}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
