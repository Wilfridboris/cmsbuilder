"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ClipboardList } from "lucide-react";

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
import type { FormRow } from "@/types/db";
import { FormApiError, listForms } from "@/lib/data/forms-client";
import { CreateFormDialog } from "@/components/forms/CreateFormDialog";

/**
 * FormsList (Epic 14, Story 14.1) — the Admin-only list of the org's intake forms. Loads
 * via `GET /api/forms` (newest first), renders an empty state with a "New form" action,
 * or a table linking each form to its editor. Hosts the create dialog, which on success
 * refreshes the list in place. Reuses the `ui/table` + `ui/badge` primitives; all copy
 * resolves through the `Forms` namespace.
 */

/** Server error codes this list maps to a translated message; anything else → generic. */
const ERROR_KEYS = new Set(["forbidden", "unauthorized", "loadFailed", "genericError"]);

/** Resolve a server error code to a translated message, guarding unknown codes. */
function resolveListError(t: (key: string) => string, code: string): string {
  const short = code.replace(/^Forms\.error\./, "");
  return ERROR_KEYS.has(short) ? t(`error.${short}`) : t("error.genericError");
}

export function FormsList({ slug }: { slug: string }) {
  const t = useTranslations("Forms");

  const [forms, setForms] = useState<FormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await listForms(slug);
        if (active) setForms(rows);
      } catch (err) {
        if (!active) return;
        const code = err instanceof FormApiError ? err.code : "loadFailed";
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

  async function refresh() {
    try {
      const rows = await listForms(slug);
      setForms(rows);
      setError(null);
    } catch (err) {
      const code = err instanceof FormApiError ? err.code : "loadFailed";
      setError(resolveListError(t, code));
    }
  }

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
        <CreateFormDialog slug={slug} onCreated={refresh} />
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
      ) : forms.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <div
            aria-hidden="true"
            className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <ClipboardList className="size-6" />
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold text-foreground">
              {t("emptyTitle")}
            </h2>
            <p className="max-w-sm text-sm text-muted-foreground text-pretty">
              {t("emptyBody")}
            </p>
          </div>
          <CreateFormDialog slug={slug} onCreated={refresh} emptyState />
        </div>
      ) : (
        <div className="rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colTitle")}</TableHead>
                <TableHead>{t("colSlug")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead className="text-right">{t("colAction")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {forms.map((form) => (
                <TableRow key={form.id}>
                  <TableCell className="font-medium text-foreground">
                    {form.title}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {form.slug}
                  </TableCell>
                  <TableCell>
                    <Badge variant={form.published ? "default" : "secondary"}>
                      {form.published ? t("statusPublished") : t("statusDraft")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/${slug}/forms/${form.id}`}
                      className={cn(
                        buttonVariants({ variant: "ghost", size: "sm" }),
                        "min-h-9",
                      )}
                      aria-label={t("openForm")}
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
