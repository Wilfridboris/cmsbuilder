"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { FilePlus2 } from "lucide-react";

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
import { formatInvoiceNumber } from "@/lib/invoicing/tax";
import { invoiceShareUrl } from "@/lib/invoicing/share";
import { InvoiceApiError } from "@/lib/data/invoices-client";
import {
  listCreditNotesForInvoice,
  type CreditNoteSummary,
} from "@/lib/data/credit-notes-client";
import type { CreditNoteStatus } from "@/types/db";

/**
 * InvoiceCreditNotes (Story 12.8) — mounted on the issued invoice view. It offers the
 * "Create credit note" action (a link to the new-credit-note page) and, once any credit
 * notes exist for this invoice, a compact linked list (number, total, status, View/
 * Download). Loads via `GET /api/invoices/[id]/credit-notes` under the Admin gate. Reuses
 * the shared `ui/table` + `ui/badge` primitives; copy resolves through the `CreditNotes`
 * namespace.
 */

const STATUS_LABEL_KEY: Record<CreditNoteStatus, string> = {
  draft: "statusDraft",
  issued: "statusIssued",
  void: "statusVoid",
};

const STATUS_VARIANT: Record<
  CreditNoteStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "secondary",
  issued: "default",
  void: "outline",
};

function money(value: number | string): string {
  const n = typeof value === "number" ? value : Number(value);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

/** No-op subscribe: mount state never changes after hydration. */
const noopSubscribe = () => () => {};

/** `true` on the client (after hydration) so the token URLs light up without SSR mismatch. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function InvoiceCreditNotes({
  slug,
  invoiceId,
}: {
  slug: string;
  invoiceId: string;
}) {
  const t = useTranslations("CreditNotes");
  const [creditNotes, setCreditNotes] = useState<CreditNoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isClient = useIsClient();
  const origin =
    isClient && typeof window !== "undefined" ? window.location.origin : "";

  const KNOWN_ERROR_KEYS = new Set([
    "forbidden",
    "unauthorized",
    "loadFailed",
    "genericError",
  ]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await listCreditNotesForInvoice(slug, invoiceId);
        if (active) setCreditNotes(rows);
      } catch (err) {
        if (!active) return;
        const code = err instanceof InvoiceApiError ? err.code : "loadFailed";
        const short = code.replace(/^Invoice\.error\./, "");
        setError(
          KNOWN_ERROR_KEYS.has(short)
            ? t(`error.${short}`)
            : t("error.genericError"),
        );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, invoiceId]);

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            {t("linkedHeading")}
          </h2>
          <p className="text-sm text-muted-foreground text-pretty">
            {t("createSubtitle")}
          </p>
        </div>
        <Link
          href={`/${slug}/invoices/${invoiceId}/credit-notes/new`}
          className={cn(buttonVariants({ variant: "default" }), "min-h-11 gap-2")}
        >
          <FilePlus2 aria-hidden="true" className="size-4" />
          {t("create")}
        </Link>
      </div>

      {loading ? (
        <div aria-busy="true" className="h-10 w-full animate-pulse rounded-md bg-muted" />
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : creditNotes.length === 0 ? null : (
        <div className="rounded-lg border border-border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("linkedNumber")}</TableHead>
                <TableHead>{t("linkedStatus")}</TableHead>
                <TableHead className="text-right">{t("linkedTotal")}</TableHead>
                <TableHead className="text-right">{t("linkedAction")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {creditNotes.map((creditNote) => {
                const number =
                  creditNote.credit_note_number !== null &&
                  creditNote.credit_note_number !== undefined
                    ? formatInvoiceNumber(
                        typeof creditNote.credit_note_number === "string"
                          ? Number(creditNote.credit_note_number)
                          : creditNote.credit_note_number,
                      )
                    : t("linkedNumberPlaceholder");
                const shareLink =
                  origin && creditNote.share_token
                    ? invoiceShareUrl(origin, creditNote.share_token)
                    : null;
                return (
                  <TableRow key={creditNote.id}>
                    <TableCell className="font-medium tabular-nums text-foreground">
                      {number}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[creditNote.status]}>
                        {t(STATUS_LABEL_KEY[creditNote.status])}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-foreground">
                      {money(creditNote.total)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/${slug}/invoices/${invoiceId}/credit-notes/${creditNote.id}`}
                          className={cn(
                            buttonVariants({ variant: "ghost", size: "sm" }),
                            "min-h-9",
                          )}
                        >
                          {t("linkedView")}
                        </Link>
                        {shareLink && creditNote.pdf_path ? (
                          <a
                            href={shareLink}
                            download={`credit-note-${number}.pdf`}
                            className={cn(
                              buttonVariants({ variant: "ghost", size: "sm" }),
                              "min-h-9",
                            )}
                          >
                            {t("linkedDownload")}
                          </a>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
