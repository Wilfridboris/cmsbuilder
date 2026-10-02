"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EyeOff, Loader2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  postRestoreTable,
  SchemaChatError,
} from "@/lib/data/schema-chat-client";

/**
 * HiddenTablesRestoreSection (Story 5.7) — the Admin-only restore surface for
 * tables hidden via chat. The Settings page is already Admin-gated (and the
 * `/api/schema/tables` route re-enforces Admin + the slug cross-check server-side,
 * so frontend hiding is never the sole gate), so this component simply lists the
 * hidden tables and offers a Restore control per row.
 *
 * Each Restore calls the direct, non-LLM `POST /api/schema/tables`
 * (`action: "restore"`) and then `router.refresh()` so the server component
 * re-reads the schema and the row drops off the list (the table reappears on the
 * dashboard). A failure shows a translated inline message; a raw error never shows.
 * All copy resolves through the `SlugDashboard` next-intl namespace (EN + FR).
 */
export function HiddenTablesRestoreSection({
  slug,
  hiddenTables,
}: {
  slug: string;
  hiddenTables: Array<{ key: string; label: string }>;
}) {
  const t = useTranslations("SlugDashboard");
  const router = useRouter();
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const restore = async (tableKey: string) => {
    if (restoringKey) return;
    setRestoringKey(tableKey);
    setErrorKey(null);
    try {
      await postRestoreTable(slug, tableKey);
      router.refresh();
    } catch (err) {
      const code = err instanceof SchemaChatError ? err.code : "genericError";
      setErrorKey(code);
    } finally {
      setRestoringKey(null);
    }
  };

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">
          {t("hiddenTablesTitle")}
        </h2>
        <p className="text-sm text-muted-foreground text-pretty">
          {t("hiddenTablesSubtitle")}
        </p>
      </header>

      {hiddenTables.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("hiddenTablesEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {hiddenTables.map((table) => {
            const isRestoring = restoringKey === table.key;
            return (
              <li
                key={table.key}
                className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-card/50 px-4 py-3 shadow-sm shadow-black/5 transition-colors duration-200 hover:bg-card"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <EyeOff
                    aria-hidden="true"
                    className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
                  />
                  <span className="truncate text-sm font-medium">
                    {table.label}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 shrink-0"
                  aria-label={t("restoreTableAria", { table: table.label })}
                  disabled={restoringKey !== null}
                  onClick={() => restore(table.key)}
                >
                  {isRestoring ? (
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <Undo2 aria-hidden="true" className="size-4" />
                  )}
                  {t("restoreTable")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t("tableRestoreFailed")}
        </p>
      ) : null}
    </section>
  );
}
